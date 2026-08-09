# Backend Implementation & Build Phases

---

## Phase Overview

```
Phase 0  Understanding Check — Auth & RBAC concepts                    ✅ Complete
Phase 1  Scaffold, Config, Postgres Connection                         ✅ Complete
Phase 2  Database Schema + TypeORM Migrations                          ✅ Complete
Phase 3  httpOnly Cookie Auth (login/logout/refresh)                   ✅ Complete
Phase 4  RBAC Guards + Admin User Management Endpoints                 ✅ Complete
Phase 5  Hardening (rate limiting, CSRF, audit logging)                ✅ Complete
Phase 6  Products Module (mirrors Users)                               ◄─ current
Phase 7  Orders Module (mirrors Users + status transitions)
Phase 8  Auth Extensions (signup, email-verification OTP, invite, forgot/reset password)
Phase 9  Global /api Prefix (align with frontend's existing base URL)
Phase 10 Swagger / OpenAPI Documentation
Phase 11 Unit + E2E Test Suites                                        (deferred until after frontend integration)
Phase 12 Final Docs Pass (auth-flow deep-dive, ADRs, review)
```

**Standing rule for every phase:** before implementation starts, an understanding-check Q&A round happens first (documented in `qa/phase-N-*.md`), gaps get added to `qa/learning-topics-tracker.md`, and only after that is code written. No phase skips this gate. **Exception, explicitly agreed for Phases 6–9:** since these largely repeat an already-established pattern (Products/Orders mirror Users; auth extensions reuse the token/hashing patterns from Phases 3/5), the qa docs for these phases focus on what's genuinely *new* rather than re-deriving RBAC/pagination/hashing fundamentals already covered, and implementation proceeds without waiting for a separate confirmation round — per the user's explicit "complete the backend in one go" direction.

**Frontend integration** (a separate, phased effort against the frontend repo) is tracked in `frontend/docs/phases.md`'s expanded Phase 3, not here — see that file once backend Phase 9 is complete.

---

## Phase 0 — Understanding Check: Auth & RBAC ✅

**Goal:** Verify conceptual grasp of httpOnly cookies vs. localStorage, access/refresh token lifecycle, CSRF/SameSite, password hashing, RBAC enforcement location, migrations rationale — before any code exists.
**Deliverable:** `qa/phase-0-auth-rbac-understanding-check.md`.
**Checkpoint:** Passed — no blocking misconceptions; proceeded to Phase 1.

---

## Phase 1 — Scaffold, Config, Postgres Connection *(current)*

### Goals
Stand up the NestJS project skeleton, module/common/config folder structure, environment validation, and a real Postgres connection — no business/auth logic yet.

### Key Deliverables
1. NestJS project init (Nest CLI), TypeScript strict mode, ESLint/Prettier matching the frontend's tooling philosophy.
2. `modules/`, `common/`, `config/`, `database/` folder scaffolding (per `architecture.md` Section 1).
3. Env validation (`class-validator`-backed config schema) — fails fast on boot if `DATABASE_URL`/`JWT_SECRET`/etc. are missing.
4. `.env.example` committed; real `.env` git-ignored.
5. TypeORM `DataSource` config wired to a fresh local Postgres database (see `qa/phase-1-scaffold-db-understanding-check.md`).
6. `GET /health` endpoint (liveness/readiness distinction documented, at minimum a DB-ping readiness check).

> **Checkpoint:** confirm the app boots, connects to Postgres, and `/health` responds, before Phase 2 begins.

---

## Phase 2 — Database Schema + Migrations

### Goals
Design and migrate the real schema: `users`, `roles`, `permissions`, `role_permissions`, `refresh_tokens` (see `architecture.md` Section 4.1).

### Key Deliverables
1. TypeORM entities for all core tables, UUID primary keys, `createdAt`/`updatedAt` on every entity.
2. First real migrations (not `synchronize`) — reviewed, committed, runnable via CLI.
3. Seed script (separate from migrations, per `qa/phase-0-...md` Q12) populating the 3 fixed roles + their permission bundles.
4. Understanding-check round on: entity relations, migration authoring, seed-vs-migration boundary.

> **Checkpoint:** schema exists in Postgres via migration, seed data present, before Phase 3 begins.

---

## Phase 3 — httpOnly Cookie Authentication

### Goals
Real login/logout/refresh/`me` endpoints, replacing what would otherwise be mock auth.

