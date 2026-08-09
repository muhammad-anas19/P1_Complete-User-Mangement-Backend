# Phase 6–7 Code Walkthrough: Products & Orders Modules

> Companion to [qa/phase-6-7-products-orders-understanding-check.md](../qa/phase-6-7-products-orders-understanding-check.md). The controller/service/module structure here is **identical in shape** to `UsersController`/`UsersService`/`UsersModule` from Phase 4 — see [phase-4-rbac-users-code-walkthrough.md](phase-4-rbac-users-code-walkthrough.md) for that mechanics explanation, not repeated here. This doc covers only what's genuinely new.

---

## `Product.stockStatus` — a getter, not a column

```ts
@Expose()
get stockStatus(): StockStatus {
  if (this.stockQuantity <= 0) return 'out_of_stock';
  if (this.stockQuantity < 10) return 'low_stock';
  return 'in_stock';
}
```
No `@Column()` — this never touches the database at all, confirmed by the actual migration (`up()` created no `stock_status` column). `@Expose()` (from `class-transformer`, not TypeORM) is what makes `ResponseEnvelopeInterceptor`'s `instanceToPlain(data)` call (Phase 3) include it in the JSON response despite it not being a real stored field. **Verified live, not assumed:** creating a product with `stockQuantity: 5` returned `"stockStatus": "low_stock"` in the actual API response — confirming `instanceToPlain()` really does walk getters when `@Expose()` is present, which wasn't something to take for granted going in.

## `price`/`totalAmount` as `numeric` columns, typed `string` in TypeScript

```ts
@Column({ type: 'numeric', precision: 10, scale: 2 })
price: string;
```
`numeric(10,2)` in Postgres stores an exact decimal (up to 10 total digits, 2 after the decimal point) — not a binary float, which cannot represent most decimal fractions exactly. The `pg` driver returns `numeric` values as JavaScript **strings**, specifically to avoid quietly reintroducing float imprecision by auto-converting to `number`. The entity's `price: string` type reflects that reality rather than fighting it. **Verified live**: `POST /products` with `"price": "29.99"` round-tripped back as the string `"29.99"`, not a `number`.

The DTOs accept it as a string too — `@IsNumberString()` on `CreateProductDto.price`/`CreateOrderDto.totalAmount` — validating "this looks like a decimal number" without ever parsing it into a JS `number` at any layer.

## `OrderStatus` enum + the separate status-transition route

```ts
export enum OrderStatus {
  PENDING = 'Pending', PROCESSING = 'Processing', SHIPPED = 'Shipped',
  DELIVERED = 'Delivered', CANCELLED = 'Cancelled',
}
```
Same pattern as `UserStatus` (Phase 2) — a TypeScript enum mapped to a native Postgres `enum` type via `@Column({ type: 'enum', enum: OrderStatus })`, confirmed in the real migration SQL (`CREATE TYPE "public"."orders_status_enum" AS ENUM(...)`).

```ts
@RequirePermissions('orders:update')
@Patch(':id/status')
updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderStatusDto) {
  return this.ordersService.updateStatus(id, dto);
}
```
A dedicated route (`PATCH /orders/:id/status`) rather than folding status changes into the general `PATCH /orders/:id` — this matches the frontend's already-scaffolded `orderEndpoints.updateStatus(id)` exactly. Nest's router correctly distinguishes `/orders/:id` from `/orders/:id/status` by segment count, with no ambiguity between the two `@Patch()` handlers — confirmed live: `PATCH /orders/<id>/status` reached `updateStatus()`, not `update()`.

## Nothing new in the RBAC/guard wiring

`@Controller('products') @UseGuards(CsrfGuard, JwtAuthGuard, PermissionsGuard)` and the module's `providers: [ProductsService, PermissionsGuard, CsrfGuard]` + `imports: [TypeOrmModule.forFeature([Product]), RolesModule]` are byte-for-byte the same shape as `UsersModule`. **Verified live**, all three roles: Admin full CRUD; Manager blocked from `products:create` (`403`) but allowed `products:update` (`200`); Viewer allowed `orders:read` (`200`) but blocked from `orders:update`/status changes (`403`) — the exact same permission-resolution mechanism from Phase 4, now proven to generalize to a second and third entity without modification.
