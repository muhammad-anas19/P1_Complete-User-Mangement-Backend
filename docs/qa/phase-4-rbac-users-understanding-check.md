# Phase 4 — Understanding Check: RBAC Guards & User Management

> Same format as [phase-3](phase-3-cookie-auth-understanding-check.md): explanations written directly, at your request, before any code exists. This doubles as the design spec for what gets implemented right after. A few questions here (Q3, Q6, Q7) involve a real architecture decision, not just a concept — I give my recommendation and reasoning, then implement accordingly unless you say otherwise.

---

## Q1 — How a Guard reads decorator metadata (`SetMetadata` + `Reflector`)

This is the one genuinely new mechanism this phase. `JwtAuthGuard` didn't need it — it just delegates entirely to Passport. `RolesGuard`/`PermissionsGuard` is different: it needs to know, for *this specific route*, what was written above it as a decorator.

**`SetMetadata(key, value)`** is a NestJS function that returns a decorator attaching arbitrary metadata to a class or method — stored via `reflect-metadata`, the same underlying mechanism `emitDecoratorMetadata` uses for typed parameters. We build our own decorator as a thin wrapper around it:
```ts
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata('permissions', permissions);
```
This is a **different kind of custom decorator** than `@CurrentUser()` from Phase 3. `createParamDecorator` (used for `@CurrentUser()`) *extracts* data **from** the request, for a method parameter. `SetMetadata`-based decorators *attach* static data **to** the route itself, for something else to read back later. Two different jobs, two different decorator factories.

