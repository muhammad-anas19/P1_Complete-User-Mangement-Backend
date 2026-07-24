# Backend Product Requirements Document (PRD)

> **Core Architectural Imperative**
> Mirrors the frontend's own framing (see `frontend/docs/PRD.md`): this project's real subject is not "build a CRUD API for a dashboard" — it's proving you can design and reason about **production-grade authentication and authorization** from first principles: httpOnly cookie session management, access/refresh token lifecycle, and RBAC enforced strictly server-side. The Users/Products/Orders CRUD is the vehicle; the auth/RBAC layer is the actual subject being learned and evaluated. This document defines what this backend must deliver to serve the existing frontend (`frontend/`), which was already built against a fixed API contract.

---

## 1. Problem Statement & Scope

### 1.1 Problem Statement
The frontend (Next.js, Feature-Sliced Design) currently runs entirely on mock data and a placeholder JWT-in-localStorage auth flow (see `frontend/src/lib/auth.ts` — explicitly labeled a temporary stand-in). This backend replaces that mock layer with a real NestJS + PostgreSQL API that the frontend can be pointed at, implementing real authentication (httpOnly cookies, not localStorage) and real server-side RBAC enforcement for the three existing roles.

### 1.2 What Already Exists and Constrains This Backend
The frontend was built first and defines a **fixed contract** this backend must satisfy exactly, not redesign:
- Endpoint paths (`frontend/src/lib/api/endpoints.ts`): `/auth/login`, `/auth/logout`, `/auth/refresh`, `/auth/me`, `/auth/forgot-password`, `/auth/reset-password`, plus `/users`, `/products`, `/orders` CRUD.
- Response envelope shape (`frontend/src/types/index.ts`): every response wrapped as `{ success: boolean; data: T; message?: string; timestamp?: string }`.
- Paginated list shape: `{ data: T[]; total: number; page: number; limit: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean }` — note the field is `limit`, not `pageSize`, despite `frontend/docs/architecture.md` documenting `pageSize` loosely; the actual TypeScript type (`PaginatedResponse<T>`) is the source of truth and this backend must match it exactly.
- Error shape: `fetchClient.ts` reads `message` (or falls back to `error`) off the response body for any non-2xx status, and constructs an `ApiError` carrying `statusCode` and the raw body.
- Auth data shape: `User` = `{ id, name, email, role, avatar? }`; roles are the string literals `'Admin' | 'Manager' | 'Viewer'`.

### 1.3 Explicit Deviation From the Frontend Mock (Deliberate, Not a Bug)
The frontend's current `lib/auth.ts` stores tokens in `localStorage` and expects `POST /auth/login` to return an `accessToken`/`refreshToken` in the response body. **This backend deliberately does not do that.** Tokens live only in `httpOnly`, `Secure`, `SameSite=Lax` cookies; the response body from `/auth/login` contains only the `User` object (still wrapped in the standard envelope). This is a known, intentional divergence — the frontend's `lib/auth.ts` and `fetchClient.ts` will need a follow-up rewrite (out of scope for *this* backend-only build) to stop reading tokens from the body and instead rely on `credentials: 'include'` for cookie-based requests.

### 1.4 Out of Scope (This Build)
- **Public self-registration.** The frontend has a `/signup` page, but per the frontend's own PRD, users are provisioned exclusively via an internal `Admin → Users` invite flow. This backend does not implement an open `POST /auth/register`.
- **2FA / OTP verification.** The frontend has a `/verify-otp` page, but 2FA is explicitly deferred (per frontend PRD, Section 6). This backend does not implement OTP generation/verification. `/verify-otp` and `/accept-invite`'s OTP step remain frontend-only mock UI until a dedicated future phase.
- **Products and Orders business logic depth.** This build implements Users + Auth + RBAC fully (the actual learning subject); Products/Orders are scaffolded with the same CRUD/pagination/RBAC pattern once Users is solid, as a repetition exercise, not a source of new concepts.
- **Payment processing, shopper-facing storefronts** — same as frontend scope.

---

## 2. User Roles & Access Control Policy

Reusing the frontend's role definitions exactly (`Admin`, `Manager`, `Viewer`) — this backend is the system that makes the frontend's own disclaimer true:

> "Role-based UI hiding is explicitly a UX convenience, not a security boundary. True security enforcement occurs server-side on API endpoints." — `frontend/docs/PRD.md`

| Role | Backend-Enforced Access Scope |
| :--- | :--- |
| **Admin** | Full CRUD on Users, Products, Orders, Roles/Permissions. Only role permitted to invite/create users and change roles. |
| **Manager** | Read + update on Products and Orders. Read-only on Users (`GET /users`, `GET /users/:id`) — write endpoints reject with `403`. |
| **Viewer** | Read-only across Users, Products, Orders. Any mutating request (`POST`/`PATCH`/`PUT`/`DELETE`) rejected with `403`. |

Modeled as a normalized **roles + permissions** schema (see `architecture.md`), not hardcoded string checks, so this policy is enforced by data (seeded rows) rather than scattered `if (role === 'Admin')` branches — see the RBAC rationale captured in `qa/phase-0-auth-rbac-understanding-check.md` (Q10) for why this was chosen deliberately over a simpler enum for a learning project.

