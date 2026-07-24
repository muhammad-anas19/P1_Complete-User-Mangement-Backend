# Backend System Architecture & Technical Design

---

## 1. Directory Structure: Domain Modules + Shared Core

Confirmed in `qa/phase-1-scaffold-db-understanding-check.md` (Q9) — organized by **domain**, matching the frontend's own domain-first (FSD) philosophy rather than a technical-layer split (no global `controllers/`, `services/`, `repositories/` dumping grounds).

```
backend/
├── src/
│   ├── modules/
│   │   ├── auth/              # login, logout, refresh, /me — session lifecycle only
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── dto/
│   │   │   └── strategies/    # Passport strategies (jwt-from-cookie, local)
│   │   ├── users/             # user CRUD, invite provisioning
│   │   │   ├── users.module.ts
│   │   │   ├── users.controller.ts
│   │   │   ├── users.service.ts
│   │   │   ├── entities/
│   │   │   └── dto/
│   │   ├── roles/             # roles + permissions domain
│   │   │   ├── roles.module.ts
│   │   │   ├── entities/      # role.entity.ts, permission.entity.ts
│   │   │   └── ...
│   │   ├── products/          # scaffolded after users/auth/roles are solid
│   │   └── orders/
│   ├── common/                 # cross-cutting, NO business logic, NO imports from modules/
│   │   ├── guards/              # JwtAuthGuard, RolesGuard
│   │   ├── decorators/          # @Roles(), @CurrentUser(), @Public()
│   │   ├── filters/              # AllExceptionsFilter
│   │   ├── interceptors/        # LoggingInterceptor, ResponseEnvelopeInterceptor
│   │   └── pipes/                # (mostly relies on global ValidationPipe)
│   ├── config/                  # env validation schema + typed ConfigService wrapper
│   ├── database/                # TypeORM DataSource config + migrations/
│   │   └── migrations/
│   ├── app.module.ts
│   └── main.ts
├── test/                        # e2e tests (supertest + real test DB)
├── docs/                        # this folder
├── .env.example
└── package.json
```

### Layer Responsibility Rules

| Layer | May import from | Rule |
| :--- | :--- | :--- |
| `modules/*` | `common/`, `config/`, other modules' **exported** providers only | Owns one business domain end-to-end (controller → service → entity). Never reaches into another module's internals — only what that module explicitly exports. |
| `common/` | *(nothing from `modules/`)* | Strictly generic, reusable across any domain. If a guard/interceptor needs to know about a specific entity's business rules, it doesn't belong in `common/`. |
| `config/` | *(nothing)* | Pure configuration/env concerns only. |
| `database/` | `config/` | Migrations and DataSource wiring only — no business logic. |

