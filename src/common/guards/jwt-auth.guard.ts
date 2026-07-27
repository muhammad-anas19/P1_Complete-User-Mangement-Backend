import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Runs the 'jwt' Passport strategy (JwtStrategy) before the route handler:
// extract access_token from the cookie -> verify signature/expiry -> populate
// request.user. Throws 401 itself if any step fails. See
// docs/qa/phase-3-cookie-auth-understanding-check.md Q9.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
