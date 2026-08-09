# Phase 13 — Understanding Check: Production-Grade Logging

> Same format as the rest of `qa/` — written directly, before the code, doubling as the design spec.

---

## Q1 — Why not just keep using Nest's built-in `Logger`?

Every service already calls `new Logger(ClassName.name)` and `this.logger.log(...)` (e.g. `UsersService`, `RolesService`) — that's Nest's built-in console logger, and it works, but it has exactly one output: stdout, which is:
- **Lost on restart.** `nest start --watch` recompiling, a crash, a redeploy — anything that restarts the process throws away everything that was ever logged. There's no record of what happened five minutes before a crash unless a terminal happened to still have that scrollback.
- **Unstructured.** Nest's default console format is colorized text meant for a human watching a terminal in real time, not for a file that might later be grepped, shipped to a log aggregator, or parsed by a script asking "how many 500s did we serve yesterday."
- **All-or-nothing.** There's no separate place to look for just the errors — they're interleaved with every info-level line in the same stream.

Winston is a full-featured logging library that solves exactly this: multiple **transports** (a console transport for humans watching live, a **file transport** for a permanent on-disk record) can run simultaneously off the same log calls, each with its own format and its own minimum level.

## Q2 — Why one file *per day*, not one growing file forever

A single `app.log` that never rotates has two failure modes in a real deployment: it grows without bound (eventually filling the disk), and finding "what happened on August 3rd" means grepping a multi-gigabyte file by timestamp. `winston-daily-rotate-file` solves both: at midnight (or when `maxSize` is hit, whichever comes first) it closes the current file and starts a new one named with that day's date (`application-2026-08-09.log`), optionally gzipping the finished file (`zippedArchive`) and deleting files older than a retention window (`maxFiles: '14d'`). "Today's log" is always a small, recent, easy-to-tail file; history is still there, just compressed and dated.

## Q3 — Why a *separate* error-only file, in addition to the combined one

`application-%DATE%.log` gets every level (`info` and above) — the full narrative of what the app did. A second transport, `error-%DATE%.log`, is configured with `level: 'error'`, so only `logger.error(...)` calls land there. This is a standard production pattern: when something goes wrong at 3am, the on-call person greps the small error-only file first, not the much larger combined log with every routine request mixed in.

## Q4 — What `nest-winston` actually bridges

Winston on its own has no idea what a Nest `Logger` context ("UsersService", "RolesController") is — that's Nest's own concept. `nest-winston`'s `WinstonModule.createLogger(options)` returns a `LoggerService` (Nest's own logger interface) backed by a real `winston.Logger` underneath, and passing it as the `logger` option to `NestFactory.create(AppModule, { logger })` replaces Nest's default console logger app-wide. Every existing `new Logger(ClassName.name)` call site — none of which need to change — now routes through Winston instead, which is what actually gets the daily-rotated files without touching a single existing `this.logger.log(...)` call in `UsersService`/`RolesService`/etc.

`nest-winston`'s `utilities.format.nestLike(appName, { colors: true })` reproduces Nest's familiar colorized console format for the console transport specifically, so local development still looks the same as before — only the file transports use a different (JSON) format, since JSON is what should actually go to disk (structured, greppable, parseable by log tooling later), not colorized text.

## Q5 — What the HTTP access-log middleware adds on top

The service-level `logger.log(...)` calls that already exist are all *business* events (an invite was sent, a role changed). Nothing currently records the more basic fact "a request came in and here's what happened to it" — method, path, status code, how long it took, who from. `HttpLoggerMiddleware` (applied globally via `AppModule.configure()`) logs exactly one line per request, on `res.on('finish')` (after the response is actually sent, so the real status code and duration are known) — the standard "access log" every production HTTP service has, independent of whatever any individual route handler chose to log.

## Q6 — What's a disclosed simplification here, not a gap

No log shipping to an external aggregator (Datadog, ELK, CloudWatch) — that's a real production step but requires an actual external service to ship to, which is out of scope for local dev. The daily-rotated files on local disk are the deliverable; wiring a shipper later would mean adding one more Winston transport, not restructuring anything here. Also no request-body logging — logging full request bodies would risk writing passwords/tokens straight to disk in plaintext, which is a real security anti-pattern, not an oversight to fix later.
