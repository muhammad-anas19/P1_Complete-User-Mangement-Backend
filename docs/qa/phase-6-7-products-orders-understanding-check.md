# Phase 6–7 — Understanding Check: Products & Orders Modules

> Combined doc for both phases — they're a deliberate repetition of Phase 4's established pattern (entity → migration → DTOs → service → controller → `PermissionsGuard`), not new architecture. This covers only what's genuinely different: money/decimal storage, derived-vs-stored state, and the order status transition. RBAC, pagination, DI, and CRUD mechanics are unchanged from Phase 4 — see that doc if any of those feel unfamiliar.

---

## Q1 — Why `price`/`totalAmount` are typed `string`, not `number`

Both columns are Postgres `numeric(10,2)`, not `float`/`double`. Floating-point binary representation cannot exactly represent most decimal fractions (`0.1 + 0.2 !== 0.3` in every mainstream language) — for money, that's not a rounding curiosity, it's a real correctness bug that compounds across many transactions. Postgres's `numeric` type stores exact decimal values, but `pg` (the driver underneath TypeORM) returns `numeric` columns as **JavaScript strings**, not numbers, specifically *because* converting to a JS `number` would reintroduce the exact precision loss the column type exists to avoid. The entity types these fields as `string` to match that reality honestly, rather than silently casting to `number` and reintroducing the bug the database column was chosen to prevent. Arithmetic on these values (if ever needed) should go through a decimal-safe approach, not native `+`/`-` on the string.

## Q2 — Why stock "status" isn't a stored column

The frontend wants a stock-status indicator (in-stock / low-stock / out-of-stock), but `Product` only stores `stockQuantity: number` — there's no `stockStatus` column. Status is **derived**, not stored: it's a pure function of quantity (e.g. `0` → out of stock, `< 10` → low stock, else in stock). Storing it as a separate column would create two sources of truth that could drift out of sync — every place that updates `stockQuantity` would also have to remember to recompute and update `stockStatus`, and any place that forgets produces a silently wrong indicator. Computing it on read (service layer or even frontend) means it's structurally impossible for it to be stale.

## Q3 — Why `category` is a plain string, not its own entity

Unlike `roles`/`permissions` (deliberately over-built relative to the PRD for RBAC learning depth — `BE-DEC-001`), `category` here is a plain, indexed string column, not a full `Category` entity with its own table. Disclosed scope decision, not an oversight: categories here have no independent lifecycle worth managing (no icons, ordering, descriptions, nested hierarchy) — normalizing them would add a join and a management UI for no real behavior this project needs. If categories ever needed their own attributes, extracting them into a real entity later would be the natural evolution — same reasoning shape as Q1/Q2's "don't build structure the requirements don't need," applied in the opposite direction from the RBAC decision.

## Q4 — Orders: why no line-item relation

`Order` stores a flat `totalAmount`, not a relation to individual `Product` rows with quantities. A real e-commerce order system would model line items (an `OrderItem` join-like entity capturing product, quantity, and price-*at-the-time-of-order*, since a product's price can change after an order is placed). That's a legitimate, larger modeling exercise explicitly out of scope here — the frontend's own description of the Orders page (`Order ID, customer info, status badge, total amount, date filter`) doesn't need line-item breakdown, and this phase's actual learning focus (repeating the RBAC/CRUD/pagination pattern on a second and third entity) doesn't benefit from the added relational complexity.

## Q5 — The order status transition endpoint

`PATCH /orders/:id/status` is a separate route from the general `PATCH /orders/:id`, gated behind the *same* `orders:update` permission (not a new, separate permission) — a status change is conceptually just an update, and the existing role matrix already says who can update orders (Admin, Manager). A real system with a stricter state machine (e.g. "only Admin can force-cancel a shipped order") could split this into its own permission later; not needed here since the PRD doesn't specify any such distinction.

## Q6 — Permissions: nothing new to seed

`products:read/create/update/delete` and `orders:read/create/update/delete` were already seeded in Phase 2's `seed-roles-permissions.ts`, assigned to roles per the exact same matrix Users already uses. No new permission names, no reseed needed — the schema was deliberately built ahead of these modules existing, which is now paying off.

---

## What Gets Built

**Products**: `Product` entity (sku, name, category, price, stockQuantity, imageUrl, soft delete), migration, `ProductsService`/`ProductsController` reusing `PaginationQueryDto`/`buildPaginatedResult` exactly as `UsersService` does.

**Orders**: `Order` entity (customerName, customerEmail, status enum, totalAmount, soft delete), migration, `OrdersService`/`OrdersController` + `PATCH /orders/:id/status`.

Both wired with `@UseGuards(CsrfGuard, JwtAuthGuard, PermissionsGuard)` at the controller level, identical to `UsersController`.
