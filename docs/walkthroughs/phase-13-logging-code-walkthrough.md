# Phase 13 Code Walkthrough: Production-Grade Logging

> Companion to `docs/qa/phase-13-logging-understanding-check.md`.

## `winston.config.ts` — three transports, one format split

```ts
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);
```
Every file transport uses this — structured JSON, one object per line, `errors({ stack: true })` making sure an `Error` object logged via `logger.error(err)` gets its full stack trace captured as a field rather than stringified to `"[object Object]"`.

```ts
const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    nestWinstonUtilities.format.nestLike('P1Dashboard', { colors: true, prettyPrint: true }),
  ),
});
```
The console transport gets a *different* format — `nestLike()` reproduces Nest's own colorized `[Nest] 12345 - 08/09/2026, ...` style, so `npm run start:dev`'s terminal output looks exactly like it did before this phase. Verified live: the console during `npm run start:dev` is unchanged; only the new `logs/*.log` files are new.

```ts
const combinedFileTransport = new winston.transports.DailyRotateFile({
  dirname: 'logs',
  filename: 'application-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d',
  format: fileFormat,
});

const errorFileTransport = new winston.transports.DailyRotateFile({
  // ...same shape...
  level: 'error',
});
```
Two `DailyRotateFile` transports pointed at the same `logs/` directory, differing only in `filename` and `level`. Winston runs every log call through *every* transport independently — a `logger.error(...)` call lands in `application-*.log` (level `error` passes the combined transport's default threshold) **and** `error-*.log` (level `error` passes its own `level: 'error'` threshold); a `logger.log(...)` (info level) only passes the combined transport's threshold, so it never appears in the error file at all.

Verified live: hit `GET /api/roles` unauthenticated (`401`) and `GET /api/nonexistent-route` (`404`) — both appeared in `application-2026-08-10.log` as `HTTP`-context `warn` lines; `error-2026-08-10.log` stayed empty (correctly — a 401/404 isn't a server error).

## `main.ts` — the one-line swap that redirects every existing logger call

```ts
const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  logger: WinstonModule.createLogger(winstonLoggerOptions),
});
```
This is the entire integration point. No service anywhere in the codebase changed — `UsersService`'s `private readonly logger = new Logger(UsersService.name)` and its `this.logger.log(...)` calls are Nest's own `Logger` facade, which delegates to whatever logger instance was registered at bootstrap. Swapping that one option is what made every `[MOCK EMAIL] Invite link for...` log line (from `UsersService.create()`, Phase 8) start appearing in `logs/application-*.log` alongside the console, with zero changes to `users.service.ts` itself.

## `HttpLoggerMiddleware` — logged on `finish`, not on entry

```ts
use(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const message = `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms - ${req.ip}`;
    if (res.statusCode >= 500) this.logger.error(message);
    else if (res.statusCode >= 400) this.logger.warn(message);
    else this.logger.log(message);
  });
  next();
}
```
Registered on `res.on('finish')`, not logged immediately before `next()` — at the point `use()` runs, the eventual status code and response time don't exist yet. `finish` fires once the response has actually been sent, at which point `res.statusCode` is final and `Date.now() - start` is the real end-to-end duration, including whatever the route handler and every other middleware/interceptor/guard/filter did in between.

Applied via `AppModule.configure()` (middleware), not a global interceptor — middleware runs earlier in the pipeline than interceptors/guards and, critically, still runs for requests that never match any controller route at all (a plain `404`), which an interceptor attached to controller methods would never see. Verified live: the `404` request above was logged despite hitting no controller.

## What already existed and needed no changes

`.gitignore` already had `logs`/`*.log` entries from early in the project — anticipated, never used until this phase. `AllExceptionsFilter` and `ResponseEnvelopeInterceptor` are untouched; they still shape the HTTP response the same way, independent of how that response now also gets logged.
