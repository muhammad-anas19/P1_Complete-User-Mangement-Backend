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