### Key Deliverables
1. Argon2id password hashing service.
2. `POST /auth/login` — validates, issues `access_token` + `refresh_token` cookies, returns user profile only.
3. `POST /auth/refresh` — validates + rotates refresh token, reuse-detection revokes token family.
4. `POST /auth/logout` — revokes refresh token DB record, expires both cookies.
5. `GET /auth/me` — returns current session's user.
6. Passport JWT strategy reading from cookie (not `Authorization` header).
7. Understanding-check round on: refresh rotation implementation specifics, cookie flag configuration, Argon2id parameter tuning.

> **Checkpoint:** full login → protected-request → refresh → logout cycle verified via real HTTP calls (Postman/curl) before Phase 4.

---

## Phase 4 — RBAC Enforcement

### Goals
`JwtAuthGuard` + `RolesGuard` + `@Roles()` decorator wired across real protected routes; Users CRUD respecting the role matrix in `PRD.md` Section 2.

### Key Deliverables
1. `common/guards/jwt-auth.guard.ts`, `common/guards/roles.guard.ts`, `common/decorators/roles.decorator.ts`, `common/decorators/current-user.decorator.ts`.
2. Users module: full CRUD, each endpoint annotated with the correct `@Roles(...)`.
3. Understanding-check round on: Guard execution order edge cases, permission-resolution query patterns, testing guards in isolation.

> **Checkpoint:** manually verify Admin/Manager/Viewer get correct 200/403 responses across every Users endpoint before Phase 5.

---

## Phase 5 — Hardening

### Goals
Close the gaps intentionally deferred earlier for pacing: CSRF token layer, rate limiting, structured logging/audit trail, global exception filter polish.

### Key Deliverables
1. Rate limiting (`@nestjs/throttler`) on `/auth/login`, `/auth/refresh`.
2. CSRF defense-in-depth (custom header requirement or double-submit token) on top of `SameSite`/CORS.
3. `AllExceptionsFilter` finalized — no internals leak in 5xx responses.
4. Audit log entries for sensitive actions (role changes, user deletion).
5. Understanding-check round on: rate-limiting strategy tradeoffs, what belongs in an audit log vs. application log.

---

## Phase 6 — Products Module

### Goals
Mirror the Users module's established pattern (entity, migration, DTOs, service, controller, `PermissionsGuard`-enforced routes, shared pagination helper) for a second entity — a deliberate repetition exercise, not new architecture.

