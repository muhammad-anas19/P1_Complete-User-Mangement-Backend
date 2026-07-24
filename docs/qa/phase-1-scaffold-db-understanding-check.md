# Phase 1 — Understanding Check: Scaffold, Config, DB Connection

> Companion to [phase-0-auth-rbac-understanding-check.md](phase-0-auth-rbac-understanding-check.md). Same format: your answer, verdict, then full expansion. This phase covers project skeleton, environment/config handling, and Postgres connectivity — no auth logic yet.
>
> **Standing practice going forward:** every phase in this project gets its own `phase-N-<topic>-understanding-check.md` in this folder, written the same way, whether or not you ask for it explicitly. Treat this whole `docs/` folder as your interview-prep archive for the project.

## Overall Verdict

**Ready to proceed to Phase 1 implementation**, pending two small operational decisions from you (not understanding gaps — just choices I need to build the config around): ORM choice (see Q5) and your actual local Postgres connection details (see Q8 follow-up, below the table). Your grasp of *why* these mechanisms exist (fail-fast config, connection pooling causing latency, health checks signaling liveness) is correct at the instinct level in every case — the expansions below add the production-grade vocabulary and the second-order failure modes worth having ready for an interview.

| Q | Topic | Status |
|---|---|---|
| 1 | NestJS module purpose | ✅ Correct shape, one naming/mechanism correction |
| 2 | DI and testability | ✅ Correct instinct, expanded to the actual mechanism (mock injection) |
| 3 | Fail-fast env validation | ✅ Correct |
| 4 | `.env.example` / secrets | ✅ Correct, already knows the real pattern |
| 5 | TypeORM vs. Prisma | 🔲 New topic — explained below, recommendation given, needs your confirm |
| 6 | Connection pooling | ⚠️ Right direction (latency), missing the more severe failure mode (connection exhaustion) |
| 7 | Health check endpoint | ✅ Correct instinct, expanded to liveness vs. readiness |
| 8 | Docker vs. existing Postgres | ✅ Decision made (no Docker) — needs one follow-up detail before I can configure it |
| 9 | Folder structure (domain vs. layer) | ✅ Correct choice (domain/feature-based), one naming convention correction |

---

## Q1 — What is a NestJS module for

**Your answer:** Each feature has a controller, repository, and module file; the module binds them together; `AppModule` binds all the feature modules.

