# Phase 3 Code Walkthrough: Login, Logout, Refresh

> **What this doc is, vs. the other Phase 3 doc:** [qa/phase-3-cookie-auth-understanding-check.md](../qa/phase-3-cookie-auth-understanding-check.md) explains the *concepts* before any code existed (why rotation works this way, why a fast hash, etc.). **This doc explains the actual code that resulted** — file by file, decorator by decorator, with what each piece does, which NestJS/TypeORM building block it's an example of, and why it's written the way it is. Read it with the real files open side by side.
>
> **Suggested order:** read Part 1 once as a glossary, then read Part 2 in the order given — it's the same "trace one request end-to-end" order as `main.ts` → `app.module.ts` → controller → service → strategy, not alphabetical.

---

# Part 1 — NestJS Building Blocks Used This Phase

## Decorators, in general

A decorator (`@Something()`) is a function that runs at class-definition time and attaches **metadata** to a class, method, or parameter — it doesn't run "as part of" your business logic. Nest reads this metadata later (via a library called `reflect-metadata`, already a dependency) to decide things like "which class should handle `POST /auth/login`" or "what should be injected into this constructor." Nothing about a decorator is magic — it's just data attached to code, read by a framework.

## `@Injectable()` and Dependency Injection (DI)

Marks a class as something Nest's DI container is allowed to construct and hand out. When another class asks for it in its constructor (e.g. `constructor(private passwordService: PasswordService)`), Nest — not the class itself — decides what instance to create and pass in. This is why `AuthService` never writes `new PasswordService()` anywhere. The direct payoff (covered in Phase 1 Q2, exercised for real this phase): a unit test can swap in a fake `PasswordService` without touching `AuthService`'s code at all.

## `@Module({...})`

