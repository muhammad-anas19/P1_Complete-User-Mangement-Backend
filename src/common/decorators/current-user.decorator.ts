import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserPayload {
  id: string;
  email: string;
  role: string;
}

// Reads request.user, populated by JwtStrategy.validate() after JwtAuthGuard
// has verified the access_token cookie. See
// docs/qa/phase-3-cookie-auth-understanding-check.md Q9.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const request = ctx.switchToHttp().getRequest<{ user: CurrentUserPayload }>();
    return request.user;
  },
);
