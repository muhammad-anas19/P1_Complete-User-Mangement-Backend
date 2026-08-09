# API & Data Design Reference

> The backend equivalent of the frontend's `design.md`. A frontend design doc governs visual tokens and component contracts; a backend has no visual surface, so this document governs the equivalent thing an API actually exposes: **response shapes, error contracts, validation rules, and DTO/entity conventions** — the "look and feel" a consumer (the frontend) actually experiences.

---

## 1. Response Envelope Rules (Non-Negotiable — Frontend-Fixed Contract)

Every controller response, success or error, must conform to what `frontend/src/lib/api/client.ts` and `fetchClient.ts` already assume (see `architecture.md` Section 5 for the exact TypeScript shapes). This is enforced globally via a `ResponseEnvelopeInterceptor` (wraps successful returns) + an `AllExceptionsFilter` (wraps thrown errors), so **individual controllers never hand-construct the envelope themselves** — they return plain data or throw a plain `HttpException`, and the interceptor/filter do the wrapping. This avoids every controller needing to remember the exact envelope shape, and guarantees consistency by construction rather than by convention.

- Controllers return the *raw* resource/data shape (e.g. a `User` object, or a `PaginatedResponse<User>`).
- Controllers throw Nest's built-in `HttpException` subclasses (`UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `BadRequestException`) with a human-readable `message` — never a raw string return for errors, never a manually-built `{ success: false }` object inline.

---

## 2. DTO & Validation Conventions

- **Every** request body is typed as a DTO class, validated via `class-validator` decorators, enforced by the global `ValidationPipe` (`whitelist: true, forbidNonWhitelisted: true` — strips/rejects unexpected fields rather than silently accepting them).
- DTOs live in each module's `dto/` folder, named `<action>-<entity>.dto.ts` (e.g. `login.dto.ts`, `create-user.dto.ts`, `update-user.dto.ts`).
- Separate DTOs for create vs. update (never reuse one DTO with all-optional fields for both) — a `CreateUserDto` requires `email`; an `UpdateUserDto` (via `PartialType(CreateUserDto)`) makes everything optional. Reusing one loose DTO for both operations is exactly the kind of shortcut that lets an invalid partial payload slip through create, so keep them distinct.
- Never trust a client-supplied `id`, `role`, `createdAt`, etc. inside a DTO for fields the server must own — DTOs only accept what the client is legitimately allowed to set (e.g. `CreateUserDto` accepts `email`/`name`/`roleId` only if the caller is an Admin, never a self-assigned `role: 'Admin'` field trusted blindly).

---

## 3. Entity Conventions

- One entity class per file: `<name>.entity.ts`, exporting a single `@Entity()`-decorated class.
- Every entity has: `id` (UUID, not auto-increment int — avoids leaking sequential record counts, e.g. "user #4" implying only 4 users exist), `createdAt`, `updatedAt` (via `@CreateDateColumn()`/`@UpdateDateColumn()`).
- **Never expose the password hash field** in any serialized response — use `class-transformer`'s `@Exclude()` on the entity's `passwordHash` field, combined with a global `ClassSerializerInterceptor`, so it's excluded by construction, not by remembering to `delete user.passwordHash` in every service method.
- Relations are explicit and match the schema described in `architecture.md` Section 4.1 (`users` ↔ `roles` ↔ `permissions`).

---

## 4. Pagination & List Query Conventions

Matches the exact contract the frontend already sends (`frontend/src/lib/api/endpoints.ts`, `PaginatedApiRequestParams`):

