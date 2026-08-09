# Learning Topics Tracker

> A single running checklist of everything flagged as a gap (⚠️ or 🔲) across every phase's understanding-check doc in this folder. Updated after every phase — don't delete old entries when they're "resolved," mark them done instead, so this stays a complete record of what you've actually studied by the end of the project.
>
> **How to use this before an interview:** read top to bottom. Each item links back to the phase doc with the full explanation. If you can't re-explain an item out loud without looking, that's the one to re-read first.

---

## Legend

- `[ ]` — flagged as a gap, not yet reviewed beyond this tracker
- `[x]` — reviewed in the phase doc's explanation (you've read the expansion)
- `[x]` *(practiced)* — reviewed **and** you've since implemented/exercised it in actual code, which is the real bar for "understood"

---

## From Phase 0 — Auth & RBAC ([full doc](phase-0-auth-rbac-understanding-check.md))

- [x] **CSRF mechanism vs. XSS** — how a CSRF attack works without ever reading the cookie value (ambient authority), and why it's a fundamentally different threat than token theft.
- [x] **`SameSite` attribute** — the `Strict` / `Lax` / `None` distinction, what "cross-site" actually means for a request, and why `Lax` is usually the practical choice for an API-only backend.
- [x] **CORS as a second, independent layer** — `Access-Control-Allow-Origin` (never `*` with credentials) + `Access-Control-Allow-Credentials: true` + `credentials: 'include'` on the client.
- [x] **CSRF token / custom-header defense-in-depth** — why a required custom header blocks plain cross-site form-based CSRF even when `SameSite` alone might not be trusted 100%.
- [x] **Salt** — random per-password value that defeats rainbow tables and cross-user pattern leaks; not secret.
- [x] **Pepper** — app-wide secret value, protects against a full DB dump even without a compromised app secret.
- [x] **Argon2id vs. bcrypt** — the actual property (memory-hardness vs. CPU-only cost), not just "argon2 is newer."
- [ ] **Refresh token rotation + reuse detection** — read the explanation again once Phase 3 is actually being implemented; understanding it in the abstract vs. implementing the "invalidate whole family on reuse" logic are different levels of mastery. *(practice this hands-on in Phase 3)*
- [x] **RBAC enforcement mechanism** — `JwtAuthGuard` (authentication) → `RolesGuard` (authorization) → `@Roles()` decorator + `Reflector`.
- [x] **Role-freshness tradeoff** — JWT-embedded role can go stale until token refresh; DB-lookup-per-request is always fresh but costs a query; understand this is a deliberate tradeoff, not an oversight.
- [x] **Role+permission table vs. hardcoded enum** — chose the normalized model deliberately for learning depth, even though the PRD only needs 3 fixed roles. Be ready to defend this scope decision in an interview.
- [x] **Why migrations over `synchronize`/`db push`** — no reviewable diff, no rollback, race conditions across instances, silent data loss.
- [x] *(practiced)* **What NOT to put in a migration** — real `InitSchema` migration generated and reviewed in Phase 2 contained schema only (tables, constraints, FKs); role/permission seed data correctly kept in a separate idempotent script (`seed-roles-permissions.ts`), not the migration.
- [ ] **Guard vs. Interceptor vs. Pipe vs. Middleware** — full request-lifecycle order reviewed in the doc; first NestJS project, so this needs hands-on repetition, not just the one read-through. *(practice this hands-on in Phase 1/3)*
- [ ] **Unit vs. e2e/integration test scope** — reviewed conceptually; you've never written either kind yet. *(practice this hands-on in Phase 7)*

## From Phase 1 — Scaffold, Config, DB Connection ([full doc](phase-1-scaffold-db-understanding-check.md))

