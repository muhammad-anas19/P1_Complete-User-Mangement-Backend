import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { instanceToPlain } from 'class-transformer';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

// Wraps every success response as { success, data, timestamp } — the exact
// ApiEnvelope<T> shape the frontend's fetchClient.ts already expects (see
// docs/design.md Section 1). instanceToPlain() runs here, explicitly, before
// wrapping — this is what strips @Exclude()'d fields (e.g. User.passwordHash)
// in one controlled step, rather than relying on a second global
// ClassSerializerInterceptor and having to reason about interceptor
// ordering. Skips /health/* — those keep Terminus's own standard shape,
// since they're an ops contract, not part of the frontend-facing API.
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ path?: string; url?: string }>();
    const path = request.path ?? request.url ?? '';

    if (path.startsWith('/health')) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => ({
        success: true,
        data: instanceToPlain(data),
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
