import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { DUMMY_PASSWORD_HASH, PasswordService } from './password.service';
import { TokenService } from './token.service';

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
  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
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
}