- [x] **NestJS module encapsulation** — `exports` as the boundary that prevents "everything reachable from everywhere," same failure mode as flat frontend `components/hooks/utils` folders.
- [x] **DI enabling test substitution** — the mechanism is `overrideProvider(...).useValue(fakeThing)`, not just "fewer services to set up."
- [x] **Fail-fast env validation** — validate at boot, crash loud and pre-traffic instead of failing silently post-traffic.
- [x] **`.env.example` vs. real secrets** — committed placeholder file vs. secret-manager-injected real values, never committed.
- [x] *(practiced)* **TypeORM vs. Prisma tradeoff** — confirmed TypeORM in Phase 1; connection + config actually wired (`src/database/database.module.ts`). Real entity/repository usage still comes in Phase 2.
- [x] **Connection pooling and exhaustion** — the *severe* failure mode is Postgres's `max_connections` limit being exhausted (outright rejected connections), not just added latency.
- [x] *(practiced)* **Liveness vs. readiness health checks** — implemented for real via `@nestjs/terminus`: `GET /health/live` (no dependency checks) vs. `GET /health/ready` (`TypeOrmHealthIndicator.pingCheck`), verified against the actual running Postgres connection.
- [x] *(practiced)* **Repository pattern via `TypeOrmModule.forFeature()`** — `UsersModule`/`RolesModule` now register `User`/`Role`/`Permission` this way; confirmed via `npm run build` + a real app boot, no hand-written repository classes needed.

## From Phase 2 — Database Schema & Migrations ([full doc](phase-2-schema-migrations-understanding-check.md))

- [x] *(practiced)* **Cardinality: many-to-one vs. many-to-many** — the test is "can the *other side* be shared," not "does this record have only one X." Corrected: `User→Role` is many-to-one (plain FK column), `Role→Permission` is many-to-many (needs a join table, a plain FK column literally cannot express it). This was the biggest miss this round — worth re-deriving from scratch next time a new relationship comes up (Products/Orders in later phases) rather than trusting instinct.
- [x] *(practiced)* **`@ManyToMany` + `@JoinTable()`** — generates the `role_permissions` join table automatically; verified the actual generated SQL (composite PK on `(role_id, permission_id)`, both FKs `ON DELETE CASCADE`).
- [x] **UUID vs. auto-increment tradeoff** — full pros/cons table; security (IDOR/enumeration resistance) is why UUID won here specifically, not a default "UUIDs are just better."
- [x] *(practiced)* **Refresh token rotation schema** — corrected from "update one row in place" to "insert a new row per rotation, mark the old one `revoked_at`"; actual columns (`family_id`, `token_hash`, `revoked_at`) exist in the real `refresh_tokens` table now. Logic that *uses* this schema (the actual rotation/reuse-detection code) is still Phase 3 — schema existing isn't the same as behavior implemented.
- [x] **Why a fast hash (SHA-256), not Argon2id, for refresh tokens** — the distinction is guessable-secret (needs slow hash) vs. already-random-high-entropy value (fast hash is correct, slow hash just wastes CPU).
- [x] **UNIQUE constraint ≠ PK uniqueness** — a PK is already unique by definition; the real UNIQUE constraints needed are on `email`/`token_hash`/role & permission `name`, which are separate from the PK.
- [x] **TOCTOU race condition** — why "check then insert" in application code can't fully prevent duplicate emails under concurrency; only a DB-level constraint closes the gap atomically.
- [x] *(practiced)* **`migration:generate` diff mechanism** — ran it for real against a live (then-empty) database; saw firsthand that it introspects the actual DB and diffs against entity definitions, not against an abstract prior version.
- [x] **`up()`/`down()` reversibility** — reviewed the real generated migration's `down()`: correctly drops FKs before tables, drops the enum type only after the table using it is gone — order matters, and now you've seen why.
- [x] *(practiced)* **Soft delete via `@DeleteDateColumn`** — `deletedAt` on `users`, confirmed present in the real generated schema.

## From Phase 3 — httpOnly Cookie Auth ([full doc](phase-3-cookie-auth-understanding-check.md))

