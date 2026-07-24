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

---

## Status Snapshot

Last updated: after Phase 2 implementation (schema, migration, and seed all run and verified against the real local Postgres instance).

- Concepts explained and understood: **29**
- Concepts practiced hands-on in real code: **8** (TypeORM connection wiring, liveness/readiness health checks, many-to-many join table, refresh-token rotation schema, `migration:generate` diffing, migration `up()`/`down()` review, soft delete, repository pattern via `forFeature()`)
- Concepts explained but still needing hands-on practice: **3**
- Next update due: after Phase 3 (httpOnly cookie auth) understanding-check.

### Phase 1 Build Notes (things that came up during implementation, not just Q&A)

- **TypeORM version pin:** the npm registry's `latest` tag for `typeorm` resolved to `1.1.0` — a major version released after this agent's knowledge cutoff. Pinned to `^0.3.31` (the long-stable line) instead of building on an unverified API surface. Worth knowing this was a deliberate, disclosed choice, not an oversight — revisit if you want to track TypeORM's v1 migration guide later as its own learning exercise.
- **Removed Nest's default boilerplate** (`app.controller.ts`/`app.service.ts`, the "Hello World" generated by `nest new`) since it didn't belong to any real domain module — first practical example of the "no stray files outside `modules/`" rule from `architecture.md`.

### Phase 2 Build Notes

- **`Object` type not supported by Postgres** — TypeORM couldn't infer a column type for `string | null` union-typed fields (`avatarUrl`, `ipAddress`, `userAgent`) via `reflect-metadata`; fixed by adding an explicit `type: 'varchar'` on those columns. Worth remembering: any nullable/union-typed TS field needs an explicit `type` in `@Column()`, not just relying on inference.
- **`uuid-ossp` extension** was already enabled in the fresh `p1_dashboard_dev` database (inherited from `template1`, likely from earlier setup on this machine for another project) — confirmed before running the migration rather than assuming it. Worth knowing that on a genuinely fresh Postgres install, this may need `CREATE EXTENSION "uuid-ossp"` explicitly (TypeORM's migration runner does attempt `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` automatically on connect, so this is normally handled — confirmed in the actual query log during `migration:run`).
- **Idempotent seed script verified for real** — ran the seed twice; first run created 12 permissions + 3 roles, second run logged "updated role" with zero new rows, confirmed by querying `role_permissions` counts directly (Admin: 12, Manager: 5, Viewer: 3 — matches `PRD.md` Section 2 exactly).
