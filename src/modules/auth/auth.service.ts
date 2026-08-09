import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { User, UserStatus } from '../users/entities/user.entity';
import { Role } from '../roles/entities/role.entity';
import { UserTokensService } from '../user-tokens/user-tokens.service';
import { UserTokenPurpose } from '../user-tokens/entities/user-token.entity';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { DUMMY_PASSWORD_HASH, PasswordService } from './password.service';
import { TokenService } from './token.service';

const POSTGRES_UNIQUE_VIOLATION = '23505';
const DEFAULT_SIGNUP_ROLE = 'Viewer'; // least privilege for self-registered accounts

interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

interface AuthResult {
  user: User;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(Role) private readonly rolesRepo: Repository<Role>,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly userTokensService: UserTokensService,
  ) {}

  async login(dto: LoginDto, meta: RequestMeta): Promise<AuthResult> {
    const user = await this.usersRepo.findOne({ where: { email: dto.email } });

    // Always run a real verify(), even with no user, using a fixed dummy
    // hash — so response timing can't reveal whether the email exists.
    // See docs/qa/phase-3-cookie-auth-understanding-check.md Q3.
    const hashToCompare = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordMatches = await this.passwordService.verify(hashToCompare, dto.password);

    if (!user || !user.passwordHash || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const accessToken = this.tokenService.signAccessToken(user);
    const { raw: refreshToken } = await this.tokenService.issueRefreshToken(user.id, meta);

    return { user, accessToken, refreshToken };
  }

  async refresh(rawRefreshToken: string, meta: RequestMeta): Promise<AuthResult> {
    const { raw: refreshToken, userId } = await this.tokenService.rotate(rawRefreshToken, meta);
    const user = await this.usersRepo.findOneByOrFail({ id: userId });
    const accessToken = this.tokenService.signAccessToken(user);
    return { user, accessToken, refreshToken };
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (rawRefreshToken) {
      await this.tokenService.revoke(rawRefreshToken);
    }
  }

  async me(userId: string): Promise<User> {
    return this.usersRepo.findOneByOrFail({ id: userId });
  }

  /**
   * Self-registration — deliberately NOT how Admin-provisioned users are
   * created (see UsersService.create()); this path sets a password
   * immediately and defaults to the least-privileged role. A documented
   * amendment to PRD.md Section 1.4, which originally scoped this out
   * entirely — see docs/phases.md Phase 8.
   */
  async signup(dto: SignupDto): Promise<{ email: string }> {
    const role = await this.rolesRepo.findOneByOrFail({ name: DEFAULT_SIGNUP_ROLE });
    const passwordHash = await this.passwordService.hash(dto.password);

    const user = this.usersRepo.create({
      name: dto.name,
      email: dto.email,
      passwordHash,
      status: UserStatus.PENDING,
      roleId: role.id,
    });

    try {
      await this.usersRepo.save(user);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as unknown as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION
      ) {
        throw new ConflictException('An account with this email already exists');
      }
      throw error;
    }

    await this.issueAndLogOtp(user);
    return { email: user.email };
  }

  /**
   * Email verification on account activation — reached from both signup
   * and accept-invite, NOT recurring MFA on every login (confirmed by the
   * actual frontend flow: normal login never routes through this). Success
   * activates the account AND logs the user in immediately, matching the
   * frontend's existing behavior.
   */
  async verifyOtp(dto: VerifyOtpDto, meta: RequestMeta): Promise<AuthResult> {
    const user = await this.usersRepo.findOne({ where: { email: dto.email } });
    if (!user) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    await this.userTokensService.consume(dto.code, UserTokenPurpose.EMAIL_VERIFICATION, user.id);

    user.status = UserStatus.ACTIVE;
    await this.usersRepo.save(user);

    const accessToken = this.tokenService.signAccessToken(user);
    const { raw: refreshToken } = await this.tokenService.issueRefreshToken(user.id, meta);
    return { user, accessToken, refreshToken };
  }

  /**
   * Read-only preview for the accept-invite page's "here's who was
   * invited" UI — never consumes the token. Generic NotFound-shaped error
   * on any invalid/expired/used token, same enumeration-avoidance
   * reasoning as forgotPassword.
   */
  async getInviteInfo(token: string): Promise<{ name: string; email: string; role: string }> {
    const userId = await this.userTokensService.peek(token, UserTokenPurpose.INVITE);
    if (!userId) {
      throw new UnauthorizedException('Invalid or expired invitation');
    }

    const user = await this.usersRepo.findOneByOrFail({ id: userId });
    return { name: user.name, email: user.email, role: user.role.name };
  }

  /**
   * Sets the password for an Admin-provisioned (invited) user. Does NOT
   * log the user in — per the existing frontend flow, accept-invite feeds
   * into the same verify-otp step signup does, not a direct login.
   */
  async acceptInvite(dto: AcceptInviteDto): Promise<{ email: string }> {
    const userId = await this.userTokensService.consume(dto.token, UserTokenPurpose.INVITE);
    const user = await this.usersRepo.findOneByOrFail({ id: userId });

    user.passwordHash = await this.passwordService.hash(dto.password);
    await this.usersRepo.save(user);

    await this.issueAndLogOtp(user);
    return { email: user.email };
  }

  /**
   * Always returns the same generic response regardless of whether the
   * email exists — prevents user enumeration, same principle as login's
   * generic error message (Phase 0 Q3).
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.usersRepo.findOne({ where: { email } });
    if (!user) {
      return;
    }

    const rawToken = await this.userTokensService.issueUrlToken(
      user.id,
      UserTokenPurpose.PASSWORD_RESET,
    );
    this.logger.log(
      `[MOCK EMAIL] Password reset link for ${email}: /reset-password?token=${rawToken}`,
    );
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const userId = await this.userTokensService.consume(
      dto.token,
      UserTokenPurpose.PASSWORD_RESET,
    );
    const user = await this.usersRepo.findOneByOrFail({ id: userId });

    user.passwordHash = await this.passwordService.hash(dto.newPassword);
    await this.usersRepo.save(user);

    // A reset means the old password may have been compromised — force
    // every existing session, on every device, to re-authenticate.
    await this.tokenService.revokeAllForUser(userId);
  }

  private async issueAndLogOtp(user: User): Promise<void> {
    const code = await this.userTokensService.issueOtp(user.id, UserTokenPurpose.EMAIL_VERIFICATION);
    this.logger.log(`[MOCK EMAIL] Verification code for ${user.email}: ${code}`);
  }
}