- [x] *(practiced)* **Argon2id parameters (memory/time/parallelism cost)** — real `PasswordService` with OWASP baseline values, verified a real hash/verify round-trip against this machine's native `argon2` binary before building anything on top of it.
- [x] *(practiced)* **DI for testability** — `PasswordService`/`TokenService` injected into `AuthService`, not called statically — sets up Phase 7's unit tests to mock both without paying real Argon2id cost per test run.
- [x] *(practiced)* **Timing-attack-aware login** — verified directly: wrong-password and unknown-email responses are identical in shape, message, *and* status; both run a real `verify()` call (dummy hash for the unknown-email case) rather than short-circuiting.
- [x] **JWTs are signed, not encrypted** — decoded a real issued access token by eye; payload is plainly readable base64, confirming why a password hash (or anything secret) must never go in one.
- [x] *(practiced)* **`@Res({ passthrough: true })` vs. bare `@Res()`** — used correctly on every auth endpoint; `return user` still gets sent automatically while cookies are set manually.
- [x] *(practiced, corrected via a real bug)* **Cookie `Path` scoping** — the plan (`Path=/auth/refresh`) broke logout in practice, because `/auth/logout` doesn't share that path prefix — the refresh cookie was never sent there at all, so logout's DB revocation silently no-op'd. Found by testing the actual endpoint with curl (not by reading the code), fixed by broadening to `Path=/auth`. This is the single most valuable thing this phase taught: a design that sounds right in a doc can still be wrong until it's actually exercised end-to-end.
- [x] *(practiced)* **Refresh rotation + reuse detection, for real** — not just designed, *observed*: rotated a token, replayed the old one, watched the whole family (including the still-fresh legitimate token) get revoked, confirmed directly in Postgres.
- [x] *(practiced)* **`passport-jwt` custom cookie extractor + guard → `request.user` chain** — `/auth/me` correctly 200s with cookies, 401s without, via the real `JwtStrategy`/`JwtAuthGuard`.
- [x] *(practiced)* **Logout ordering (DB revoke before cookie-clear)** — implemented in that order; also directly caused the Path bug above to surface as "logout looks like it worked (cookies cleared, `/auth/me` 401s) but the DB still shows the token live" — a good example of why "the client looks logged out" isn't proof the security-relevant action happened.

## From Phase 4 — RBAC Guards & User Management ([full doc](phase-4-rbac-users-understanding-check.md))

- [x] *(practiced)* **`SetMetadata` + `Reflector.getAllAndOverride`** — built `@RequirePermissions()` from scratch and read it back in a real guard; confirmed the method-level-overrides-class-level behavior conceptually (not separately re-tested, since this project only sets it at method level).
- [x] *(practiced)* **Authentication-before-authorization guard ordering** — `@UseGuards(JwtAuthGuard, PermissionsGuard)`; verified a request with no cookie gets `401` from the first guard, never reaching the second.
- [x] *(practiced)* **Permission resolution from role name, fresh per request** — chose this over JWT-embedded permissions specifically to exercise the Phase 2 schema; verified live: Manager blocked from `users:update`/`users:delete`, allowed on `users:read`, matching the seeded permission bundle exactly.
- [x] *(practiced)* **Fail-closed guard design** — implemented (throws if no `@RequirePermissions()` found); not separately exercised live since every shipped route has the decorator — this is exactly the branch flagged for a dedicated Phase 7 unit test, since it's the one most likely to silently regress.
- [x] *(practiced)* **TOCTOU / DB-constraint-as-real-enforcement, applied a second time** — same lesson as Phase 2 Q5, now actually hit: duplicate-email `POST /users` correctly returns a clean `409` translated from Postgres's own `23505` unique-violation error, not a pre-check race.
- [x] *(practiced)* **Soft delete + session revocation together, for real** — `DELETE /users/:id` confirmed via direct Postgres query to set `deleted_at` (never a hard delete) and to revoke that user's live refresh tokens in the same operation.
- [x] *(practiced)* **TypeORM `QueryBuilder`** (`andWhere`, `leftJoinAndSelect`, parameterized values, `getManyAndCount`) — first use beyond simple `findOneBy`/`find`; verified pagination shape (`total`, `totalPages`, `hasNextPage`) matches the frontend's real `PaginatedResponse<T>` type field-for-field.
- [x] **Avoiding a circular module dependency by re-registering an entity** — `RefreshToken` registered in both `AuthModule` and `UsersModule` rather than having `UsersModule` import `AuthModule` (which already imports `UsersModule`) — a concrete instance of the abstract Phase 1 Q1 module-boundary concept.
- [ ] **Unit-testing a Guard with a fake `Reflector`/`ExecutionContext`** — reasoned through in the qa doc (Q9), not yet written. *(practice this hands-on in Phase 7)*

