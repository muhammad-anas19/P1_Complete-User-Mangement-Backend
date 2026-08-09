# Phase 5 Code Walkthrough: Rate Limiting, CSRF, Audit Logging

> Companion to [qa/phase-5-hardening-understanding-check.md](../qa/phase-5-hardening-understanding-check.md). Same format as prior walkthroughs. Three independent features this phase — each gets its own part.

---

# Part 1 — New Building Blocks

## `APP_GUARD` — the first truly *global* guard in this project

Every guard so far (`JwtAuthGuard`, `PermissionsGuard`, `CsrfGuard`) was applied per-controller via `@UseGuards(...)`. `ThrottlerGuard` is different: it's registered once, in `AppModule`, via Nest's special `APP_GUARD` injection token:
```ts
providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }]
```
This makes it run on **every route in the entire app**, automatically, including any controller added in a future phase — no one has to remember to add `@UseGuards(ThrottlerGuard)` anywhere. `@SkipThrottle()` (on `HealthController`) and `@Throttle({...})` (on specific `AuthController` methods) are the two escape hatches for overriding this global default per-route.

## Named throttlers and `@Throttle({ default: {...} })`

`@nestjs/throttler` (this installed version) configures one or more *named* rate-limit policies: `ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 100 }])`. `@Throttle({ default: { limit: 5, ttl: 60000 } })` on a specific route overrides just the `'default'`-named policy's numbers for that route only — the name has to match between the module config and the decorator for the override to apply to the right policy.

## `ThrottlerException`

A regular `HttpException` subclass the guard throws internally when a tracked IP exceeds its limit — this is *why* no special-case code was needed in `AllExceptionsFilter` for rate-limit rejections; they're caught by the exact same `exception instanceof HttpException` branch every other thrown error already goes through.

## Double-submit CSRF cookie (mechanism, not a library)

Nothing new NestJS-wise here beyond what Phase 4 already used (`SetMetadata`/`Reflector`/`CanActivate`) — this is the same `PermissionsGuard` shape, applied to a different check. What's new is the *security pattern* itself: a value that must arrive through two independent channels (a cookie the browser attaches automatically, and a header only same-origin JS can set) before a request is trusted. See the qa doc's B1/B2 for the full reasoning; this doc focuses on the code.

## `jsonb` columns

`AuditLog.metadata` is the first `jsonb` column in this project — a real Postgres JSON column, queryable with Postgres's own JSON operators if needed later, used here just to store a small, action-specific object (e.g. `{ fromRoleId, toRoleId }`) without needing a rigid, separate column per possible audit-event shape.

---

# Part 2 — File-by-File Walkthrough

## 1. `src/app.module.ts`

```ts
ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 100 }]),
// ...
providers: [
  { provide: APP_GUARD, useClass: ThrottlerGuard },
],
```
`useClass`, not `useValue` — this tells Nest's DI container to *construct* `ThrottlerGuard` itself (resolving whatever `ThrottlerGuard`'s own constructor needs, including the throttler options just configured above), rather than handing it an already-built instance. This is the same DI mechanism as every other provider in this project, just registered under the special `APP_GUARD` token that Nest's core recognizes as "run this globally."

## 2. `src/modules/health/health.controller.ts`

```ts
@SkipThrottle()
@Controller('health')
export class HealthController { ... }
```
One decorator, applied at the class level so it covers both `/health/live` and `/health/ready`. Verified live: hammering `/health/live` ten times in immediate succession never produced a `429`, while the same volume of requests to `/auth/login` triggered one after the 5th.

## 3. `src/common/guards/csrf.guard.ts` and `src/common/decorators/skip-csrf.decorator.ts`

Structurally identical pattern to `PermissionsGuard`/`@RequirePermissions()` from Phase 4 — a `SetMetadata`-based decorator, read back via `Reflector.getAllAndOverride()`. The actual check:
```ts
if (SAFE_METHODS.has(request.method)) return true;   // GET/HEAD/OPTIONS never at risk

const cookieToken = request.cookies?.[CSRF_COOKIE_NAME];
const headerToken = request.headers[CSRF_HEADER_NAME];

if (!cookieToken || !headerToken || cookieToken !== headerToken) {
  throw new ForbiddenException('Missing or invalid CSRF token');
}
```
Plain string equality — no hashing, no DB lookup, no crypto at all. That's correct and sufficient for this pattern: the security doesn't come from the comparison being expensive to defeat, it comes from an attacker being structurally unable to *read* the cookie value in the first place (qa doc B2) — by the time both values are sitting in front of the server, a simple `===` is all that's needed.

Verified live, all four cases: no header → `403`; wrong header value → `403`; correct header → request proceeds normally (`201` on a create); a `GET` request → proceeds with **no** header needed at all.

## 4. `src/modules/auth/token.service.ts` — `generateCsrfToken()`

```ts
generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}
```
No hashing, unlike `generateRawToken()` for refresh tokens — this value is never stored anywhere server-side to compare against later; the cookie *is* the only copy of record, and the header is just asked to match it. There's nothing to hash against.

## 5. `src/modules/auth/auth.controller.ts`

```ts
@Controller('auth')
@UseGuards(CsrfGuard)
export class AuthController {
  @SkipCsrf()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(...) { ... }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('refresh')
  async refresh(...) { ... }
```
`login()` is the *only* method with `@SkipCsrf()` — `refresh()` and `logout()` are both mutating, cookie-authenticated actions and get the full CSRF check like everything else. Both `login` and `refresh` additionally get the stricter `@Throttle()` override — `logout` deliberately does not, since repeatedly logging out isn't a meaningful attack surface the way repeated login/refresh attempts are.

