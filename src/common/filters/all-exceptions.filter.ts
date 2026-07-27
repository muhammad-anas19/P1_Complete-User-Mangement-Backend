import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

// Normalizes every thrown error (Nest's HttpExceptions, validation errors,
// unexpected 500s) into the same { success: false, message, timestamp }
// shape — see docs/design.md Section 6. Never leaks stack traces or raw
// error internals to the client; full detail is logged server-side only.
// Skips /health/* so Terminus's own error shape passes through untouched —
// same reasoning as ResponseEnvelopeInterceptor.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (request.path?.startsWith('/health')) {
      // Forward Terminus's own exception body/status untouched instead of
      // wrapping it — rethrowing here would bypass Nest's response cycle
      // entirely, since this is the outermost filter.
      if (exception instanceof HttpException) {
        response.status(exception.getStatus()).json(exception.getResponse());
      } else {
        this.logger.error('Unexpected error on a health route', exception as Error);
        response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ status: 'error' });
      }
      return;
    }

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = 'Internal server error';
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const bodyMessage =
        typeof body === 'string' ? body : (body as { message?: unknown }).message;
      message = Array.isArray(bodyMessage)
        ? bodyMessage.join(', ')
        : (bodyMessage as string) ?? exception.message;
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    } else {
      this.logger.error('Unknown exception thrown', String(exception));
    }

    response.status(status).json({
      success: false,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
