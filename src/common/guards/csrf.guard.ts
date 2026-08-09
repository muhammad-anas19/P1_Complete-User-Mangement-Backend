import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SKIP_CSRF_KEY } from '../decorators/skip-csrf.decorator';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_COOKIE_NAME = 'csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';

// Double-submit cookie check. Implemented as a Guard, not raw middleware —
// exceptions thrown here are guaranteed to flow through AllExceptionsFilter,
// the same mechanism already proven correct by JwtAuthGuard/PermissionsGuard.
// See docs/qa/phase-5-hardening-understanding-check.md B3.
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    // Only mutating requests carry CSRF risk — a GET can't change server
    // state, so there's nothing for a forged cross-origin request to do.
    if (SAFE_METHODS.has(request.method)) {
      return true;
    }

    const cookieToken = request.cookies?.[CSRF_COOKIE_NAME] as string | undefined;
    const headerToken = request.headers[CSRF_HEADER_NAME] as string | undefined;

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new ForbiddenException('Missing or invalid CSRF token');
    }

    return true;
  }
}
