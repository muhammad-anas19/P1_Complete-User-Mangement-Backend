# Backend Conventions & Coding Rules

---

## 1. Naming Conventions

### File & Directory Naming
- **Files:** kebab-case, suffixed by role — `user.controller.ts`, `user.service.ts`, `user.module.ts`, `user.entity.ts`, `create-user.dto.ts`, `roles.guard.ts`, `jwt-auth.guard.ts`.
- **Folders:** kebab-case, one per domain module (`modules/users/`, `modules/refresh-tokens/` if split out).
- **Test files:** colocated, `<name>.spec.ts` for unit tests; e2e tests live under `test/`, named `<flow>.e2e-spec.ts` (e.g. `auth.e2e-spec.ts`).

### Code Naming
- **Classes:** PascalCase, suffixed by role (`UsersService`, `CreateUserDto`, `JwtAuthGuard`) — matches Nest CLI generator conventions exactly, don't deviate.
- **Interfaces/Types:** PascalCase, descriptive noun, no `I` prefix (matches the frontend's own rule — e.g. `UserPayload`, not `IUserPayload`).
- **Constants/env keys:** `SCREAMING_SNAKE_CASE` for actual environment variable names (`DATABASE_URL`, `JWT_ACCESS_SECRET`); camelCase for the typed config object properties that read them (`config.jwtAccessSecret`).

---

## 2. Module & Component Conventions

- **One responsibility per module.** A module owns a business domain end-to-end (controller, service, entities, DTOs) — never a technical layer.
- **Controllers stay thin.** No business logic, no direct repository/DB access in a controller — it validates via DTO/pipes, delegates to a service method, returns the result. If a controller method is more than ~10–15 lines, that's a signal logic leaked in from the service layer.
- **Services never touch `Request`/`Response` objects directly.** Keeps business logic framework-agnostic and unit-testable without mocking HTTP internals.
- **Constructor injection only.** Never `new SomeService()` inside another class — always inject via the constructor, per the DI rationale in `qa/phase-1-scaffold-db-understanding-check.md` Q2.
- **`common/` has zero business logic.** If a guard/interceptor/pipe needs to know a specific entity's business rules, it doesn't belong in `common/` — it belongs in that module.

---

## 3. API & Validation Conventions

(Full detail in `design.md` — this is the enforceable checklist version.)

- Every request body has a typed DTO validated by `class-validator`; global `ValidationPipe` uses `whitelist: true, forbidNonWhitelisted: true`.
- Every list endpoint is server-paginated per the `PaginatedResponse<T>` contract — never returns an unbounded array.
- Every protected route declares its required role(s) explicitly via `@Roles(...)` — no route relies on "probably fine" implicit protection.
- Every entity excludes sensitive fields (`passwordHash`, token secrets) from serialization via `@Exclude()` + `ClassSerializerInterceptor` — never manually stripped per-method.
- Sort/filter query params are validated against an explicit allow-list per entity — never interpolated directly into a query.

---

## 4. Security Checklist (Backend's Equivalent of the Frontend's a11y Checklist)

Before any auth-adjacent endpoint is considered complete:

- [ ] Passwords hashed with Argon2id — never stored plaintext, never logged (including in error messages/stack traces).
- [ ] Auth failure messages are generic (no user enumeration) — see `design.md` Section 6.
- [ ] Rate limiting applied to `/auth/login` and `/auth/refresh`.
- [ ] Cookies set with `HttpOnly`, `Secure` (prod), `SameSite=Lax`, and correctly scoped `Path`.
- [ ] Refresh tokens are DB-tracked and revocable; rotation + reuse-detection implemented before Phase 3 is considered done (not deferred silently to "later").
- [ ] No `synchronize: true` in any environment, including local dev.
- [ ] CORS configured with an explicit origin allow-list + `credentials: true` — never a wildcard origin combined with credentials.
- [ ] No stack traces or raw DB errors ever reach a client response body, in any environment reachable by real traffic.
- [ ] Every migration reviewed against the "what not to put in a migration" checklist (`qa/phase-0-auth-rbac-understanding-check.md` Q12) before merging.

---

## 5. Testing Rules

- **Unit tests** cover business/security logic branches in isolation (services, guards' metadata-resolution logic) — dependencies mocked via `overrideProvider`/`useValue`, no real DB, no real HTTP.
- **E2E tests** cover full HTTP-contract behavior against a real test database (`supertest` + `Test.createTestingModule`) — cookie flags actually set, correct status codes through the real guard/pipe/filter chain, not just service-level assertions.
- A new endpoint isn't "done" until it has at least one unit test (happy path + at least one failure branch) and one e2e test (status code + shape) — matching the dual-coverage rule explained in `qa/phase-0-...md` Q15.
- Test database is separate from the dev database (`p1_dashboard_test` vs. `p1_dashboard_dev`) — e2e tests never run against dev data.

---

## 6. Git & Commit Conventions

Matches the frontend's convention exactly, for consistency across the whole project:

`<type>(<scope>): <short summary>`

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore` (config/tooling changes with no logic impact — added here vs. the frontend's list since backend config/env work comes up more often).

Example: `feat(auth): add refresh token rotation with reuse detection`

---

## 7. Migration Rules (Recap — Full Rationale in `qa/phase-0-...md` Q11–Q12)

- Every schema change is a migration file, reviewed in a PR like any other code change.
- Migrations never contain: bulk/fake data, business logic, secrets, large inline destructive backfills.
- Reference/lookup data with a fixed, small cardinality (e.g. seeding the 3 roles) is a defensible exception — kept in a clearly-named seed migration or separate seed script, not mixed into a schema-altering migration.
- Once a migration has been applied anywhere outside your own machine, it's immutable — fix mistakes with a new migration, never edit history.

---

## 8. Documentation Rules

- Every phase gets a Q&A doc in `qa/` **before** its implementation begins — no exceptions, no skipping ahead (see `phases.md`).
- `qa/learning-topics-tracker.md` is updated at the end of every phase, not just at the start of the project.
- Any decision that deviates from what's recorded in `design.md`'s Open Design Decisions Log gets logged there, not left undocumented in a commit message alone.