## From Phase 5 — Rate Limiting, CSRF, Audit Logging ([full doc](phase-5-hardening-understanding-check.md))

- [x] *(practiced)* **Fixed-window rate limiting + the shared-IP tradeoff** — `ThrottlerModule`/`ThrottlerGuard` wired globally; verified live that the 6th `/auth/login` attempt within 60s returns `429` while `/health/live` never does (`@SkipThrottle()`).
- [x] **What rate limiting does and doesn't stop** — mitigates cheap, single-IP credential stuffing/brute force; does not stop a distributed attacker spread across many IPs. Not something to demonstrate live (would need an actual botnet), but important to be able to state precisely rather than oversell what this control does.
- [x] *(practiced)* **In-memory throttler storage's real limitation** — not just theoretical: hit it directly mid-testing, restarting the single dev instance reset every counter, which is exactly the "no shared state across instances" problem that would silently multiply the effective limit in a real multi-replica deployment.
- [x] *(practiced)* **Double-submit CSRF cookie, end-to-end** — verified all four cases live: missing header → `403`, wrong header → `403`, correct header → succeeds, `GET` needs no header at all. Also confirmed via curl's own cookie-jar format that `csrf_token` is genuinely non-`httpOnly` (no `#HttpOnly_` prefix) while `access_token`/`refresh_token` are.
- [x] **Why a CSRF attacker can't forge a matching header** — the precise mechanism (same-origin policy blocks cross-origin `document.cookie` reads, independent of any cookie attribute) — this is the one piece of B2 worth being able to re-derive from scratch, not just recall.
- [x] *(practiced)* **Guard vs. middleware for a cross-cutting check, decided on verified evidence** — chose Guard specifically because Guard-thrown exceptions were already proven (Phases 3/4) to flow through `AllExceptionsFilter`; didn't guess about middleware's exception-handling behavior in this Nest version.
- [x] *(practiced)* **Deliberately FK-less schema design, as a conscious exception** — `audit_logs` breaks the "every relationship gets a real FK" pattern from every other table on purpose; the reasoning (an audit trail must outlive what it references) is the more interesting takeaway than the schema itself.
- [x] *(practiced)* **Audit log vs. application log — different purpose, verified with real entries** — a real `user.role_changed` row with accurate `fromRoleId`/`toRoleId` in `metadata`, and a real `user.deleted` row, both queried directly from Postgres, not just asserted in code review.
- [x] **Why audit-recording lives in the service method, not a generic interceptor** — reasoned through in the qa doc (C3); the concrete payoff was visible in the actual code — capturing `previousRoleId` *before* `Object.assign()` overwrites it is only possible because the service knows the precise moment the meaningful state change happens, which a generic route-watching interceptor couldn't know without reparsing bodies.

## From Phase 6–7 — Products & Orders Modules ([full doc](phase-6-7-products-orders-understanding-check.md))

