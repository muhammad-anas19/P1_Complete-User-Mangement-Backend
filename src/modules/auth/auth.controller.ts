import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Configuration } from '../../config/configuration';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CsrfGuard, CSRF_COOKIE_NAME } from '../../common/guards/csrf.guard';
import { SkipCsrf } from '../../common/decorators/skip-csrf.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TokenService } from './token.service';

// CsrfGuard applied once here; only /auth/login opts out (@SkipCsrf below).
// See docs/qa/phase-5-hardening-understanding-check.md B3/B4.
@ApiTags('auth')
@Controller('auth')
@UseGuards(CsrfGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly configService: ConfigService<Configuration, true>,
  ) {}

  // Not behind JwtAuthGuard — authenticates via password, not an access
  // token. See docs/qa/phase-3-cookie-auth-understanding-check.md
  // "Implementation Notes". No CSRF check either — no session/csrf cookie
  // can exist before login, and CSRF alone can't supply a password. See
  // docs/qa/phase-5-hardening-understanding-check.md B4.
  @ApiOperation({
    summary: 'Login — sets access_token/refresh_token/csrf_token cookies, no token in the body',
  })
  @SkipCsrf()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, accessToken, refreshToken } = await this.authService.login(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.setAuthCookies(res, accessToken, refreshToken);
    return user;
  }

  // Not behind JwtAuthGuard — must work even when the access token has
  // already expired; authenticates via the refresh_token cookie instead.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawRefreshToken = req.cookies?.['refresh_token'] as string | undefined;
    if (!rawRefreshToken) {
      throw new UnauthorizedException('No session to refresh');
    }

    const { user, accessToken, refreshToken } = await this.authService.refresh(
      rawRefreshToken,
      { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    );
    this.setAuthCookies(res, accessToken, refreshToken);
    return user;
  }

  // Not behind JwtAuthGuard — identifies the session via the refresh_token
  // cookie, not a (possibly already-expired) access token. See Q10.
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawRefreshToken = req.cookies?.['refresh_token'] as string | undefined;
    await this.authService.logout(rawRefreshToken);
    this.clearAuthCookies(res);
    return { loggedOut: true };
  }

  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Current session user — requires a valid access_token cookie' })
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() currentUser: CurrentUserPayload) {
    return this.authService.me(currentUser.id);
  }

  // Self-registration — a documented amendment to PRD.md's original scope.
  // No session/csrf cookie exists yet, same reasoning as login.
  @SkipCsrf()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('signup')
  @HttpCode(HttpStatus.OK)
  async signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  // Reached from signup AND accept-invite, not from normal login — this is
  // email verification on activation, not recurring MFA. See
  // docs/qa/phase-8-...md. Strictly throttled: a 6-digit code has a much
  // smaller guess space than a real password.
  @SkipCsrf()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, accessToken, refreshToken } = await this.authService.verifyOtp(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.setAuthCookies(res, accessToken, refreshToken);
    return user;
  }

  // Read-only preview for the accept-invite page's "here's who was
  // invited" UI — GET, never consumes the token. No CSRF concern at all
  // (GET is exempt by method in CsrfGuard already; nothing mutates here).
  @ApiOperation({ summary: 'Preview an invite token without consuming it' })
  @Get('invite-info')
  async getInviteInfo(@Query('token') token: string) {
    return this.authService.getInviteInfo(token);
  }

  // Sets the password for an Admin-provisioned user; does NOT log in — the
  // frontend routes on to /verify-otp next, matching signup's shape.
  @SkipCsrf()
  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  async acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.authService.acceptInvite(dto);
  }

  @SkipCsrf()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    // Generic response regardless of outcome — see AuthService.forgotPassword.
    return { message: 'If that email exists, a reset link has been sent.' };
  }

  @SkipCsrf()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return { message: 'Password reset — please sign in again.' };
  }

  private setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
    const isProd = this.configService.get('nodeEnv', { infer: true }) === 'production';

    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: this.tokenService.getAccessTokenMaxAgeMs(),
    });

    // Path scoped to /api/auth (not the narrower /api/auth/refresh
    // originally planned) — logout also needs to read this cookie to
    // revoke it, and Path=/api/auth/refresh silently excludes
    // /api/auth/logout from ever receiving it. See the "Corrected During
    // Implementation" note in docs/qa/phase-3-cookie-auth-understanding-check.md
    // Q6 — that reasoning was right, but written before Phase 9 added the
    // global /api prefix, and this path was never updated to match. Found
    // live: /auth/refresh and /auth/logout both silently never received
    // this cookie (Path=/auth doesn't match the real route /api/auth/*),
    // so refresh always failed with "No session to refresh" and logout
    // never actually revoked anything server-side — it just looked like it
    // worked because clearCookie('refresh_token', {path:'/auth'}) matched
    // the same (wrong) path it was set with. See BE-DEC-032.
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: this.tokenService.getRefreshTokenMaxAgeMs(),
    });

    // httpOnly: false is deliberate here, unlike the two cookies above —
    // same-origin JS must be able to read this one. See
    // docs/qa/phase-5-hardening-understanding-check.md B1.
    //
    // maxAge matches the REFRESH token's lifetime, not the access token's.
    // /auth/refresh itself sits behind CsrfGuard (no @SkipCsrf() — it's a
    // mutating POST), and it's specifically called AFTER the access token
    // has already expired. If this cookie's maxAge matched the access
    // token's short lifetime instead, it would expire at the exact same
    // moment the access token does — guaranteeing the csrf_token cookie is
    // already gone by the time the silent-refresh flow needs it, and every
    // refresh attempt would fail with "Missing or invalid CSRF token"
    // instead of actually refreshing. Found live: a real session sitting
    // idle past the 15-minute access-token window reproduced exactly this.
    res.cookie(CSRF_COOKIE_NAME, this.tokenService.generateCsrfToken(), {
      httpOnly: false,
      secure: isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: this.tokenService.getRefreshTokenMaxAgeMs(),
    });
  }

  private clearAuthCookies(res: Response): void {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/api/auth' });
    res.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
  }
}