A metadata block listing what a chunk of the app owns: `controllers` (HTTP entry points), `providers` (injectable services, guards, strategies), `imports` (other modules whose *exported* providers this module wants to use), `exports` (which of this module's own providers other modules are allowed to use). `AuthModule` is the main new one this phase.

## `@Controller('auth')`, `@Post()`, `@Get()`, `@HttpCode()`

`@Controller('auth')` means every route inside is prefixed `/auth`. `@Post('login')`/`@Get('me')` map an HTTP verb + path to a method. `@HttpCode(HttpStatus.OK)` overrides Nest's default (`201 Created` for `POST`) — login/refresh/logout all return `200 OK` since nothing is being "created" from the client's perspective.

## `@Body()`, `@Req()`, `@Res({ passthrough: true })`

These pull pieces of the raw HTTP request into your method's parameters. `@Body()` gives you the parsed, DTO-validated request body. `@Req()` gives you the raw Express `Request` (used here to read `req.cookies` and `req.ip`). `@Res({ passthrough: true })` gives you the raw Express `Response` **while telling Nest you still want it to auto-send whatever your method returns** — without `passthrough: true`, injecting `@Res()` makes Nest assume *you* will call `res.send()` yourself, silently breaking `return user;`.

## Custom parameter decorators — `createParamDecorator`

`@CurrentUser()` isn't built into Nest — it's defined once (`current-user.decorator.ts`) using `createParamDecorator`, which lets you extract anything from the request context and hand it to a controller method as a plain parameter. It exists purely so controllers never write `request.user` by hand.

## Guards — `CanActivate`, `@UseGuards()`

A Guard runs **before** the route handler and answers one yes/no question: "is this request allowed to proceed?" `JwtAuthGuard` (this phase) answers "does this request have a valid access token?" — if no, it throws `401` itself and the controller method never runs at all. `@UseGuards(JwtAuthGuard)` on `/auth/me` is what wires it in.

## Interceptors and Filters (recap, now with real code behind them)

- **Interceptor** (`ResponseEnvelopeInterceptor`) wraps around the handler call — it can transform what comes *out* the other side. Applied globally in `main.ts`.
- **Exception Filter** (`AllExceptionsFilter`) catches anything *thrown*, anywhere, and decides what the client actually sees. Also global.

## Passport `Strategy` pattern

`JwtStrategy extends PassportStrategy(Strategy, 'jwt')` is Nest's wrapper around the industry-standard Passport.js library. A "strategy" is just an object that knows how to (1) find a credential in the request and (2) validate it. `JwtAuthGuard` doesn't contain any JWT logic itself — it just tells Passport "run the strategy named `'jwt'`."

---

# Part 2 — File-by-File Walkthrough

## 1. `src/main.ts` — bootstrap changes this phase

```ts
app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
app.useGlobalFilters(new AllExceptionsFilter());
```

**What:** registers the two classes above so they run for *every* request in the whole app, not just auth routes.
**Why here, not per-controller:** `design.md` Section 1 wants the envelope shape guaranteed "by construction" — if you had to remember to add `@UseInterceptors()` to every future controller, someone eventually forgets, and that one controller silently breaks the frontend's contract. Doing it globally in `main.ts` means a brand-new controller gets the correct shape for free, with zero extra code.

---

## 2. `src/app.module.ts` — one new line

```ts
AuthModule,
```

Just registers the whole auth feature module into the app's dependency graph. Nothing else needed here — everything else lives inside `AuthModule` itself (see file 13).

---

## 3. `src/common/interceptors/response-envelope.interceptor.ts`

```ts
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
```

- **`implements NestInterceptor`**: the contract Nest requires — one method, `intercept()`.
- **`context: ExecutionContext`**: a generic wrapper Nest passes to guards/interceptors/filters alike, giving access to the underlying HTTP request/response regardless of transport (HTTP here, but the same interface works for WebSockets/RPC too — you don't need that, just know why the API looks the way it does).
- **`next.handle()`**: calling this is what actually lets the request continue — first through any inner interceptors, then to your controller method. It returns an RxJS `Observable` of whatever the handler eventually returns.
- **The `/health` early return**: skips the transform entirely for health-check routes, so `next.handle()` returns straight through, unmodified — this is the "narrow, disclosed exception" from `BE-DEC-009` in `design.md`.
- **`.pipe(map(...))`**: RxJS's way of saying "when the handler's result arrives, transform it like this before it goes further." This is where the actual envelope wrapping happens.
- **`instanceToPlain(data)`**: from `class-transformer`. Walks the returned object (e.g. a `User` entity instance) and strips any field marked `@Exclude()` — this is the *one place* `passwordHash` actually gets removed. Calling it explicitly here (rather than relying on a second global `ClassSerializerInterceptor` and hoping interceptor ordering works out) is a deliberate simplicity choice — see the reasoning in `qa/phase-3-...md` "Implementation Notes."

---

## 4. `src/common/filters/all-exceptions.filter.ts`

```ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (request.path?.startsWith('/health')) {
      if (exception instanceof HttpException) {
        response.status(exception.getStatus()).json(exception.getResponse());
      } else {
        response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ status: 'error' });
      }
      return;
    }

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    // ... builds `message`, then:
    response.status(status).json({ success: false, message, timestamp: new Date().toISOString() });
  }
}
```

- **`@Catch()` with no argument**: catches *every* thrown exception, of any type — a more specific filter could say `@Catch(HttpException)` to only catch that one kind. We want the safety net to be total, since an *uncaught* error would otherwise let Express's default handler leak a raw stack trace to the client.
- **`ArgumentsHost`**: same idea as `ExecutionContext` (a transport-agnostic wrapper); `.switchToHttp()` narrows it down to "give me the actual Express request/response objects."
- **Why the health-route branch reconstructs the response manually instead of calling `next()`**: filters don't chain the way interceptors do — this is the outermost, last-resort handler. Forwarding `exception.getResponse()` and `exception.getStatus()` as-is preserves Terminus's own well-formed health-check error shape untouched.
- **`exception instanceof HttpException`**: distinguishes "a deliberate error the app threw on purpose" (e.g. `throw new UnauthorizedException(...)` in `AuthService`) from "something genuinely broke" (a real bug, a DB connection drop) — only the latter gets logged as a server-side error and shown a generic `"Internal server error"` message, per `design.md` Section 6's "5xx errors never leak internals" rule.

---

## 5. `src/common/decorators/current-user.decorator.ts`

```ts
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const request = ctx.switchToHttp().getRequest<{ user: CurrentUserPayload }>();
    return request.user;
  },
);
```

`createParamDecorator` is a Nest factory function — you give it a function `(data, ctx) => value`, and it hands you back a new decorator (`@CurrentUser()`) usable on any controller method parameter. Whatever the function returns becomes the parameter's value. Here, it just reads `request.user` — the exact property `JwtStrategy.validate()` populated (file 9) after `JwtAuthGuard` (file 6) ran. This decorator exists purely so `AuthController.me()` can write `@CurrentUser() currentUser: CurrentUserPayload` instead of `@Req() req` + manually reading `req.user` and casting its type every time.

---

## 6. `src/common/guards/jwt-auth.guard.ts`

```ts
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

This entire file is one line of actual logic because `@nestjs/passport`'s `AuthGuard('jwt')` already implements everything a Guard needs — extending it with an empty body just gives it a proper class name you can reference in `@UseGuards(JwtAuthGuard)` and a place to add custom behavior later (e.g. overriding `handleRequest()` to customize the error) if ever needed. `'jwt'` here is a string key — it must match the second argument passed to `PassportStrategy(Strategy, 'jwt')` in `jwt.strategy.ts`, which is how Nest knows *which* registered strategy this guard should run.

---

## 7. `src/modules/auth/dto/login.dto.ts`

```ts
export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}
```

A DTO (Data Transfer Object) is just a plain class describing the *shape* of an expected request body, decorated with `class-validator` rules. The global `ValidationPipe` (set up in Phase 1's `main.ts`) automatically checks any incoming body typed as a DTO against these decorators **before** the controller method body ever runs — a malformed request (missing password, invalid email format) never reaches `AuthController.login()` at all; it gets rejected with a `400` automatically.

---

## 8. `src/modules/auth/password.service.ts`

```ts
const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=19456,p=1,t=2$...';

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }
  verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain);
  }
}
```

- **Why the options object is a module-level constant, not inline in each call**: one single place controls the cost parameters for every hash/verify in the whole app — see `qa/phase-3-...md` Q1 for what each parameter (`memoryCost`/`timeCost`/`parallelism`) actually controls.
- **Why `DUMMY_PASSWORD_HASH` is exported and precomputed, not generated at request time**: it needs to be a *real*, validly-formatted Argon2id hash (so `argon2.verify()` runs its full, real computation against it) but of a value nobody could ever have as an actual password. Precomputing it once means every "user doesn't exist" login attempt still pays the same real computational cost as a genuine wrong-password attempt — this is the timing-attack mitigation from `qa/phase-3-...md` Q3, and you can see exactly where it gets used in file 10 (`auth.service.ts`).
- **Why this is its own tiny class instead of `AuthService` calling `argon2` directly**: DI/testability, per Q2 — `AuthService`'s unit tests (Phase 7) will inject a fake `PasswordService` instead of running real, deliberately-slow cryptography thousands of times in a test suite.

---

## 9. `src/modules/auth/token.service.ts`

The biggest file this phase — it's the only place that touches the `refresh_tokens` table.

```ts
signAccessToken(user: User): string {
  return this.jwtService.sign({ sub: user.id, email: user.email, role: user.role.name });
}
```
`this.jwtService` is `@nestjs/jwt`'s `JwtService`, configured (in `auth.module.ts`, file 13) with the secret and expiry from `.env`. `.sign()` builds and signs the JWT in one call — you never touch the raw signing algorithm yourself.

```ts
private hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
private generateRawToken(): string {
  return randomBytes(64).toString('hex');
}
```
Both from Node's built-in `crypto` module — no extra dependency needed. `randomBytes(64)` generates 512 bits of cryptographically-secure randomness for the raw refresh token value (this is what the browser holds in its cookie); `createHash('sha256')` is what gets *stored* in the `refresh_tokens.token_hash` column instead — see `qa/phase-2-...md` Q4 and `qa/phase-3-...md` Q4 for why a fast hash (not Argon2id) is correct here.

```ts
async rotate(rawToken: string, meta: RequestMeta) {
  const tokenHash = this.hashToken(rawToken);
  const existing = await this.refreshTokenRepo.findOneBy({ tokenHash });

  if (!existing) throw new UnauthorizedException('Invalid session');

  if (existing.revokedAt) {
    await this.refreshTokenRepo.update(
      { familyId: existing.familyId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    throw new UnauthorizedException('Session revoked — please sign in again');
  }

  if (existing.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedException('Session expired — please sign in again');
  }

  return this.dataSource.transaction(async (manager) => {
    const repo = manager.withRepository(this.refreshTokenRepo);
    await repo.update(existing.id, { revokedAt: new Date() });
    const raw = this.generateRawToken();
    const entity = repo.create({ /* new row, same familyId */ });
    await repo.save(entity);
    return { raw, entity, userId: existing.userId };
  });
}
```
This is the literal implementation of the rotation/reuse-detection design from `qa/phase-2-...md` Q4 and `qa/phase-3-...md` Q7/Q8 — the ordering of the three `if` checks (not-found → already-revoked → expired) is not arbitrary, it's "theft signal takes priority over normal expiry." `IsNull()` is a TypeORM query operator — `{ revokedAt: IsNull() }` in a `where`-style clause means "only rows where this column is actually `NULL`," which you can't express with a plain `{ revokedAt: null }` object in TypeORM's `update()` conditions. `this.dataSource.transaction(async (manager) => {...})` wraps the "revoke old + insert new" pair so they commit together atomically — `manager.withRepository(this.refreshTokenRepo)` gives you a repository bound to *this transaction* specifically, so both operations inside the callback are part of the same all-or-nothing unit.

---

## 10. `src/modules/auth/auth.service.ts`

```ts
async login(dto: LoginDto, meta: RequestMeta): Promise<AuthResult> {
  const user = await this.usersRepo.findOne({ where: { email: dto.email } });

  const hashToCompare = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const passwordMatches = await this.passwordService.verify(hashToCompare, dto.password);

  if (!user || !user.passwordHash || !passwordMatches) {
    throw new UnauthorizedException('Invalid email or password');
  }
  // ...
}
```
This is where Q3's timing-attack reasoning becomes actual code: `hashToCompare` is *always* a real hash — either the genuine user's, or the fixed dummy — so `passwordService.verify()` always runs, whether or not `user` exists. Notice the three-part `if` at the end: **all three failure modes throw the exact same exception type with the exact same message** — "no user," "user has no password yet" (an invited-but-not-activated account), and "wrong password" are indistinguishable from the response.

```ts
async me(userId: string): Promise<User> {
  return this.usersRepo.findOneByOrFail({ id: userId });
}
```
`findOneByOrFail` is a TypeORM repository method that throws automatically if nothing matches, instead of returning `null` and forcing you to check — used here because `userId` always comes from an already-validated JWT (`request.user.id`), so "not found" would mean something is *actually* wrong (e.g. the user was deleted after the token was issued), not an expected outcome to handle gracefully.

---

## 11. `src/modules/auth/strategies/jwt.strategy.ts`

```ts
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

  validate(payload: AccessTokenPayload): CurrentUserPayload {
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
```
The `super({...})` call configures the underlying `passport-jwt` library: `jwtFromRequest` is the custom cookie extractor from `qa/phase-3-...md` Q9 (replacing the library's header-reading default); `ignoreExpiration: false` means an expired token is rejected automatically (you never manually check `exp`); `secretOrKey` is what the signature gets verified against. **You never call `validate()` yourself** — Passport calls it internally, only after it has already successfully extracted and cryptographically verified the token. Whatever `validate()` returns becomes `request.user`, which is exactly what `@CurrentUser()` (file 5) later reads.

---

## 12. `src/modules/auth/auth.controller.ts`

```ts
@Post('login')
@HttpCode(HttpStatus.OK)
async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
  const { user, accessToken, refreshToken } = await this.authService.login(dto, {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });
  this.setAuthCookies(res, accessToken, refreshToken);
  return user;
}
```
Notice the controller does almost nothing itself — it converts HTTP concerns (the DTO, the request metadata, setting cookies) into a plain call to `authService.login()`, and converts the plain result back into HTTP concerns (cookies + a return value Nest sends as JSON via the global interceptor). This thinness is deliberate — see `rules.md` Section 2, "controllers stay thin."

```ts
@Get('me')
@UseGuards(JwtAuthGuard)
async me(@CurrentUser() currentUser: CurrentUserPayload) {
  return this.authService.me(currentUser.id);
}
```
The only route this phase with `@UseGuards()` — everything explained in files 5, 6, 11 converges here: `JwtAuthGuard` runs `JwtStrategy` → populates `request.user` → `@CurrentUser()` reads it → handed to the method as a typed parameter.

```ts
private setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie('access_token', accessToken, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/', maxAge: ... });
  res.cookie('refresh_token', refreshToken, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/auth', maxAge: ... });
}
```
Two private helper methods (`setAuthCookies`/`clearAuthCookies`), not decorated, not routes — plain methods used by `login`/`refresh` and `logout` respectively, so the exact cookie configuration lives in exactly one place instead of being copy-pasted across three route handlers. `path: '/auth'` on the refresh cookie is the corrected value from the real bug found during testing — see the walkthrough's sibling doc for the full story.

---

## 13. `src/modules/auth/auth.module.ts`

```ts
@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([RefreshToken]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService) => ({
        secret: configService.get('jwt.accessSecret', { infer: true }),
        signOptions: { expiresIn: configService.get('jwt.accessExpiresIn', { infer: true }) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, JwtStrategy],
})
export class AuthModule {}
```
This is the file that makes everything above actually reachable by the DI container:
- **`imports: [UsersModule, ...]`**: `AuthService` needs to inject the `User` repository; it's only available because `UsersModule` explicitly `exports: [TypeOrmModule]` (set up back in Phase 2) — importing `UsersModule` here is what makes that legal.
- **`TypeOrmModule.forFeature([RefreshToken])`**: this is the line that finally makes `RefreshToken` injectable via `@InjectRepository(RefreshToken)` in `TokenService` — until this phase, the entity existed in the database (Phase 2's migration) but wasn't wired into Nest's DI at all.
- **`JwtModule.registerAsync({...})`**: configures `@nestjs/jwt`'s `JwtService` (used in `TokenService.signAccessToken()`) with the secret/expiry read from your typed config — `registerAsync` (vs. plain `.register()`) is needed specifically because the values come from `ConfigService`, which itself needs to be injected and awaited during module setup, not known synchronously up front.
- **`providers: [AuthService, PasswordService, TokenService, JwtStrategy]`**: every class in this module that Nest's DI container needs to know how to construct. `JwtStrategy` is listed here (not `controllers`) because it's not a route handler — it's a provider that `PassportModule` discovers and registers as the `'jwt'` strategy at startup.

---

## Recap: how it all connects, one more time

```
POST /auth/login
  → main.ts's global ValidationPipe checks LoginDto
  → AuthController.login()
      → AuthService.login()
          → PasswordService.verify() (real hash, real or dummy)
          → TokenService.signAccessToken() + issueRefreshToken()
      → AuthController sets both cookies via res.cookie()
      → returns `user` (plain object)
  → main.ts's global ResponseEnvelopeInterceptor wraps it: { success, data, timestamp }
  → (if anything above had thrown) main.ts's global AllExceptionsFilter would have
    caught it and produced { success: false, message, timestamp } instead

GET /auth/me
  → JwtAuthGuard runs JwtStrategy: extract access_token cookie → verify signature/expiry
      → JwtStrategy.validate(payload) → becomes request.user
  → AuthController.me(@CurrentUser() currentUser) reads request.user
  → AuthService.me(currentUser.id) → real DB lookup
  → same global interceptor/filter wrapping as above
```
