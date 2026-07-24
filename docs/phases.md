# Backend Implementation & Build Phases

---

## Phase Overview

```
┌───────────────────────────────────────────────────────────────┐
│ Phase 0: Understanding Check — Auth & RBAC concepts            │  ✅ Complete
└───────────────────────────────────┬───────────────────────────┘
                                     ▼
┌───────────────────────────────────────────────────────────────┐
│ Phase 1: Scaffold, Config, Postgres Connection                 │  ◄─ current
└───────────────────────────────────┬───────────────────────────┘
                                     ▼
┌───────────────────────────────────────────────────────────────┐
│ Phase 2: Database Schema + TypeORM Migrations                  │
└───────────────────────────────────┬───────────────────────────┘
                                     ▼
┌───────────────────────────────────────────────────────────────┐
│ Phase 3: httpOnly Cookie Auth (login/logout/refresh)           │
└───────────────────────────────────┬───────────────────────────┘
                                     ▼
┌───────────────────────────────────────────────────────────────┐
│ Phase 4: RBAC Guards + Admin User Management Endpoints          │
└───────────────────────────────────┬───────────────────────────┘
                                     ▼
┌───────────────────────────────────────────────────────────────┐
│ Phase 5: Hardening (rotation, CSRF, rate limiting, filters)     │
└───────────────────────────────────┬───────────────────────────┘
                                     ▼
┌───────────────────────────────────────────────────────────────┐
│ Phase 6: Swagger / OpenAPI Documentation                        │
└───────────────────────────────────┬───────────────────────────┘
                                     ▼
┌───────────────────────────────────────────────────────────────┐
│ Phase 7: Unit + E2E Test Suites                                 │
└───────────────────────────────────┬───────────────────────────┘
                                     ▼
┌───────────────────────────────────────────────────────────────┐
│ Phase 8: Final Docs Pass (auth-flow deep-dive, ADRs, review)    │
└───────────────────────────────────────────────────────────────┘
```

**Standing rule for every phase:** before implementation starts, an understanding-check Q&A round happens first (documented in `qa/phase-N-*.md`), gaps get added to `qa/learning-topics-tracker.md`, and only after that is code written. No phase skips this gate.

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

## Phase 6 — Swagger / OpenAPI

### Goals
Full interactive API docs at `/docs`, matching real DTOs/entities (not hand-maintained separately from the code).

### Key Deliverables
1. `@nestjs/swagger` wired in `main.ts`.
2. `@ApiProperty()` on every DTO field, `@ApiResponse()` per endpoint documenting the envelope shapes from `design.md`.
3. Cookie-auth documented correctly in Swagger (Swagger's default "Bearer token" UI doesn't map cleanly to httpOnly cookies — needs explicit handling/documentation of this mismatch).

---

## Phase 7 — Testing

### Goals
Unit tests for business/security logic branches; e2e tests for full HTTP-contract correctness (per the Q15 distinction in `qa/phase-0-...md`).

### Key Deliverables
1. Unit tests: `AuthService` (password validation, token generation), `RolesGuard` (metadata resolution logic), `UsersService` business rules.
2. E2E tests (`supertest` + a real test DB): login sets cookies with correct flags, refresh rotation actually rotates, protected routes return correct 401/403/200 per role.
3. Understanding-check round on: test doubles (mocks/stubs/fakes) vs. real test DB tradeoffs, CI test DB strategy.

---

## Phase 8 — Final Documentation Pass

### Goals
Consolidate everything into interview-ready reference material.

### Key Deliverables
1. A dedicated `auth-flow.md` — sequence-diagram-style walkthrough of the full login → refresh → logout lifecycle as actually implemented (not just as planned).
2. A dedicated RBAC deep-dive doc, if the schema evolved from what's in `architecture.md`.
3. Lightweight ADRs (Architecture Decision Records) for any decision that changed from what's logged in `design.md`'s Open Design Decisions Log.
4. Final pass on `qa/learning-topics-tracker.md` — every item should be checked off with `(practiced)` by this point.

---

## End-of-Phase Deliverable Protocol

At the end of every phase:
1. Update `qa/learning-topics-tracker.md` — mark items practiced, add any new gaps surfaced during implementation (not just during the Q&A round).
2. Confirm the phase's checkpoint criteria (stated above) before moving on.
3. Only then does the next phase's understanding-check round begin.