### Request (query params)
```
GET /users?page=1&limit=25&search=jane&sort=name_asc&role=Admin
```
- `page` — 1-indexed.
- `limit` — items per page (this backend's query param name matches the response field name — both `limit`, not `pageSize`).
- `search` — case-insensitive partial match against a defined set of searchable fields per entity (documented per-module, not global).
- `sort` — `<field>_<asc|desc>` format, parsed and validated against an explicit allow-list of sortable columns per entity (never pass the raw query string straight into a SQL `ORDER BY` — that's an injection vector).
- Entity-specific filters (`role`, `status`, `category`, etc.) — each validated against known enum values via the DTO, not accepted as arbitrary strings.

### Response
Exactly the `PaginatedResponse<T>` shape in `architecture.md` Section 5 — `data`, `total`, `page`, `limit`, `totalPages`, `hasNextPage`, `hasPreviousPage`, all always present (not optional), even when `data` is empty.

---

## 5. Cookie Design Spec

| Attribute | `access_token` | `refresh_token` |
| :--- | :--- | :--- |
| `HttpOnly` | true | true |
| `Secure` | true (prod), false (local http dev — documented exception) | same |
| `SameSite` | `Lax` | `Lax` |
| `Path` | `/` | `/auth` (see `BE-DEC-004` — narrower than `/` but must cover every auth endpoint that reads it, not just `/auth/refresh`) |
| `Max-Age` | 15 min (`JWT_ACCESS_EXPIRES_IN`) | 7 days (`JWT_REFRESH_EXPIRES_IN`) |

---

## 6. Error Message Design Rules

- **Auth failures are generic by design** — `"Invalid email or password"`, never `"User not found"` or `"Incorrect password"` separately (prevents user enumeration; see `qa/phase-0-...md` Q3 rapid-fire #4).
- **Validation failures are specific** — `class-validator`'s default messages (e.g. `"email must be a valid email"`) are fine to surface, since they help the legitimate caller (the frontend / a developer) and don't leak anything about system state.
- **5xx errors never leak internals** — no raw stack traces or SQL error text in the response body in production; log the full detail server-side, return a generic `"Internal server error"` message to the client.

---

## 7. Open Design Decisions Log

Same purpose as the frontend's log — non-trivial choices made without a formal spec review, recorded for later reconsideration.

| Decision ID | Area | Decision Made | Rationale / Tradeoff | Review Status |
| :--- | :--- | :--- | :--- | :--- |
| `BE-DEC-001` | Auth model | Role + permissions normalized tables instead of a hardcoded 3-value enum | Deliberately more than the PRD strictly requires, chosen for RBAC learning depth (see `qa/phase-0-...md` Q10) | *Confirmed by user* |
| `BE-DEC-002` | ORM | TypeORM over Prisma | Closer to Nest's native DI/repository style; keeps migrations closer to raw SQL for learning purposes (see `qa/phase-1-...md` Q5) | *Confirmed by user* |
| `BE-DEC-003` | Entity IDs | UUID primary keys instead of auto-increment integers | Prevents ID-enumeration (IDOR); full pros/cons in `qa/phase-2-...md` Q3 | *Confirmed by user* |
| `BE-DEC-004` | Refresh cookie scope | `Path=/auth` (revised from the originally planned `/auth/refresh`) | Originally scoped to `/auth/refresh` only for narrower exposure, but that silently excluded `/auth/logout` from ever receiving the cookie — logout's DB revocation step no-op'd because it never saw the token. Caught by testing the real endpoint, not just review. `/auth` is the smallest scope that covers every auth endpoint that needs it. See `qa/phase-3-...md` Q6 | *Confirmed — corrected after a real bug found during Phase 3 testing* |
| `BE-DEC-005` | Refresh token hashing | SHA-256 (fast hash), not Argon2id | Refresh tokens are high-entropy random values, not guessable passwords — nothing to slow down brute-forcing of; Argon2id here would just waste CPU on every refresh. See `qa/phase-2-...md` Q4 | *Confirmed by user* |
| `BE-DEC-006` | `refresh_tokens` rotation model | Insert a new row per refresh + mark old row `revoked_at`, never update a token value in place | Update-in-place destroys the history needed for reuse detection (Q4) | *Confirmed by user* |
| `BE-DEC-007` | `role.permissions` loading | `eager: true` on the `Role.permissions` relation | RBAC checks almost always need a role's permissions loaded alongside it; revisit if this causes unwanted permission-loading on unrelated Role queries later | *Pending review* |
| `BE-DEC-010` | RBAC enforcement granularity | `PermissionsGuard` resolves full permissions from the `roles` table per-request (`@RequirePermissions`), not JWT-embedded role-name-only checks | Exercises the normalized schema built for this reason (`BE-DEC-001`); one cheap extra query per protected request. Implemented and verified — Manager/Viewer correctly blocked from mutating endpoints, Admin allowed | *Confirmed and implemented (Phase 4)* |
| `BE-DEC-011` | `CreateUserDto` role field | `roleId: string` (UUID, validated against real `roles` rows via a service-layer existence check), never a raw `role` name string | Prevents privilege-escalation via an untrusted client-supplied role label. Implemented and verified — invalid `roleId` returns `400` | *Confirmed and implemented (Phase 4)* |
| `BE-DEC-012` | Delete response | `200 OK` + envelope body (`{ deleted: true }`), not `204 No Content` | `204` can't carry the required envelope body; consistency for the frontend contract wins over REST purism here | *Confirmed and implemented (Phase 4)* |
| `BE-DEC-013` | Rate limit values | Global `100 req/60s`; `5 req/60s` on `/auth/login` and `/auth/refresh` specifically | Disclosed, reasonable defaults, not derived from real production traffic data. `/health/*` exempted via `@SkipThrottle()`. Verified live — 6th login attempt within a minute returns `429`; `/health/live` never throttled | *Confirmed and implemented (Phase 5)* |
| `BE-DEC-014` | CSRF mechanism | Double-submit cookie: non-`httpOnly` `csrf_token` cookie + required `X-CSRF-Token` header on mutating requests, via `CsrfGuard` (a Guard, not middleware) | Implemented as a Guard specifically because Guard-thrown exceptions are already proven to flow through `AllExceptionsFilter`; middleware's exception-handling behavior was never verified. `/auth/login` exempted via `@SkipCsrf()` — no session exists yet to double-submit against. Verified live: missing/wrong header → `403`, correct header → proceeds, GET needs no header | *Confirmed and implemented (Phase 5)* |
| `BE-DEC-015` | Audit log FK strategy | No foreign keys on `audit_logs.actor_user_id` / `target_id` — plain `uuid` columns | The audit trail must outlive the lifecycle of the users/entities it references; a real FK (`RESTRICT` or `CASCADE`) would either block deleting a user who ever performed a logged action, or delete their history along with them — both wrong. See `qa/phase-5-...md` C1 | *Confirmed and implemented (Phase 5)* |
| `BE-DEC-016` | Audit log scope | Recording only (`AuditService.record()`, called explicitly from `UsersService`), no admin-facing viewer endpoint yet | Matches the existing pattern (e.g. real invite-email-sending) of explicitly deferring non-core features rather than silently skipping them. Role changes and deletions verified recorded correctly, including accurate before/after role IDs in `metadata` | *Confirmed and implemented (Phase 5)* |
| `BE-DEC-017` | Money storage | `numeric(10,2)` columns, typed `string` in TypeScript (`Product.price`, `Order.totalAmount`) | `pg` returns `numeric` as a string specifically to avoid float-precision loss; fighting that with a `number` type would reintroduce the bug the column type exists to prevent. See `qa/phase-6-7-...md` Q1 | *Confirmed and implemented (Phase 6)* |
| `BE-DEC-018` | Derived vs. stored state | `Product.stockStatus` is a getter (`@Expose()`), not a database column | A pure function of `stockQuantity` — storing it separately risks two sources of truth drifting out of sync. Verified live via `instanceToPlain()` actually including it in real API responses | *Confirmed and implemented (Phase 6)* |
| `BE-DEC-019` | `category`/line-items scope | `Product.category` is a plain indexed string, not its own entity; `Order` has no line-item relation | Disclosed simplifications — neither has independent lifecycle/behavior this project's RBAC/CRUD learning focus needs; contrast with the deliberately-over-built `roles`/`permissions` schema (`BE-DEC-001`), which had a real reason to go further | *Confirmed and implemented (Phase 6–7)* |
| `BE-DEC-020` | Product image storage | Local disk (`./uploads/products/`), served via `useStaticAssets()`, not a cloud bucket | Explicit user direction. Known limitation stated plainly: breaks across multiple app instances (separate disks) and isn't guaranteed to survive a redeploy on most hosts. Swappable for S3-compatible storage later without changing the controller's API shape | *Confirmed and implemented (Phase 6)* |
| `BE-DEC-021` | Scope amendment: signup/email-verification | Implemented `POST /auth/signup` and `POST /auth/verify-otp`, superseding the original Phase 0–5 deferral | Reading the actual frontend flow showed `verify-otp` is activation-only, never recurring MFA — implementing it doesn't actually conflict with "2FA is deferred." See `PRD.md` Section 1.4 amendment | *Confirmed and implemented (Phase 8)* |
| `BE-DEC-022` | `UserToken` design | One table, one `purpose` enum (`email_verification`\|`invite`\|`password_reset`), reused across three flows | Same philosophy as `refresh_tokens` getting its own table — avoids three near-duplicate token tables/services. `consume()` takes an optional `expectedUserId`, required for OTP (small guess space) but safely omittable for high-entropy URL tokens | *Confirmed and implemented (Phase 8)* |
| `BE-DEC-023` | Password reset blast radius | `resetPassword()` revokes **all** of a user's refresh tokens (every device), not just the requesting session | A reset implies the old password may be compromised; leaving other sessions alive would defeat the point. Verified live — a pre-reset session's next refresh returned "Session revoked" | *Confirmed and implemented (Phase 8)* |
| `BE-DEC-024` | Self-registration default role | Self-signed-up accounts default to `Viewer` | Least privilege — self-registration proves nothing about deserved access level, unlike Admin-chosen roles for provisioned users | *Confirmed and implemented (Phase 8)* |
| `BE-DEC-025` | Global API prefix | `app.setGlobalPrefix('api', { exclude: ['health/(.*)'] })` | Matches the frontend's pre-existing `NEXT_PUBLIC_API_BASE_URL` (`.../api`) — a real mismatch found during integration planning, not a preference. `/health/*` and `/uploads/*` (static, unaffected by the Nest-only prefix) verified to stay unprefixed | *Confirmed and implemented (Phase 9)* |
| `BE-DEC-026` | Swagger cookie-auth documentation | `addCookieAuth('access_token')` + `@ApiCookieAuth()` on protected controllers, with an explicit doc comment explaining the mismatch | Swagger's "Authorize" UI is built around headers; it documents which cookie is required but doesn't drive cookie auth for its own test-request tool the way it does for Bearer tokens. Verified `/docs` and `/docs-json` both work, correctly unaffected by the `/api` prefix, and every protected route's OpenAPI entry carries the `access_token` security requirement | *Confirmed and implemented (Phase 10)* |
| `BE-DEC-027` | `PartialType` source | Switched `Update*Dto` classes from `@nestjs/mapped-types` to `@nestjs/swagger`'s `PartialType` | The Swagger version is a drop-in superset that also copies `@ApiProperty` metadata into the generated schema, not just class-validator rules — free correctness improvement once Swagger existed to benefit from it | *Confirmed and implemented (Phase 10)* |
| `BE-DEC-028` | `GET /roles` endpoint | New minimal `RolesController`/`RolesService`, returning only `{id, name}[]`, gated behind `users:read` | The frontend's user create/edit forms only know role *names* (`Admin`\|`Manager`\|`Viewer`), but `CreateUserDto`/`UpdateUserDto` require a `roleId` (`BE-DEC-011`) — this closes that gap without the frontend hardcoding seed-time UUIDs. No dedicated `roles:read` permission created since there's no standalone "manage roles" feature yet | *Confirmed and implemented (Frontend Phase 3.4)* |
| `BE-DEC-029` | `save()` doesn't re-trigger eager relations | `UsersService.create()` and `.update()` (role-change branch) now explicitly assign the already-fetched `Role` entity onto `user.role`/`saved.role` before returning | Found live during Phase 3.4 frontend integration: TypeORM's `eager: true` only applies to find-family queries (`findOneBy`, `find`), not to the object returned by `.save()` — `create()` was returning a user with `role` entirely missing, and `update()` was returning a *stale* `role` object when `roleId` changed (correct `roleId` column, wrong nested `role.name`). Both would have silently shown the wrong role in the UI immediately after a create/role-change, self-correcting only on the next full list refetch | *Confirmed and fixed (Frontend Phase 3.4)* |
| `BE-DEC-030` | `csrf_token` cookie lifetime | Changed from `getAccessTokenMaxAgeMs()` (15m) to `getRefreshTokenMaxAgeMs()` (7d) in `AuthController.setAuthCookies()` | Found live by an actual idle session: `/auth/refresh` sits behind `CsrfGuard` (no `@SkipCsrf()`, since it's a mutating POST) and is specifically called *after* the access token has expired — but with the CSRF cookie sharing the access token's short maxAge, it had also already expired by that exact moment, so every real silent-refresh attempt failed with "Missing or invalid CSRF token" instead of refreshing. The CSRF cookie now outlives the access token the same way the refresh token does, since csrf protection needs to remain valid for as long as any session (refresh token) does | *Confirmed and fixed* |
| `BE-DEC-031` | Logging stack | Winston + `winston-daily-rotate-file`, bridged via `nest-winston`'s `WinstonModule.createLogger()` passed to `NestFactory.create()`'s `logger` option | Nest's default logger is console-only — lost on every restart, unstructured, no separate error view. Bridging through `nest-winston` means every existing `new Logger(ClassName.name)` call site across the app needed zero changes to start writing to daily-rotated, gzipped, retention-pruned files. See `qa/phase-13-logging-understanding-check.md` | *Confirmed and implemented (Phase 13)* |
| `BE-DEC-032` | `refresh_token` cookie path | Changed from `Path=/auth` to `Path=/api/auth` in `AuthController.setAuthCookies()`/`clearAuthCookies()` | Found live by manually shortening `JWT_ACCESS_EXPIRES_IN` to exercise the refresh flow for real: `Path=/auth` was set in Phase 3, *before* Phase 9 added the global `/api` prefix, and was never updated to match. Since `Path=/auth` doesn't match the real route `/api/auth/refresh`, the browser (and curl, correctly reproducing the same cookie-path matching) never sent the cookie at all — every real refresh attempt failed with "No session to refresh". The same mismatch silently broke `/api/auth/logout`'s revocation too: it read `req.cookies['refresh_token']` as `undefined` every time, so `AuthService.logout()`'s `if (rawRefreshToken) { revoke(...) }` guard always skipped the revoke — logout appeared to work (the cookie still got cleared client-side via a matching-path `clearCookie` call) but never actually invalidated the session server-side. A previously "logged out" refresh token remained valid until its natural 7-day expiry. Verified live: fixed cookie path → refresh succeeds → logout revokes → reusing the same refresh token afterward correctly returns "Session revoked" | *Confirmed and fixed* |
