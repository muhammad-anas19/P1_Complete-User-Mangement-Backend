import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Configuration } from '../../../config/configuration';
import { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
}

// Overrides passport-jwt's default Authorization-header extraction to read
// the access_token cookie instead — see
// docs/qa/phase-3-cookie-auth-understanding-check.md Q9. Requires
// cookie-parser middleware (wired in main.ts) to have already populated
// req.cookies.
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService<Configuration, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => (req?.cookies?.['access_token'] as string | undefined) ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.accessSecret', { infer: true }),
    });
  }

  // Whatever this returns becomes request.user.
  validate(payload: AccessTokenPayload): CurrentUserPayload {
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