At request time, `PermissionsGuard.canActivate(context: ExecutionContext)` reads it back via `Reflector` (an injectable Nest utility):
```ts
const required = this.reflector.getAllAndOverride<string[]>('permissions', [
  context.getHandler(),
  context.getClass(),
]);
```
- **`context.getHandler()`** returns the actual method reference (e.g. the `deleteUser` function itself) — one of the two extra methods `ExecutionContext` has beyond the plainer `ArgumentsHost` filters get (see the Phase 3 walkthrough's `AllExceptionsFilter` section for that distinction).
- **`context.getClass()`** returns the controller class itself — lets you apply the decorator once at the controller level if every method in it needs the same thing.
- **`getAllAndOverride`** checks both and lets **method-level metadata win** if both are present — "override," not "merge." If neither has it, it returns `undefined` — which is exactly the case Q11 is about.

---

## Q2 — Why `JwtAuthGuard` must run before `RolesGuard`/`PermissionsGuard`

Guards listed in `@UseGuards(A, B)` run **in that order**, and **all** must pass for the request to proceed — if `A` rejects, `B` never runs at all.

`PermissionsGuard`'s entire job is "does `request.user`'s role have the required permission for this route." But `request.user` doesn't exist until `JwtAuthGuard` (via `JwtStrategy.validate()`, Phase 3) has actually populated it from a verified access token. If `PermissionsGuard` ran first — or alone — it would have no reliable way to know *who* is making the request at all. This is the general principle "authentication before authorization": you have to establish *identity* before you can evaluate what that identity is *allowed* to do. Checking permissions against an unauthenticated request isn't "stricter," it's meaningless — there's no verified subject to check permissions against yet.

---

## Q3 — Role-name check vs. resolving full permissions (a real decision, not just a concept)

Two workable designs:

**A. Check role name directly** — `@Roles('Admin', 'Manager')`, guard does `requiredRoles.includes(request.user.role)`. Simple, zero extra DB queries — everything needed is already in the JWT payload from Phase 3.

**B. Resolve full permissions from the DB** — `@RequirePermissions('users:delete')`, guard looks up the *current* permission set for `request.user.role` (a name string from the JWT) and checks membership. Costs one extra query per protected request.

**My recommendation: B.** Reasoning specific to what we've actually built, not a generic "always do fine-grained RBAC": we deliberately built a normalized `roles` ↔ `permissions` ↔ `role_permissions` schema back in Phase 0/2 (`BE-DEC-001`) *specifically* for RBAC learning depth, even though the PRD only strictly needs 3 fixed roles. If enforcement only ever checks the role **name**, that entire schema exists for nothing — none of it is actually exercised by the running app, and this phase would just be re-deriving the "3 hardcoded roles" model we explicitly chose *not* to build. Option B is also cheap here: `Role.permissions` is already `eager: true` (Phase 2), so resolving a role name to its full permission list is a single `rolesRepo.findOne({ where: { name } })` call, not a complex join you write by hand.

**Naming, to be precise about what's actually being checked:** I'll call the decorator `@RequirePermissions(...)` and the guard `PermissionsGuard`, not `@Roles()`/`RolesGuard` — it's checking resolved *capabilities*, not role identity, and the name should say so.

---

## Q4 — Designing the decorator so the PRD's role matrix doesn't get repeated everywhere

Apply the guards **once**, at the controller level, and let each method state only its own specific requirement:
```ts
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)   // applies to every route below
export class UsersController {
  @RequirePermissions('users:read')
  @Get()
  findAll() { ... }

  @RequirePermissions('users:create')
  @Post()
  create() { ... }

  @RequirePermissions('users:delete')
  @Delete(':id')
  remove() { ... }
}
```
This is the same separation as `common/` vs. `modules/` generally: "this whole controller requires being authenticated and permission-checked" is stated once (class-level `@UseGuards`), while "this specific action needs this specific capability" is a one-line decorator per method. Nobody re-writes guard wiring for every endpoint; nobody forgets to protect a new endpoint silently (see Q11 for what happens if they forget the *decorator* specifically).

*(A global `APP_GUARD` + `@Public()` escape-hatch pattern — mentioned as deferred in the Phase 3 doc — becomes worth the extra ceremony once 3–4 controllers all need identical guard wiring, e.g. once Products/Orders exist. For just `UsersController` right now, controller-level `@UseGuards()` is simpler and equally correct.)*

---

## Q5 — Do `GET /users` and `GET /users/:id` need auth?

Yes — **every** Users endpoint requires authentication, full stop. This is an internal admin tool (per `PRD.md`); there is no anonymous read access to a user list, ever. "Read-only for Viewer" does **not** mean "no guard" — it means Viewer's role *has* the `users:read` permission (satisfying the `GET` routes' `@RequirePermissions('users:read')`) but *lacks* `users:create`/`users:update`/`users:delete` (failing those routes' checks, `403`). Per the Phase 2 seed data, `users:read` is granted to Admin, Manager, *and* Viewer — so all three authenticated roles can list/view users, matching the PRD's matrix exactly; only Admin can mutate.

---

## Q6 — `CreateUserDto`: `roleId` vs. a raw `role` string, and the actual risk

**Accept `roleId` (a UUID), not a `role` name string.** The real risk with accepting a raw string: if a client could send `{ "role": "Admin" }` and the service trusted it directly, that's a straightforward privilege-escalation path — either a malicious caller or just a client-side bug could mint an Admin account with zero server-side check that "Admin" is even a real, currently-valid role. A `roleId` forces the value to reference an **actual row** in the `roles` table: the service does `rolesRepo.findOneByOrFail({ id: dto.roleId })`, which throws automatically if the ID doesn't correspond to a real role — no string-matching logic, no risk of a typo silently creating an unenforceable ghost role.

This is **defense in depth**, not the only defense — the primary protection is that `POST /users` itself is only reachable by an Admin at all (`@RequirePermissions('users:create')`, which per the seed only Admin has). But "only Admins can call this endpoint" and "the endpoint still validates what it's given" are two separate, both-necessary layers — never assume the outer guard is the only checkpoint.

---

## Q7 — `DELETE /users/:id`: soft delete, and which status code

**Soft delete**, using TypeORM's `softRemove()`/`softDelete()` — never `remove()`/`delete()`. Exactly the Phase 2 Q10 reasoning: a hard delete either fails on the `refresh_tokens` foreign key, cascades away token history it shouldn't, or orphans records that need to keep pointing at "who did this." One addition to actually implement this phase (flagged back in Phase 2 but not yet built): soft-deleting a user should **also** immediately revoke all of their active `refresh_tokens` rows — removing access and preserving history are two different actions, and both need to happen together.

**Status code: `200 OK` with a minimal envelope body, not `204 No Content`.** REST purism would say `204` for a successful delete with nothing meaningful to return — but `204` responses cannot carry a JSON body at all by HTTP spec, which breaks this project's own rule (`design.md` Section 1) that *every* successful response gets the same `{ success, data, timestamp }` envelope. Returning `200` with `{ success: true, data: { deleted: true }, timestamp }` is a deliberate, disclosed deviation from strict REST convention in favor of contract consistency for the frontend — logged as an open decision below.

---

## Q8 — Where pagination/search/sort logic lives

In the **service layer**, and as a **shared, reusable helper** — not hand-rolled per-controller, and not in the controller at all (`rules.md` Section 2: "controllers stay thin"). Concretely: a shared `PaginationQueryDto` (`page`, `limit`, `search`, `sort`, validated via `class-validator`) that entity-specific query DTOs extend (`ListUsersQueryDto extends PaginationQueryDto { role？: UserRole; status?: UserStatus }`), plus one shared helper function that takes a TypeORM repository/query builder and the normalized query params and returns the exact `PaginatedResponse<T>` shape (`data`, `total`, `page`, `limit`, `totalPages`, `hasNextPage`, `hasPreviousPage`) already fixed by the frontend's real TypeScript type.

**Why this matters beyond "DRY":** the frontend's own `architecture.md` explicitly calls out that Users/Products/Orders "share identical table behavior" and built one shared `<DataTable>` for exactly that reason. The backend should mirror that decision — Products and Orders (later phases) need the *exact same* pagination math. If it were duplicated per-controller, a bug fix or a default-page-size change would need to happen three times instead of once, and the logic couldn't be unit-tested independently of spinning up an HTTP request.

---

## Q9 — Unit-testing `PermissionsGuard` in isolation

Two things need to be fake, matching the DI-for-testability lesson from Phase 1 Q2 and Phase 3 Q2:

- **`ExecutionContext`** — doesn't need a full mock, just a plain object shaped like what the guard actually calls: `{ switchToHttp: () => ({ getRequest: () => ({ user: { role: 'Manager' } }) }), getHandler: () => {}, getClass: () => {} }`.
- **`Reflector`** — since it's injected via the constructor, either instantiate the guard directly with a fake (`new PermissionsGuard(fakeRolesRepo, { getAllAndOverride: jest.fn().mockReturnValue(['users:delete']) })`) or use `Test.createTestingModule({...}).overrideProvider(Reflector).useValue(fakeReflector)`.

**Assertions worth writing:** required permission present in the resolved role → `canActivate()` resolves `true`; required permission absent → throws `ForbiddenException`; no metadata found at all → whatever Q11 decides (should be the fail-closed path, and that's exactly the branch worth a dedicated test — it's the one most likely to silently regress if someone "simplifies" the guard later).

---

## Q10 — Role-change staleness, concretely, in code terms

Two *different* kinds of staleness live in two different places, worth being precise about which is which:

1. **A user's role *assignment* changes** (Bob goes from Manager to Viewer) — this staleness lives in `TokenService.signAccessToken()`, specifically in the fact that `role` is baked into the JWT payload only at login/refresh time. Bob's already-issued access token keeps asserting `role: "Manager"` until it naturally expires (≤15 min) or he refreshes — nothing server-side can reach into a token already sitting in his browser and edit it.
2. **A role's *permission bundle* changes** (Admin revokes `products:delete` from Manager entirely) — under the Q3 design (resolving permissions fresh from the `roles` table on every request, not trusting a permissions list baked into the JWT), this takes effect **immediately**, on the very next request for *every* Manager — because `PermissionsGuard` never caches or trusts a permission list from the token; it re-reads `Role.permissions` fresh each time.

So: role *reassignment* still lags by up to one access-token lifetime (an accepted, deliberate tradeoff, same as Phase 0 Q9); role *definition* changes propagate instantly. Both are real, and they're different things — don't conflate "the JWT is stale" with "permissions are always stale," because with this design, only the first is actually true.

---

## Q11 — No `@RequirePermissions()` found at all: fail-open or fail-closed?

**Fail-closed — deny by default, always.** If a route has no explicit permission requirement declared, the safe assumption is "whoever wrote this route forgot to protect it," never "this route is intentionally public." Fail-open would turn every future undecorated route (a Products/Orders controller a later phase adds, if someone forgets one line) into a silent, invisible security hole — reachable by any authenticated user of any role, with no error, no warning, nothing indicating a problem exists until someone finds it the hard way.

Concretely: if `Reflector.getAllAndOverride('permissions', [...])` returns `undefined`, `PermissionsGuard.canActivate()` should **throw**, not return `true`. This is the same "deny by default, allow only what's explicitly stated" philosophy already behind the global `ValidationPipe`'s `forbidNonWhitelisted: true` from Phase 1.

**One nuance:** this is different from a genuinely-intended-to-be-public route (there are none in Users, but the general case matters) — that's what a `@Public()` decorator (an explicit *opt-out*, checked before the permission check even runs) is for, deferred until an actual public route exists. "Explicitly opted out" and "accidentally undecorated" must never be handled by the same code path, or the fail-closed guarantee is worthless.

---

## Open Decisions Before Implementation

| Decision ID | Area | Decision | Rationale | Status |
| :--- | :--- | :--- | :--- | :--- |
| `BE-DEC-010` | RBAC enforcement granularity | Resolve full permissions from `roles` table per-request (`@RequirePermissions`), not JWT-embedded role-name-only checks | Exercises the normalized schema actually built for this reason (`BE-DEC-001`); one cheap extra query per request | Proceeding unless you object |
| `BE-DEC-011` | `CreateUserDto` role field | `roleId: string` (UUID, validated against real `roles` rows), never a raw `role` name string | Prevents privilege-escalation via an untrusted client-supplied role label | Proceeding unless you object |
| `BE-DEC-012` | Delete response | `200 OK` + envelope body, not `204 No Content` | `204` can't carry the required envelope body; consistency for the frontend contract wins over REST purism here | Proceeding unless you object |

If any of these should go differently, say so before I start — otherwise I'll implement Phase 4 with these three decisions as given.