- [x] *(practiced)* **The RBAC/CRUD/pagination pattern genuinely generalizes** — copied `UsersModule`'s shape onto two new entities with zero changes to the pattern itself; verified live that permission checks, pagination shape, and soft delete all worked correctly on the first try for both new entities.
- [x] *(practiced)* **`numeric` columns as `string` in TypeScript, not `number`** — verified a real `"29.99"` round-trips as the string `"29.99"`, not silently coerced.
- [x] *(practiced)* **Derived state via a `@Expose()` getter, not a column** — `Product.stockStatus` confirmed present in real API responses despite no corresponding database column; this was verified, not assumed, since it wasn't obvious `instanceToPlain()` would walk a getter without checking.
- [x] **Disclosed scope simplifications, contrasted with a deliberately-over-built decision** — `category` as a plain string and no order line-items, explicitly contrasted with why `roles`/`permissions` *did* warrant the extra structure (`BE-DEC-001`) — the interesting lesson is knowing which is which, not a blanket rule either way.
- [x] *(practiced)* **File upload hardening basics** — random server-generated filenames (never trust a client filename), MIME-type allow-list, size limit, and multer's disk storage NOT auto-creating missing directories (a real gotcha hit and fixed, not anticipated in the abstract).

## From Phase 8 — Signup, Verify-OTP, Accept-Invite, Forgot/Reset Password ([full doc](phase-8-auth-extensions-code-walkthrough.md); no separate qa doc this phase — decisions folded directly into `design.md`/`PRD.md` given the "in one go" pacing)

- [x] *(practiced)* **Avoiding a second circular-dependency trap** — recognized in advance (same shape as the Phase 4 `RefreshToken` situation) that `UserTokensModule` needed to be standalone, not owned by `AuthModule` or `UsersModule`, before writing any code — the pattern-recognition paid off this time instead of being discovered via a boot failure.
- [x] *(practiced)* **Two credential shapes, one storage model** — `crypto.randomInt` (6-digit OTP) vs. `crypto.randomBytes` (256-bit URL token), same hash-and-store mechanism; understanding *why* OTP's `consume()` call needs an extra `userId` check that the URL-token calls don't (small vs. astronomically large guess space).
- [x] *(practiced)* **A full, real multi-step account-lifecycle flow, verified end-to-end** — signup → real OTP pulled from server logs → verify → real session; admin-create → real invite token from logs → accept-invite → real OTP → verify → real session with the *correct* admin-assigned role. Not reasoned through — actually run, twice, with different roles.
- [x] *(practiced)* **Token reuse correctly blocked across all three purposes** — replaying a consumed OTP, invite token, or (implicitly, via the same `consume()` method) reset token all fail with the same "already used" error — one piece of shared logic, verified for real on two of the three purposes directly.
- [x] *(practiced)* **Password reset's blast radius, observed not just designed** — a session's cookies from before a reset genuinely stopped working on the very next refresh, reusing the exact same "Session revoked" path from Phase 3's reuse detection, now triggered by a bulk revoke instead of a rotation event.
- [x] **A scope decision changing mid-project, documented as a change, not a rewrite** — `PRD.md` Section 1.4 keeps the original "out of scope" reasoning visible (struck through, not deleted) alongside the amendment — worth remembering as the right way to handle "we changed our mind," both for this project and generally.

## From Phase 9–10 — Global API Prefix & Swagger