### Key Deliverables
1. `Product` entity (fields matching the frontend's eventual needs: name, SKU, category, price, stock status, timestamps, soft delete).
2. Migration (reviewed before running, per the standing rule).
3. `products:read/create/update/delete` permissions seeded, assigned per the existing role matrix (Admin full, Manager read+update, Viewer read-only — same shape as Products already had in the Phase 2 seed).
4. `ProductsService`/`ProductsController` reusing `PaginationQueryDto`/`buildPaginatedResult`.

> **Checkpoint:** full CRUD + pagination + RBAC verified live for all three roles, same rigor as Phase 4.

---

## Phase 7 — Orders Module

### Goals
Same pattern again, plus one new shape: an order status transition endpoint (`PATCH /orders/:id/status`, per the frontend's already-scaffolded `orderEndpoints.updateStatus`).

### Key Deliverables
1. `Order` entity (customer info, line items or a simple total, status enum, timestamps, soft delete).
2. Migration, seeded `orders:*` permissions (already present in the Phase 2 seed).
3. `OrdersService`/`OrdersController`, including the status-transition endpoint with its own permission check.

> **Checkpoint:** full CRUD + pagination + RBAC + status transition verified live.

---

## Phase 8 — Auth Extensions

### Goals
Build the account-lifecycle endpoints the frontend already has UI for for but the backend never implemented: `signup`, `verify-otp` (email-verification-on-activation, not recurring MFA — confirmed by reading the actual frontend flow), `accept-invite`, `forgot-password`/`reset-password`.

### Key Deliverables
1. A new `UserToken` entity — one table, one `purpose` enum (`email_verification` | `invite` | `password_reset`), reused across all three flows instead of cluttering `User` with token-specific columns — same design philosophy as `refresh_tokens` getting its own table in Phase 2.
2. `POST /auth/signup` — creates a user with a password immediately (unlike admin-provisioned users), issues an email-verification OTP.
3. `POST /auth/verify-otp` — validates the OTP, activates the account, and issues real session cookies (matching the frontend's existing behavior of logging the user in immediately after verification).
4. `UsersService.create()` extended to also issue an invite token; `POST /auth/accept-invite` validates it, sets the password, and issues a fresh OTP (accept-invite feeds into the same verify-otp step as signup, per the existing frontend flow).
5. `POST /auth/forgot-password` (generic response regardless of whether the email exists) / `POST /auth/reset-password` (validates the reset token, sets a new password, revokes all existing refresh tokens for that user).
6. Real email delivery stays mocked (`Logger`-logged), not actually sent — the same disclosed scope boundary as everywhere else "sending a real email" comes up.
7. A short doc note reconciling this phase against `PRD.md` Section 1.4, which originally scoped signup/2FA out — updated explicitly, not silently overridden, since this was a deliberate later decision.

> **Checkpoint:** full signup → verify-otp → logged-in cycle, and full accept-invite → verify-otp → logged-in cycle, and full forgot-password → reset-password → re-login cycle, all verified live.

---

## Phase 9 — Global `/api` Prefix

### Goals
Close a real mismatch found during frontend-integration planning: the frontend's `NEXT_PUBLIC_API_BASE_URL` already points at `.../api`, but every backend route so far has been unprefixed (`/auth/...`, `/users/...`).

### Key Deliverables
1. `app.setGlobalPrefix('api')` in `main.ts`, with `/health` excluded from the prefix (orchestrators/ops tooling expect health checks at a conventional, unprefixed path).

> **Checkpoint:** every existing endpoint re-verified at its new `/api/...` path before frontend integration begins.

---

## Phase 10 — Swagger / OpenAPI

### Goals
Full interactive API docs at `/docs`, matching real DTOs/entities (not hand-maintained separately from the code).

### Key Deliverables
1. `@nestjs/swagger` wired in `main.ts`.
2. `@ApiProperty()` on every DTO field, `@ApiResponse()` per endpoint documenting the envelope shapes from `design.md`.
3. Cookie-auth documented correctly in Swagger (Swagger's default "Bearer token" UI doesn't map cleanly to httpOnly cookies — needs explicit handling/documentation of this mismatch).

---

## Phase 11 — Testing *(deferred until after frontend integration, per explicit direction)*

### Goals
Unit tests for business/security logic branches; e2e tests for full HTTP-contract correctness (per the Q15 distinction in `qa/phase-0-...md`).

### Key Deliverables
1. Unit tests: `AuthService` (password validation, token generation), `PermissionsGuard` (metadata resolution logic), `UsersService`/`ProductsService`/`OrdersService` business rules.
2. E2E tests (`supertest` + a real test DB): login sets cookies with correct flags, refresh rotation actually rotates, protected routes return correct 401/403/200 per role.
3. Understanding-check round on: test doubles (mocks/stubs/fakes) vs. real test DB tradeoffs, CI test DB strategy.

---

## Phase 12 — Final Documentation Pass

### Goals
Consolidate everything into interview-ready reference material.

### Key Deliverables
1. A dedicated `auth-flow.md` — sequence-diagram-style walkthrough of the full login → refresh → logout lifecycle as actually implemented (not just as planned).
2. A dedicated RBAC deep-dive doc, if the schema evolved from what's in `architecture.md`.
3. Lightweight ADRs (Architecture Decision Records) for any decision that changed from what's logged in `design.md`'s Open Design Decisions Log.
4. Final pass on `qa/learning-topics-tracker.md` — every item should be checked off with `(practiced)` by this point.

---

## Phase 13 — Production-Grade Logging

### Goals
Replace Nest's default console-only logger with a real, persistent, structured logging setup — daily-rotated files, a separate error-only file, and an HTTP access log — without touching any of the existing `new Logger(ClassName.name)` call sites scattered across the app.

### Key Deliverables
1. `common/logger/winston.config.ts` — Winston + `winston-daily-rotate-file`: a combined daily file (`logs/application-%DATE%.log`), an error-only daily file (`logs/error-%DATE%.log`), plus daily exception/rejection-handler files, all gzipped and pruned on a retention window. Console output stays Nest's familiar colorized format via `nest-winston`'s `utilities.format.nestLike()`.
2. `main.ts` — `NestFactory.create(AppModule, { logger: WinstonModule.createLogger(winstonLoggerOptions) })`, replacing the default logger app-wide.
3. `common/middleware/http-logger.middleware.ts` — one log line per request (method, path, status, duration, IP), applied globally via `AppModule.configure()`, leveled by status code (`error` for 5xx, `warn` for 4xx, `log` otherwise).

See `docs/qa/phase-13-logging-understanding-check.md` and `docs/walkthroughs/phase-13-logging-code-walkthrough.md`.

---

## End-of-Phase Deliverable Protocol

At the end of every phase:
1. Update `qa/learning-topics-tracker.md` — mark items practiced, add any new gaps surfaced during implementation (not just during the Q&A round).
2. Confirm the phase's checkpoint criteria (stated above) before moving on.
3. Only then does the next phase's understanding-check round begin.
