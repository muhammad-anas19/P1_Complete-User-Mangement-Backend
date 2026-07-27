import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Configuration } from '../../config/configuration';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { TokenService } from './token.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly configService: ConfigService<Configuration, true>,
  ) {}

  // Not behind JwtAuthGuard — authenticates via password, not an access
  // token. See docs/qa/phase-3-cookie-auth-understanding-check.md
  // "Implementation Notes".
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

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() currentUser: CurrentUserPayload) {
    return this.authService.me(currentUser.id);
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

    // Path scoped to /auth (not the narrower /auth/refresh originally
    // planned) — logout also needs to read this cookie to revoke it, and
    // Path=/auth/refresh silently excludes /auth/logout from ever receiving
    // it. Caught by testing, not assumed correct — see the "Corrected
    // During Implementation" note in
    // docs/qa/phase-3-cookie-auth-understanding-check.md Q6.
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/auth',
      maxAge: this.tokenService.getRefreshTokenMaxAgeMs(),
    });
  }

  private clearAuthCookies(res: Response): void {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/auth' });
  }
}