> **Strict Import Rule (mirrors the frontend's own rule):** `common/` and `config/` must never import from `modules/*`. A dependency arrow only ever points from a feature module *inward* toward shared code, never the other way — the same rule the frontend enforces between `shared` and `features`.

---

## 2. Request Lifecycle

Every request passes through this pipeline in order (full explanation in `qa/phase-0-auth-rbac-understanding-check.md` Q13):

```
Request
  → Middleware        (cookie-parser, raw logging)
  → Guards             (JwtAuthGuard → authentication, RolesGuard → authorization)
  → Interceptors (pre)  (request timing start, audit-log entry point)
  → Pipes              (global ValidationPipe — DTO validation/transformation)
  → Route Handler       (controller method — thin, delegates to service)
  → Interceptors (post) (wraps success responses in the ApiEnvelope shape)
  → Exception Filters   (catches anything thrown anywhere above; normalizes to
                         the same ApiEnvelope error shape)
Response
```

---

## 3. Authentication Architecture

### 3.1 Cookie-Based Session, Not localStorage
Two `httpOnly` cookies, set on the response, never touched by client JS:

| Cookie | Contents | Lifetime | `Path` | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `access_token` | Signed JWT — `{ sub, email, role, iat, exp }` | ~15 min | `/` | Stateless; verified by signature only, no DB hit on every request (see Q9 tradeoff in `qa/phase-0-...md`) |
| `refresh_token` | Opaque random token (or signed JWT with a `jti`) | ~7–30 days | `/auth/refresh` | **Stateful** — a hashed copy is stored in the `refresh_tokens` table, enabling revocation and rotation-reuse detection |

Both cookies: `HttpOnly`, `Secure` (production), `SameSite=Lax`.

### 3.2 Token Lifecycle
```
Login ──► issue access_token + refresh_token (DB row created for refresh_token)
            │
            ▼ (≈15 min later, access_token expiring)
     Frontend calls POST /auth/refresh
            │
            ▼
   Validate refresh_token against DB row
     ├─ valid & not yet rotated  → rotate: invalidate old row, insert new row,
     │                              issue new access_token + refresh_token cookies
     └─ already-rotated (reuse!) → revoke entire token family, force re-login
```

### 3.3 Password Storage
Argon2id, salted (built into the library's output), with an application-wide pepper (from `JWT_SECRET`-style env var, never stored in the DB) mixed in before hashing. Full rationale: `qa/phase-0-auth-rbac-understanding-check.md` Q7.

---

## 4. RBAC Architecture

### 4.1 Schema (see `Q10` rationale for why normalized over hardcoded enum)
```
users ─────< user_roles >───── roles ─────< role_permissions >───── permissions
 (1:N via join table,     (each role is a named bundle
  though this project      of permissions — e.g. "Manager"
  seeds exactly one        = {products:read, products:update,
  role per user)             orders:read, orders:update, users:read})
```

### 4.2 Enforcement Flow
1. `JwtAuthGuard` verifies the `access_token` cookie's signature, decodes `{ sub, role }`, attaches to `request.user`.
2. `RolesGuard` reads `@Roles('Admin', 'Manager')` metadata (set via `Reflector`) off the route handler, compares against `request.user.role` (or resolved permissions), throws `403` on mismatch.
3. Applied per-route: `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('Admin') @Delete(':id')`.

---

## 5. Standardized API Contract

**This is fixed by the frontend already built — not a design choice made here.** See `frontend/src/types/index.ts` for the source of truth.

### Success Envelope
```typescript
interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
  timestamp?: string;
}
```

### Paginated List Response
```typescript
interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;        // NOT "pageSize" — must match the frontend type exactly
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}
```

### Error Response
Any non-2xx must include a `message` field (the frontend's `fetchClient.ts` reads `body.message ?? body.error ?? response.statusText`), wrapped so `success: false` is present. A global `AllExceptionsFilter` normalizes every thrown exception — Nest's own `HttpException`s, TypeORM errors, unexpected 500s — into this one consistent shape.

---

## 6. Database Access Architecture

- **ORM:** TypeORM (chosen over Prisma — rationale in `qa/phase-1-scaffold-db-understanding-check.md` Q5), Repository pattern via `@InjectRepository()` + `TypeOrmModule.forFeature([...])` per module.
- **Migrations:** all schema changes are explicit, reviewed migration files under `src/database/migrations/` — `synchronize` is `false` in every environment, including local dev, so what you test locally matches what ships (see `qa/phase-0-...md` Q11–Q12).
- **Connection pooling:** sized deliberately (see Q6) — `(app instances) × (pool size) < Postgres max_connections`, with headroom for admin tools.

---

## 7. Mock-to-Real Migration Path (Frontend Coordination Note)

The frontend's `entities/*/mock/*.mock.ts` files simulate this exact API shape already (per `frontend/docs/architecture.md` Section 6). Once this backend is running, switching the frontend from mock to real data is meant to be a swap inside `entities/*/api/*.api.ts` only — **except** for auth, where `lib/auth.ts`/`fetchClient.ts` need a deliberate rewrite to drop localStorage/Bearer-header logic in favor of `credentials: 'include'` and no client-side token handling at all. That rewrite is explicitly out of scope for this backend build (see `PRD.md` Section 1.3) but is flagged here so it isn't forgotten.