---

## 3. Functional Requirements (API Workflows)

### Workflow 1: Login
- **Given** valid credentials, **when** `POST /auth/login` is called, **then** the server validates input (DTO + `class-validator`), verifies the password hash (Argon2id), issues an access token (short-lived) and refresh token (long-lived, DB-tracked) as separate `httpOnly` cookies, and returns `{ success: true, data: { id, name, email, role } }` — no token in the body.
- **Given** invalid credentials (wrong password *or* unknown email), **then** the server returns a **generic** `401` (`"Invalid email or password"`) — never revealing which factor was wrong (prevents user enumeration).

### Workflow 2: Silent Refresh
- **Given** an expired/near-expired access token, **when** the frontend calls `POST /auth/refresh` (refresh cookie auto-attached by the browser), **then** the server validates the refresh token against its DB record, **rotates** it (invalidates the old one, issues + stores a new one), issues a new access token cookie, and returns the current user payload.
- **Given** a refresh token that has already been rotated/invalidated once (reuse), **then** the server treats this as a theft signal and revokes the entire token family, forcing full re-login.

### Workflow 3: Logout
- **Given** an authenticated session, **when** `POST /auth/logout` is called, **then** the server revokes the refresh token's DB record (so it cannot be used again even if copied) and responds with `Set-Cookie` headers that expire both cookies.

### Workflow 4: Session Rehydration
- **Given** a page load with valid cookies already present, **when** the frontend calls `GET /auth/me`, **then** the server returns the current user's profile from the access token's identity, re-verified against the DB (not blindly trusted from the JWT payload alone, for endpoints where freshness matters — see `qa/phase-0-auth-rbac-understanding-check.md` Q9).

### Workflow 5: Role-Gated Resource Access
- **Given** any request to a protected route, **when** the route is reached, **then** a `JwtAuthGuard` (authentication) and `RolesGuard` (authorization, reading `@Roles(...)` metadata) run before the handler; unauthenticated requests get `401`, authenticated-but-unauthorized requests get `403`.

### Workflow 6: Admin-Only User Provisioning
- **Given** an Admin creating a user via `POST /users`, **then** the system creates a user record in an unverified/invited state (no password set yet) — real invite-token/email-send mechanics are a stretch goal, not required for this build's core scope, but the schema (Section 2, `architecture.md`) accounts for it.

### Workflow 7: Server-Side Pagination Contract
- **Given** `GET /users?page=2&limit=25&search=jane&sort=name_asc`, **then** the server returns exactly the `PaginatedResponse<T>` shape defined in Section 1.2 — field names must match the frontend's real TypeScript type, not the looser description in the frontend's own architecture doc.

---

## 4. Non-Functional Requirements (NFRs)

### Security Baseline (OWASP-aligned — see `rules.md` for the full checklist)
- Passwords hashed with Argon2id (never bcrypt-with-default-cost, never plain SHA-256).
- Rate limiting on `/auth/login` and `/auth/refresh` specifically (brute-force / credential-stuffing mitigation).
- Global `ValidationPipe` — no unvalidated DTO reaches a service or the database.
- Generic error messages on auth failures (no user enumeration).
- No `synchronize: true` — all schema changes ship as reviewed TypeORM migrations.
- Cookies: `HttpOnly`, `Secure` (in production), `SameSite=Lax`, refresh cookie `Path` scoped to `/auth/refresh` only.

### Performance
- Connection pooling correctly sized (see `qa/phase-1-scaffold-db-understanding-check.md` Q6) — no per-request raw connections.
- All list endpoints paginated server-side; the "no client-side filtering of full datasets" rule from the frontend PRD is a two-sided contract — this backend must never require the frontend to fetch an unbounded dataset to filter client-side.

### Architecture & Maintainability
- **Module boundary rule** (backend's equivalent of the frontend's "10-module rule"): a new engineer must be able to add an 8th or 9th domain module (e.g. `inventory`) by copying the `modules/users/` pattern, without touching `common/` internals or asking structural questions.

---

## 5. Architectural Success Criteria ("What 'Done' Means")

As with the frontend, completion is judged by whether you can explain, not just run:

1. **Why httpOnly cookies + refresh rotation**, and what specific attack each layer (HttpOnly, SameSite, CORS, refresh rotation) stops versus what it doesn't.
2. **Why RBAC is enforced via Guards reading DB-backed role/permission data**, not string-literal checks scattered through controllers.
3. **Why migrations, not `synchronize`**, and what a real schema change PR looks like here.
4. **The full NestJS request lifecycle** (Middleware → Guards → Interceptors → Pipes → Handler → Interceptors → Filters) and where each piece of this system's logic lives in it.
5. **What a unit test proves here that an e2e test doesn't, and vice versa**, for the login/refresh/RBAC-protected endpoints specifically.

---

## 6. Explicitly Out of Scope (Recap)

- Public self-registration endpoint.
- 2FA/OTP backend implementation.
- Payment processing, storefront-facing endpoints.
- Real email-sending for invites (schema supports it; sending is a stretch goal).
- Frontend changes — this build is backend-only; the frontend's localStorage-based `lib/auth.ts` remains as-is until a separate, explicit follow-up task.