```ts
res.cookie(CSRF_COOKIE_NAME, this.tokenService.generateCsrfToken(), {
  httpOnly: false,   // <-- the one deliberate exception in this whole file
  secure: isProd,
  sameSite: 'lax',
  path: '/',
  maxAge: this.tokenService.getAccessTokenMaxAgeMs(),
});
```
Set alongside `access_token`/`refresh_token` on every login and refresh (a fresh CSRF token each time, tied to the access token's lifetime) and explicitly cleared in `clearAuthCookies()` on logout. Verified live: curl's own cookie jar file marks `access_token`/`refresh_token` with the `#HttpOnly_` prefix it uses for httpOnly cookies, and `csrf_token` without it — confirming the flag is actually different on this one cookie, not just claimed to be in a comment.

## 6. `src/modules/audit/entities/audit-log.entity.ts`, `audit.service.ts`, `audit.module.ts`

```ts
@Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
actorUserId: string | null;
```
Plain `uuid` column — no `@ManyToOne(() => User)`, no `@JoinColumn()`. Contrast this directly with `User.roleId`/`RefreshToken.userId`, both of which *do* have a real relation decorator and a real FK. This is the concrete implementation of `BE-DEC-015` (qa doc C1): the column stores a UUID value that *happens* to correspond to a user, without Postgres ever enforcing that correspondence — so nothing about deleting, restoring, or modifying a `User` row can ever fail, cascade, or be blocked because of something in `audit_logs`.

```ts
async record(entry: RecordAuditEntry): Promise<void> {
  await this.auditLogRepo.save(this.auditLogRepo.create({ ...entry, targetId: entry.targetId ?? null, metadata: entry.metadata ?? null }));
}
```
One small, generic method — deliberately not entity-specific (no `recordUserDeletion()`, `recordRoleChange()`, etc.). Callers state the specifics (`action`, `targetType`, `metadata`) explicitly; the service's only job is "write this fact down," matching qa doc C3's reasoning for keeping this in `UsersService`'s own methods rather than a generic route-watching interceptor.

## 7. `src/modules/users/users.service.ts` — the actual call sites

```ts
async update(id: string, dto: UpdateUserDto, actorUserId: string): Promise<User> {
  const user = await this.findOne(id);
  const previousRoleId = user.roleId;
  // ...
  const saved = await this.usersRepo.save(user);

  if (dto.roleId && dto.roleId !== previousRoleId) {
    await this.auditService.record({
      actorUserId, action: 'user.role_changed', targetType: 'User', targetId: id,
      metadata: { fromRoleId: previousRoleId, toRoleId: dto.roleId },
    });
  }
  return saved;
}
```
`previousRoleId` is captured **before** `Object.assign(user, dto)` overwrites it — an easy mistake would be reading `user.roleId` *after* the assignment, which would just report the new value as both "from" and "to." The `dto.roleId !== previousRoleId` check is what keeps this from logging an entry on every single update — editing someone's `name` alone produces no audit entry at all, only an actual role change does, exactly matching "record meaningful business events," not "record that PATCH happened."

`remove()` records unconditionally, after the soft-delete and token-revocation both succeed — deletion is *always* a meaningful event, unlike a generic field edit.

## 8. `src/modules/users/users.controller.ts` — where `actorUserId` actually comes from

```ts
update(
  @Param('id', ParseUUIDPipe) id: string,
  @Body() dto: UpdateUserDto,
  @CurrentUser() currentUser: CurrentUserPayload,
) {
  return this.usersService.update(id, dto, currentUser.id);
}
```
`@CurrentUser()` — the exact same decorator built in Phase 3, reading `request.user` (populated by `JwtAuthGuard`/`JwtStrategy`) — is what makes "who performed this action" available at all. This is precisely why the acting user's id has to be threaded through as an explicit parameter from controller to service, rather than the service somehow "knowing" who's calling it: `UsersService` has no access to the HTTP request at all (by design, per `rules.md`'s "services never touch Request/Response" rule) — the controller is the only layer that can see `request.user`, so it's the controller's job to pass that one piece of information down explicitly.

---

## Recap: one request, all three Phase 5 features in play

```
Admin changes a user's role: PATCH /users/:id  { roleId: "..." }
  → ThrottlerGuard (global): under the general 100/60s limit → proceeds
  → CsrfGuard: cookie/header match → proceeds
  → JwtAuthGuard: valid access_token → request.user populated
  → PermissionsGuard: Admin has users:update → proceeds
  → ValidationPipe: UpdateUserDto shape valid → proceeds
  → UsersController.update() reads @CurrentUser() → calls service with actorUserId
  → UsersService.update():
      - looks up user, captures previousRoleId
      - validates new roleId exists
      - saves the change
      - roleId actually changed → AuditService.record({actorUserId, action:'user.role_changed', ...})
  → ResponseEnvelopeInterceptor wraps the updated user → { success: true, data: {...}, timestamp }
```

Five independent checks, one meaningful audit entry, verified end-to-end against the real running app, real Postgres, and real cookies — not just reasoned through. See `qa/learning-topics-tracker.md` for the full verification list, including a genuine debugging detour this phase (a shell-backgrounding/output-buffering issue that looked exactly like an application hang until isolated properly).