**Correction on the trio:** the three files that are *always* there per feature are actually **Controller** (HTTP layer only — routes, request/response shape, delegates work, contains no business logic itself), **Service** (the actual business logic, framework-agnostic, injectable), and **Module** (a metadata class — `@Module({ controllers, providers, imports, exports })` — that declares what this feature owns and what it's willing to share). **Repository** isn't a fourth hand-written file in the typical case: once you register an entity via `TypeOrmModule.forFeature([User])` inside a module's `imports`, you get a ready-made repository for that entity via `@InjectRepository(User)` — you only hand-write a custom repository class if you need extra query methods beyond what TypeORM's default repository gives you.

**What actually breaks with one giant `AppModule`:**
- **No encapsulation.** A module can choose *not* to `export` a provider, meaning other modules can't reach in and depend on it even if they wanted to. One giant module has no such boundary — everything is implicitly reachable from everywhere, which is the exact same failure mode the frontend's FSD rules are designed to prevent (`shared` code silently depending on `features` code because nothing stopped it).
- **No isolated testing at the module level.** `Test.createTestingModule({ imports: [UsersModule] })` lets you spin up *just* the Users feature with its real DI graph for an integration test. If everything lives in one `AppModule`, there's no smaller unit to spin up — every test drags in the entire app's providers.
- **Circular dependencies become invisible instead of explicit.** Nest builds a dependency graph *between modules*. If `AuthModule` needs `UsersModule` and `UsersModule` somehow needs `AuthModule` back, Nest can surface that as a real, nameable problem (solved deliberately via `forwardRef()`) — inside one flat module, that same circular logic just becomes a tangle you can't see until something breaks at runtime.
- **No reuse boundary.** A self-contained `UsersModule` can be imported by `AuthModule`, `OrdersModule`, etc., each only seeing its exported surface (e.g., `UsersService`), not its internals (repository, DTOs). One giant module has no "internals" to hide.

---

## Q2 — Dependency Injection and testing

**Your answer:** Avoids having to keep irrelevant services around when testing one specific feature.

**Expansion — the actual mechanism, not just the benefit:** the real power isn't "fewer services lying around," it's that a unit test can **substitute a fake object in place of a real dependency**, and the class under test has no idea the difference. Say `AuthService` depends on `UsersService` (constructor: `constructor(private usersService: UsersService)`). To unit test `AuthService.login()`, you don't want a real `UsersService` backed by a real Postgres connection — you want to hand `AuthService` something like:

```ts
const fakeUsersService = { findByEmail: jest.fn().mockResolvedValue(fakeUser) };
```

Because NestJS's DI container is the thing deciding what gets handed to `AuthService`'s constructor (not `AuthService` itself deciding, via `new UsersService()`), a test module can override that decision: `Test.createTestingModule({...}).overrideProvider(UsersService).useValue(fakeUsersService)`. `AuthService`'s code never changes — it just calls `this.usersService.findByEmail(...)` and gets back whatever was injected, real or fake. This property — **the class doesn't choose its own dependencies, something external does** — is called **Inversion of Control**, and DI is the specific pattern that implements it. If `AuthService` did `new UsersService()` internally, that line is hardcoded; no test could ever intercept it, meaning you could not unit test `AuthService.login()` without a live database. This is precisely why constructor injection isn't just a style preference in Nest — it's the thing that makes isolated unit testing *possible at all*.

---

## Q3 — Fail-fast environment validation

**Your answer:** Correct — a live deploy that later fails because of a missing env var is a disaster.

**The formal name for this pattern is fail-fast validation**, usually implemented as a schema check (Joi, Zod, or `class-validator` on a config class) run once at application bootstrap, *before* the Nest application context is even created. It validates things like: `DATABASE_URL` is a well-formed connection string, `JWT_SECRET` meets a minimum length (a short secret is brute-forceable), `NODE_ENV` is one of an allowed enum. If validation fails, the process throws and exits with a non-zero code immediately. Why that specific detail (non-zero exit) matters: in an orchestrated environment (Docker, Kubernetes, most PaaS), the deployment tooling watches the container's exit code / health status to decide whether a deploy succeeded. A container that crashes immediately on a bad config is a *loud, pre-traffic* failure the deploy pipeline can catch and refuse to roll forward on. A container that boots "successfully" (port open) but explodes the first time a real user hits `/auth/login` because `JWT_SECRET` was `undefined` is a *silent, post-traffic* failure — much worse, because real users hit it before anyone notices.

---

## Q4 — `.env.example` and secrets in CI/CD

**Your answer:** Secret managers (AWS, etc.) supply real values to CI/CD; locally, an `.env.example` file lists the keys without values. Correct — this is exactly the real-world pattern.

One detail worth stating precisely for later: `.env.example` **is committed to git** (it's documentation, not a secret — e.g. `JWT_SECRET=replace-with-a-real-32-char-random-secret`), while the actual `.env` (holding real values, even for local dev) is git-ignored. In CI/CD and production, environment variables are injected at deploy/run time from the platform's secret store (AWS Secrets Manager/Parameter Store, GitHub Actions secrets, etc.) — never read from a file that exists in the repo. We'll add a `.env.example` in Phase 1 as part of the scaffold.

---

## Q5 — TypeORM vs. Prisma (you asked for the full explanation)

Both are legitimate, production-used choices. Here's the concrete tradeoff, not "one is newer":

| | TypeORM | Prisma |
|---|---|---|
| Schema definition | Decorator-based TypeScript classes (`@Entity()`, `@Column()`) — the entity *is* a normal class, which fits NestJS's decorator-heavy style very naturally | A separate DSL file (`schema.prisma`), not TypeScript — a code generator reads it and produces a fully-typed `PrismaClient` |
| Integration with Nest's DI/repository pattern | Very idiomatic — `@InjectRepository(User)` gives you a repository instance directly through Nest's DI container, matching the constructor-injection style you just learned about in Q2 | Less idiomatic — you typically hand-write a small `PrismaService` (a Nest provider wrapping `PrismaClient`) and inject *that* everywhere; there's no per-entity repository object, just one client with `.user.findMany()` style methods |
| Migrations | Can auto-**generate** a migration by diffing your entity classes against the DB, but the generated SQL sometimes needs manual review/correction — more moving parts, more chances to learn (and hit) sharp edges | Best-in-class migration DX (`prisma migrate dev`) — very reliable, rarely needs manual correction, but that also means you see less of the raw SQL machinery underneath |
| Type safety | Reasonable, but querying (especially relations/joins) is easier to get subtly wrong without full compile-time safety | Extremely strong — the generated client makes most incorrect queries a compile error, not a runtime bug |
| Raw SQL visibility | Closer to hand-written SQL feel — you see and reason about actual queries more directly | More abstracted — excellent DX, but you rely on Prisma's query engine more as a black box |

**My recommendation for this specific project: TypeORM.** Reasoning specific to your stated goals, not a generic "pick one": (1) it integrates directly with the exact DI/repository pattern you're currently learning in Phase 1 — reinforcing rather than sidestepping it; (2) most NestJS + Passport + RBAC tutorials and real production NestJS codebases you'll encounter in the wild (and in interviews) use TypeORM, so the patterns you learn transfer directly; (3) since one of your explicit Phase-0 goals was to *actually understand migrations deeply* (not just run a command that magically works), TypeORM's slightly rawer migration experience means you'll see more of the actual SQL underneath, which is the point of this being a learning project rather than a production speed-run.

**This is a recommendation, not a decision I'm making unilaterally** — confirm TypeORM, or tell me if you'd rather go with Prisma for its superior type-safety DX, and I'll proceed with whichever you pick.

---

## Q6 — Why not open a new Postgres connection per request

**Your answer:** Correct direction — opening a connection per request adds latency (connect, then query). That's real, but there's a more severe failure mode worth knowing.

**The bigger issue: connection exhaustion, not just latency.** Postgres has a **hard cap on total concurrent connections** (default `max_connections` is commonly 100), and each open connection consumes real server-side memory (a few MB, non-trivial at scale) regardless of whether it's actively running a query. If your app opens a brand-new raw connection per incoming HTTP request, under even moderate concurrent traffic you can exhaust that connection limit within seconds — at which point Postgres starts **rejecting new connections outright**, meaning every subsequent request fails completely, not just slowly. This is a full outage, not degraded performance.

**The standard mechanism: a connection pool.** A pool pre-establishes a fixed number of real connections once, and hands them out to requests on demand, returning them to the pool when the request finishes (rather than closing the physical connection). TypeORM's underlying driver (`pg`) manages this pool for you, configured with a `max` pool size. Getting the pool size wrong has two distinct failure shapes: **too small** under real traffic → requests queue waiting for a free connection from the pool, causing latency spikes and eventual timeouts even though Postgres itself isn't at its limit; **too large**, especially once you run multiple app instances (e.g., 3 replicas × pool size 50 = 150 possible connections) → you can exceed Postgres's actual `max_connections` even though no single instance looks unreasonable on its own. Correct sizing has to account for `(number of app instances) × (pool size per instance) < Postgres max_connections`, with headroom left for admin tools (like your pgAdmin session) and any other services sharing the same database.

---

## Q7 — Health check endpoints

**Your answer:** Signals whether the running container is healthy. Correct instinct — worth the more precise vocabulary.

Production orchestrators (Kubernetes, ECS, most PaaS platforms) typically distinguish two kinds of checks:
- **Liveness** — "is this process alive and not deadlocked/hung?" If this fails repeatedly, the orchestrator **kills and restarts** the container — it assumes the process itself is broken beyond recovery.
- **Readiness** — "is this specific instance currently able to serve real traffic right now?" (e.g., can it actually reach the database at this moment?) If this fails, the orchestrator **stops routing new traffic to it** without necessarily restarting it — useful during a temporary DB failover, for instance, where restarting the app wouldn't help anyway.

**What breaks without either:** the orchestrator falls back to a much weaker signal — usually just "is the TCP port open." A NestJS app can have its HTTP port open and accepting connections while its database connection is completely dead (e.g., Postgres restarted, credentials rotated) — the port-open check reports "healthy," so the load balancer keeps sending real user traffic to an instance that will 500 on every single request. It also breaks **rolling deployments**: without a readiness check, the orchestrator has no reliable way to know when a *newly started* instance is actually ready to receive traffic (vs. still connecting to its DB), which causes brief user-facing errors during every single deploy.

---

## Q8 — Docker Compose vs. existing Postgres

**Your answer:** You have pgAdmin installed, so you don't need Docker.

**One clarification needed before I can wire the config:** pgAdmin is a GUI *client* — it doesn't run a Postgres server itself, it connects to one. So I need to know: do you already have an actual Postgres **server** running locally (e.g. the native Windows Postgres installer, which is what pgAdmin usually gets bundled with) that pgAdmin is currently pointed at? If so, tell me:
- Postgres version (visible in pgAdmin, or `SELECT version();`)
- Host/port it's running on (commonly `localhost:5432`)
- The username you connect with (commonly `postgres`)
- Whether you want me to create a fresh, dedicated database for this project (recommended — e.g. `p1_dashboard_dev`) rather than reusing an existing one

I'll use these to write the `.env.example` and the TypeORM connection config in Phase 1.

---

## Q9 — Folder structure: domain-based vs. layer-based

**Your answer:** Domain-based — `modules/user/user.module`, plus repository and controller files per feature. Correct choice, matches the recommendation.

**One naming convention correction:** NestJS community convention is `user.module.ts`, `user.controller.ts`, `user.service.ts`, `user.entity.ts` — there generally isn't a separate `repository.module.ts` file, because (as covered in Q1) the repository for an entity comes from registering that entity in the module's `imports: [TypeOrmModule.forFeature([User])]`, not from a hand-written repository module. You'd only add a `user.repository.ts` file if you're writing a **custom repository class** with extra query methods beyond the default CRUD ones TypeORM already provides — which is an addition to the module, not a replacement for it.

**Confirmed structure for this project (Phase 1 will scaffold this):**
```
src/
├── modules/
│   ├── auth/         (auth.module.ts, auth.controller.ts, auth.service.ts, dto/, strategies/)
│   ├── users/         (users.module.ts, users.controller.ts, users.service.ts, users.entity.ts, dto/)
│   └── roles/         (roles.module.ts, roles.entity.ts, permissions.entity.ts, ...)
├── common/            (guards/, decorators/, filters/, interceptors/, pipes/ — cross-cutting, shared by all modules)
├── config/            (env validation schema, typed config service)
└── main.ts
```
This mirrors the frontend's `entities`/`shared` separation conceptually: `modules/*` are the domain-owning pieces (like FSD's `entities`/`features`), `common/` is the strictly-shared, no-business-logic layer (like FSD's `shared`).

---

## Open Items Before Phase 1 Scaffolding Begins

1. **TypeORM vs. Prisma** — confirm TypeORM (recommended above) or tell me you want Prisma instead.
2. **Postgres connection details** — version, host/port, username, and whether to create a new dedicated dev database.

Once both are answered, I'll scaffold the NestJS project, `common/`/`config/`/`modules/` structure, env validation, the Postgres connection, and a `/health` endpoint — then move to Phase 2 (schema + migrations) with its own understanding-check round.