- [x] *(practiced)* **`setGlobalPrefix` only affects Nest-routed controllers, not raw Express middleware** — verified live: `/uploads/*` (static assets) and `/docs`/`/docs-json` (Swagger, mounted directly on the HTTP adapter) all stayed reachable unprefixed after adding `/api`, while every controller route correctly required the new prefix.
- [x] *(practiced)* **Swagger's cookie-auth story is documentation, not automation** — `addCookieAuth()`/`@ApiCookieAuth()` correctly attach the security requirement to the OpenAPI spec (verified in the raw JSON), but understanding *why* the "Authorize" button doesn't actually drive real requests the way it does for Bearer tokens (the browser already holds the real cookies from a normal login; Swagger's own test-request tool has no special cookie-injection story) is the more interesting takeaway than the wiring itself.
- [x] **A "free" correctness improvement recognized in context** — switching `PartialType` from `@nestjs/mapped-types` to `@nestjs/swagger` once Swagger existed, rather than as an afterthought — noticing that a dependency choice made in Phase 4 (deliberately, with a stated reason) had a natural upgrade point once new information (Swagger's own `PartialType`) existed.

---

## Recurring Item — Flagged for Re-Review

- [x] *(re-corrected, with direct DB verification this time)* **`@ManyToMany` + `@JoinTable` is not an array column** — this exact misconception (Phase 2 Q1/Q2: "isn't it just a permissions array on the role?") resurfaced while reading `role.entity.ts` directly, after the concept had already been explained once in the Phase 2 qa doc. Re-corrected with `\d roles` (confirms zero `permissions` column exists) and `\d role_permissions` (confirms the real two-column junction table) run live against Postgres — see the new [phase-2-schema-migrations-code-walkthrough.md](phase-2-schema-migrations-code-walkthrough.md), written specifically to close this gap with the real code and real schema side by side. **Worth flagging to future-you:** a concept explained once in a qa doc isn't the same as it being fully internalized — if this resurfaces a third time, that's a signal to slow down and re-derive it from scratch rather than re-reading the explanation again.

---

## Consolidated Reading List (dedup'd across phases)

1. NestJS docs: **Guards**, **Interceptors**, **Pipes**, **Middleware**, **Exception Filters**, **Custom Providers/Testing** (`Test.createTestingModule`, `overrideProvider`).
2. NestJS docs: **TypeORM integration** — `TypeOrmModule.forFeature()`, repository injection, migration CLI.
3. OWASP Cheat Sheet: **Password Storage** (Argon2id, salt, pepper, work factor).
4. OWASP Cheat Sheet: **Cross-Site Request Forgery Prevention** (SameSite, double-submit cookie).
5. MDN: **Set-Cookie** attributes (`HttpOnly`, `Secure`, `SameSite`, `Path`, `Max-Age`).
6. Postgres docs: **`max_connections`** and connection pooling (`pg` pool config, or PgBouncer as a further upgrade path worth knowing exists even if unused here).
7. Kubernetes/orchestrator docs (even a general blog post is fine): **liveness vs. readiness probes**.
8. TypeORM docs: **`@ManyToMany`/`@JoinTable`**, **`@DeleteDateColumn`** (soft delete), migration `up()`/`down()` authoring.
9. A short read on **IDOR** (Insecure Direct Object Reference) as a named vulnerability class — ties directly to the UUID-vs-int reasoning.
10. NestJS docs: **Passport integration**, custom Passport strategies, `@Res({ passthrough: true })`.
11. MDN: cookie **`Path`** matching semantics specifically — the exact mechanism that caused the Phase 3 logout bug.
12. NestJS docs: **custom decorators with `SetMetadata`**, `Reflector`, and **`CanActivate`** — the full mechanics behind `@RequirePermissions()`/`PermissionsGuard`.
13. TypeORM docs: **`QueryBuilder`** (`andWhere`, joins, parameterized values) vs. the simpler `Repository` methods used through Phase 3.
14. OWASP Cheat Sheet: **Denial of Service** section on rate limiting, and a short read on Redis-backed rate-limit storage for multi-instance deployments.
15. NestJS docs: **`APP_GUARD`/`APP_FILTER`/`APP_INTERCEPTOR` injection tokens** — the mechanism behind truly global (not just per-controller) providers.

---

## Status Snapshot

Last updated: after Phase 5 implementation (rate limiting, CSRF double-submit, audit logging — all verified end-to-end against the real app + real Postgres).

- Concepts explained and understood: **56**
- Concepts practiced hands-on in real code: **34** (TypeORM connection wiring, liveness/readiness health checks, many-to-many join table, refresh-token rotation schema, `migration:generate` diffing, migration `up()`/`down()` review, soft delete, repository pattern via `forFeature()`, Argon2id hashing, DI-for-testability in AuthService, timing-attack-safe login, `@Res({passthrough:true})`, cookie `Path` scoping — corrected via a real bug, refresh rotation + reuse detection observed live, passport-jwt cookie extraction, logout DB-then-cookie ordering, `SetMetadata`/`Reflector`, guard ordering, DB-resolved permission checks, TOCTOU-safe unique-email handling, soft-delete + session revocation together, `QueryBuilder`, avoiding a circular module dependency, global rate limiting via `APP_GUARD`, in-memory throttler storage limitation hit directly, double-submit CSRF verified end-to-end, Guard-vs-middleware decided on verified evidence, deliberately FK-less audit schema, real audit entries verified in Postgres)
- Concepts explained but still needing hands-on practice: **4**
- Next update due: after Phase 6 (Swagger/OpenAPI) understanding-check.

### Phase 1 Build Notes (things that came up during implementation, not just Q&A)

- **TypeORM version pin:** the npm registry's `latest` tag for `typeorm` resolved to `1.1.0` — a major version released after this agent's knowledge cutoff. Pinned to `^0.3.31` (the long-stable line) instead of building on an unverified API surface. Worth knowing this was a deliberate, disclosed choice, not an oversight — revisit if you want to track TypeORM's v1 migration guide later as its own learning exercise.
- **Removed Nest's default boilerplate** (`app.controller.ts`/`app.service.ts`, the "Hello World" generated by `nest new`) since it didn't belong to any real domain module — first practical example of the "no stray files outside `modules/`" rule from `architecture.md`.

### Phase 2 Build Notes

- **`Object` type not supported by Postgres** — TypeORM couldn't infer a column type for `string | null` union-typed fields (`avatarUrl`, `ipAddress`, `userAgent`) via `reflect-metadata`; fixed by adding an explicit `type: 'varchar'` on those columns. Worth remembering: any nullable/union-typed TS field needs an explicit `type` in `@Column()`, not just relying on inference.
- **`uuid-ossp` extension** was already enabled in the fresh `p1_dashboard_dev` database (inherited from `template1`, likely from earlier setup on this machine for another project) — confirmed before running the migration rather than assuming it. Worth knowing that on a genuinely fresh Postgres install, this may need `CREATE EXTENSION "uuid-ossp"` explicitly (TypeORM's migration runner does attempt `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` automatically on connect, so this is normally handled — confirmed in the actual query log during `migration:run`).
- **Idempotent seed script verified for real** — ran the seed twice; first run created 12 permissions + 3 roles, second run logged "updated role" with zero new rows, confirmed by querying `role_permissions` counts directly (Admin: 12, Manager: 5, Viewer: 3 — matches `PRD.md` Section 2 exactly).

### Phase 3 Build Notes

- **The cookie `Path` bug** (see the Phase 3 checklist item above) is the headline finding of this phase — a design that was reasoned through carefully in the understanding-check doc still had a real bug, only caught by actually exercising the endpoint with curl and checking the database afterward, not by re-reading the code. Kept as the strongest evidence yet for why this project tests against the real running app + real Postgres at the end of every phase instead of trusting review alone.
- **`argon2` v0.45.1's TS types changed shape** from older versions this agent expected — the exported type is `HashOptions`, not `Options`. Caught immediately by `npm run build`, fixed by reading the package's actual `.d.cts` file rather than guessing.
- **`ms` v2.1.3's types are stricter than expected** — its parse overload requires a template-literal `StringValue` type, not a plain `string`, so config values (typed as `string` in `Configuration`) needed an explicit `as ms.StringValue` cast at the two call sites.
- **`isolatedModules` + `emitDecoratorMetadata` requires `import type`** for types used purely as type annotations in decorated method signatures (e.g. `@CurrentUser() currentUser: CurrentUserPayload`) — a value import of a type-only symbol fails the build under this project's `tsconfig.json` settings. Fixed by splitting into a separate `import type { ... }` line.
- **26 npm audit findings, unresolved on purpose** — all trace back to `typeorm@0.3.31`'s transitive dev-tooling deps (`glob`/`minimatch`/`brace-expansion`, used for migration-file path globbing, never on a request-handling path). The suggested fix force-upgrades to `typeorm@1.1.0` — the same version deliberately avoided in Phase 1. Left as-is and disclosed, not silently ignored.
- **A temporary test user** (`test.admin@example.com`, password `CorrectHorseBatteryStaple123`, role `Admin`) exists in `p1_dashboard_dev` — created by a throwaway script (deleted after use) purely to verify the login/refresh/logout flow end-to-end. Left in the database since it's harmless and useful for continued manual testing in Phase 4; delete it whenever it's no longer needed.

### Phase 4 Build Notes

- **Two more test users** (`test.manager@example.com`, `test.viewer@example.com`, same password as the Phase 3 admin one) created via another throwaway script (deleted after use) specifically to verify the permission matrix across all three roles, not just Admin. All three left in the database, harmless, useful for Phase 5+ manual testing.
- **The circular-module-dependency near-miss** (see the checklist item above) — worth calling out as a build note too, not just a concept: this was caught by *reasoning about the import graph before writing the code* (during the walkthrough-writing pass), not by hitting an actual `forwardRef` runtime error. Good example of the Phase 1 Q1 concept paying off — recognizing the shape of the problem in advance instead of debugging it after Nest refuses to boot.
- **`ParseUUIDPipe` and `@IsUUID()` are deliberately redundant with each other** — the DTO's `@IsUUID()` validates `roleId` in the request *body*; `ParseUUIDPipe` validates the `:id` route *parameter*. Both were needed because they validate two different pieces of the request, not because one was a mistake.
- **Verified the full permission matrix live**, not just the happy path: all three roles can `GET /users`; unauthenticated requests get `401`; Manager and Viewer both correctly get `403` on create/update/delete; duplicate email returns a clean `409`; invalid `roleId` returns `400`; deleting a user is confirmed as a genuine soft delete via direct Postgres query, not just via the API's own response.

### Phase 5 Build Notes

- **A debugging detour worth remembering the shape of:** the app appeared to hang completely on boot after this phase's changes — zero log output, port never opened, even after 20+ seconds, tried via both `nohup ... &` in bash and `Start-Job` in PowerShell. Every plausible *code* cause was considered (circular imports, a bad `ThrottlerModule` config, a silent exception). The actual cause was neither: it was a shell-backgrounding/output-buffering quirk in how the test commands themselves were run (both approaches produced genuinely empty log files despite the process visibly consuming CPU) — switching to the harness's own proper background-execution mechanism showed the app had, in fact, booted cleanly in well under a second the whole time. **The lesson:** when something that has worked identically in four prior phases suddenly "hangs" with zero output right after a change, seriously consider that the *observation method* is broken before concluding the *code* is — especially on Windows/Git-Bash, where manual `&`/`nohup` backgrounding combined with file redirection is not fully reliable.
- **`@nestjs/throttler` v6's API uses named throttlers** (`ThrottlerModule.forRoot([{ name, ttl, limit }])`, `@Throttle({ default: { limit, ttl } })`), not the older single-object `{ttl, limit}` shape from earlier major versions — checked the installed package's actual `.d.ts` files before writing code, same discipline as Phase 1's TypeORM version surprise and Phase 3's `argon2`/`ms` type surprises. Three surprises in, this is now a standing habit, not a one-off.
- **Rate-limit and CSRF verification consumed the login throttle bucket** partway through testing (5/60s is intentionally strict) — resolved by restarting the dev instance (acceptable since throttler storage is in-memory and per-process, not because it's a fix for anything wrong).
