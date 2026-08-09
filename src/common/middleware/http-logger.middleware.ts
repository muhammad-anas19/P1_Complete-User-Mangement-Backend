import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

// One line per request, independent of whatever any individual route
// handler logs — the standard "access log" every production HTTP service
// has. Logged on `finish`, not on entry, so the real status code and
// duration are known. See docs/qa/phase-13-logging-understanding-check.md Q5.
@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      const message = `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms - ${req.ip}`;

      if (res.statusCode >= 500) {
        this.logger.error(message);
      } else if (res.statusCode >= 400) {
        this.logger.warn(message);
      } else {
        this.logger.log(message);
      }
    });

    next();
  }
}
