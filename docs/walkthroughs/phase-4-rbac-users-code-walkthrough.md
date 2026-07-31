# Phase 4 Code Walkthrough: RBAC Guards & User Management

> Companion to [qa/phase-4-rbac-users-understanding-check.md](../qa/phase-4-rbac-users-understanding-check.md) (concepts, before code) — this covers the actual code that resulted, file by file, same format as [phase-3-auth-code-walkthrough.md](phase-3-auth-code-walkthrough.md). Part 1 covers only mechanisms *new* this phase — Part 1 of the Phase 3 doc (Guards, DI, Interceptors, `@Injectable()`, etc.) still applies and isn't repeated.

---

# Part 1 — New Building Blocks This Phase

## `SetMetadata` — attaching data *to* a route, not extracting *from* a request

Phase 3's `@CurrentUser()` used `createParamDecorator` to *pull* data out of the current request for a parameter. `@RequirePermissions(...)` does the opposite job: it *attaches* static data onto the route itself, for something else (a Guard) to read back later, at a completely different point in time (request-handling time, not decorator-application time). `SetMetadata(key, value)` is the primitive both `@Roles()`-style decorators and Nest's own decorators (`@Controller()`, etc.) are built from under the hood.

## `Reflector` and `getAllAndOverride`

`Reflector` is a small, always-available injectable utility Nest provides for reading metadata back off a class or method. `getAllAndOverride<T>(key, [context.getHandler(), context.getClass()])` checks *both* the method and its containing class for that metadata key, and lets the **method-level** value win if both exist ("override," not "merge" — a method-level `@RequirePermissions()` fully replaces, not adds to, whatever the class-level one might say, though this project only ever sets it at the method level).

## `ExecutionContext.getHandler()` / `.getClass()`

These are the two methods `ExecutionContext` has beyond the plainer `ArgumentsHost` (used by `AllExceptionsFilter` in Phase 3) — `getHandler()` returns the actual method reference being invoked (e.g. the `remove` function), `getClass()` returns the containing controller class. This is exactly the reflection capability that makes `Reflector.getAllAndOverride()` possible at all — without access to *which* method/class is handling this request, there'd be nothing to read metadata off of.

## TypeORM `QueryBuilder`

Everywhere so far (`findOneBy`, `findOne({ where })`) used TypeORM's simpler repository methods, fine for exact-match lookups. `UsersService.findAll()` needs conditional `WHERE` clauses (only add a search filter if `search` was provided), a join (`role`), and dynamic sorting — this is what `createQueryBuilder()` is for: a fluent, chainable API (`.andWhere()`, `.leftJoinAndSelect()`, `.orderBy()`, `.skip()`, `.take()`) that builds up a real SQL query piece by piece, only adding each clause when it's actually needed.

## `ParseUUIDPipe`

A **built-in** Nest Pipe (not one we wrote) applied to a route *parameter* rather than a request body: `@Param('id', ParseUUIDPipe) id: string`. It validates that the `:id` segment of the URL is a syntactically valid UUID *before* the controller method body runs, throwing `400` automatically otherwise — the same "reject bad input before it reaches your logic" idea as the global `ValidationPipe`, just scoped to one parameter instead of a whole DTO.

## `PartialType`

From `@nestjs/mapped-types`. `UpdateUserDto extends PartialType(CreateUserDto)` generates a new class with every field from `CreateUserDto` present but marked optional — instead of hand-retyping `name?`, `email?`, `roleId?` a second time and risking the two DTOs drifting out of sync.

## Class-level `@UseGuards()`

Phase 3 only ever applied `@UseGuards()` per-method (`/auth/me`). `UsersController` applies it once, at the **class** level: `@Controller('users') @UseGuards(JwtAuthGuard, PermissionsGuard)`. This means *every* method in the controller runs through both guards — no method needs to repeat the wiring, only its own `@RequirePermissions(...)` requirement.

---

# Part 2 — File-by-File Walkthrough

## 1. `src/common/decorators/require-permissions.decorator.ts`

```ts
export const PERMISSIONS_KEY = 'permissions';

export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
```
`PERMISSIONS_KEY` is exported (not just used internally) specifically so `PermissionsGuard` can import the *same* string constant rather than each file hardcoding `'permissions'` independently — if this ever needed to change, there's exactly one place to change it, and a typo in one file couldn't silently desync from the other.

---

## 2. `src/common/guards/permissions.guard.ts`

```ts
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(Role) private readonly rolesRepo: Repository<Role>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      throw new ForbiddenException('This route has no declared permission requirement');
    }

    const request = context.switchToHttp().getRequest<{ user?: CurrentUserPayload }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('Not authenticated');
    }

    const role = await this.rolesRepo.findOne({ where: { name: user.role } });
    if (!role) {
      throw new ForbiddenException('Unknown role');
    }

    const granted = new Set(role.permissions.map((permission) => permission.name));
    const hasAll = required.every((permission) => granted.has(permission));

    if (!hasAll) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
```
- **`implements CanActivate`**: the interface every Guard implements — one method, `canActivate()`, returning (or resolving to, since it's `async` here) `true`/`false`, or throwing.
- **Constructor dependencies, both real DI this time**: unlike `JwtAuthGuard` (Phase 3, no constructor of its own), this guard genuinely needs `Reflector` (framework-provided, always injectable, no registration needed) and `@InjectRepository(Role)` (needs `RolesModule`'s exported `TypeOrmModule` to be reachable — see file 10). This is *why* `JwtAuthGuard` could be used with zero provider registration in Phase 3 but `PermissionsGuard` **must** be listed in a module's `providers` array (see `users.module.ts`) — Nest's DI container has to actually construct this instance with its real dependencies resolved; a bare `new PermissionsGuard()` wouldn't work (both constructor arguments would be `undefined`).
- **The fail-closed check runs first, before touching the database at all**: if `required` is empty/`undefined`, the guard throws immediately — it never even reaches the DB lookup. This is `BE-DEC-010`/Q11 made literal: an undecorated route can never accidentally fall through to "allow."
- **Resolving by role *name*, not role *id***: `request.user.role` is the string from the JWT payload (Phase 3's `signAccessToken()` embeds `role: user.role.name`) — so the lookup is `WHERE name = :role`, not by id. This is the concrete mechanism behind Q10's "role bundle changes propagate instantly, role assignment changes lag" distinction: this guard never trusts a permissions list from the token, it re-reads `Role.permissions` (already `eager: true` from Phase 2) fresh, every single request.
- **`.every()`, not `.some()`**: a route can require more than one permission (not exercised yet in this phase's routes, each needs exactly one, but the guard supports it) — `every` means *all* listed permissions must be present, not just one of them.

---

## 3–4. `src/common/dto/pagination-query.dto.ts` and `src/common/utils/pagination.util.ts`

```ts
export class PaginationQueryDto {
  @Type(() => Number)
  @IsInt() @Min(1) @IsOptional()
  page: number = 1;
  // ...
}
```
`@Type(() => Number)` is a `class-transformer` decorator — query string values arrive as raw strings (`?page=2` is literally the string `"2"`, not the number `2`); combined with the global `ValidationPipe`'s `transform: true` (Phase 1), this is what actually converts it to a real `number` before `@IsInt()` even checks it. Without `@Type()`, `@IsInt()` would fail every request, since `"2"` is a string, not an int.

```ts
export function buildPaginatedResult<T>(data, total, page, limit): PaginatedResult<T> {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { data, total, page, limit, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
}
```
A plain function, not a class, not injectable — it has no dependencies and no state, so there's no reason to route it through Nest's DI at all. This is the shared piece `UsersService` (and, later, Products/Orders services) calls once they already have `data`/`total` from their own entity-specific query.

---

## 5–7. Users DTOs

```ts
export class CreateUserDto {
  @IsString() @MinLength(1) name: string;
  @IsEmail() email: string;
  @IsUUID() roleId: string;
}
```
No `password` field at all — reflecting the actual business rule (`PRD.md` Workflow 6: an Admin-created user starts with `passwordHash: null`, `status: Pending`, until a future invite-acceptance flow sets one). `@IsUUID()` on `roleId` is a first, cheap validation layer — it doesn't confirm the role *exists*, only that the string is *shaped like* a UUID; `UsersService.create()` (file 8) does the real existence check.

```ts
export class UpdateUserDto extends PartialType(CreateUserDto) {
  @IsEnum(UserStatus) @IsOptional() status?: UserStatus;
}
```
Adds `status` (not settable at creation — every new user starts `Pending` regardless) on top of everything `CreateUserDto` already validates, now all optional.

```ts
export class ListUsersQueryDto extends PaginationQueryDto {
  @IsIn(['Admin', 'Manager', 'Viewer', 'All']) @IsOptional() role?: string;
  @IsIn(['Active', 'Inactive', 'Pending', 'All']) @IsOptional() status?: string;
}
```
`@IsIn([...])` — a whitelist validator; anything outside that exact list of strings is rejected with `400` before it ever reaches `UsersService`. `'All'` is included as a valid value (not just "omit the field") because that's literally what the already-built frontend sends for "no filter selected" (`frontend/src/entities/user/model/user.types.ts`'s `UserFilterParams`) — the DTO layer accepts it, and the service layer (file 8) is what actually treats `'All'` as "don't filter."

---

## 8. `src/modules/users/users.service.ts`

```ts
async findAll(query: ListUsersQueryDto): Promise<PaginatedResult<User>> {
  const qb = this.usersRepo.createQueryBuilder('user').leftJoinAndSelect('user.role', 'role');

  if (search) {
    qb.andWhere('(user.name ILIKE :search OR user.email ILIKE :search)', { search: `%${search}%` });
  }
  if (role && role !== 'All') {
    qb.andWhere('role.name = :role', { role });
  }
  // ... status filter, sort, skip/take ...

  const [data, total] = await qb.getManyAndCount();
  return buildPaginatedResult(data, total, page, limit);
}
```
- **`createQueryBuilder('user')`**: `'user'` is an *alias* — every column reference after this (`user.name`, `role.name`) uses it, which is what makes the join (`role`) unambiguous.
- **Parameterized values (`:search`, `:role`)**: the actual value is passed as the *second argument object* (`{ search: ... }`), never string-concatenated into the query text — this is what makes it immune to SQL injection; TypeORM sends the query and its parameters to Postgres separately, the same way a prepared statement works.
- **`ILIKE`**: Postgres's case-insensitive `LIKE` — so searching `"anas"` matches a user named `"Anas"`.
- **The sort field allow-list** (not shown above, see the real file) is checked with `SORTABLE_FIELDS.includes(field)` *before* the field name is interpolated into `.orderBy(`user.${field}`, ...)`` — this interpolation would otherwise be a real injection risk if `field` came straight from client input unchecked; the allow-list check is what makes it safe (`design.md` Section 4).
- **`getManyAndCount()`**: runs the query twice under the hood — once for the actual `LIMIT`/`OFFSET`-ed page of rows, once as a `COUNT(*)` with the same `WHERE` clauses but no `LIMIT` — this is what gives you `total` (needed for `totalPages`) without fetching every row.

```ts
async create(dto: CreateUserDto): Promise<User> {
  const role = await this.rolesRepo.findOneBy({ id: dto.roleId });
  if (!role) throw new BadRequestException('Invalid roleId');

  const user = this.usersRepo.create({ name: dto.name, email: dto.email, roleId: dto.roleId, passwordHash: null });

  try {
    return await this.usersRepo.save(user);
  } catch (error) {
    if (error instanceof QueryFailedError && (error as any).code === '23505') {
      throw new ConflictException('A user with this email already exists');
    }
    throw error;
  }
}
```
This is `qa/phase-2-...md` Q5's TOCTOU lesson, applied concretely: the *real* enforcement of "no duplicate emails" is the database's `UNIQUE` constraint (Phase 2's migration) — this code doesn't try to prevent the race with a pre-check; it lets Postgres reject the duplicate insert (error code `23505` is Postgres's own code for a unique-violation) and translates that specific failure into a clean `409 Conflict` instead of letting it fall through to `AllExceptionsFilter`'s generic 500 path. Verified directly: `POST /users` with an already-used email really does return `409` with a readable message, not a raw driver error.

```ts
async remove(id: string): Promise<{ deleted: true }> {
  await this.findOne(id); // 404s if missing/already soft-deleted
  await this.usersRepo.softDelete(id);
  await this.refreshTokenRepo.update(
    { userId: id, revokedAt: IsNull() },
    { revokedAt: new Date() },
  );
  return { deleted: true };
}
```
`softDelete(id)` is TypeORM's purpose-built method for entities with a `@DeleteDateColumn()` (`User.deletedAt`, from Phase 2) — it runs `UPDATE users SET deleted_at = NOW() WHERE id = ?`, never `DELETE FROM users`. The `refreshTokenRepo.update(...)` line is the piece flagged-but-not-yet-built back in Phase 2 Q10 and finally implemented here: soft-deleting the user and revoking their live sessions are two separate statements because they're two separate concerns ("this account is deactivated" vs. "any of their existing valid cookies stop working") — `IsNull()` here is the exact same TypeORM operator used in Phase 3's `TokenService.rotate()` for "only rows not already revoked."

---

## 9. `src/modules/users/users.controller.ts`

```ts
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  @RequirePermissions('users:read')
  @Get()
  findAll(@Query() query: ListUsersQueryDto) { return this.usersService.findAll(query); }

  @RequirePermissions('users:delete')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUUIDPipe) id: string) { return this.usersService.remove(id); }
}
```
Every method here is one line delegating straight to `UsersService` — no business logic, no direct repository access, matching `rules.md`'s "controllers stay thin." `@HttpCode(HttpStatus.OK)` on `remove()` is technically redundant (Nest already defaults non-POST routes to `200`) but kept explicit on purpose — it documents that returning `200` instead of the more RESTfully-conventional `204` was a deliberate choice (`BE-DEC-012`), not an accident of Nest's defaults.

---

## 10. `src/modules/users/users.module.ts`

```ts
@Module({
  imports: [TypeOrmModule.forFeature([User, RefreshToken]), RolesModule],
  controllers: [UsersController],
  providers: [UsersService, PermissionsGuard],
  exports: [TypeOrmModule],
})
export class UsersModule {}
```
Two things worth being precise about:

- **`RefreshToken` is registered here too, not only in `AuthModule`.** `RefreshToken` the *entity* isn't owned exclusively by one module the way you might expect — `forFeature([RefreshToken])` just requests "give me an injectable `Repository<RefreshToken>` in *this* module's DI scope," and that's completely legal to do in more than one module simultaneously; both get their own repository instance, both talk to the exact same underlying Postgres table. This is *why* it was chosen over the alternative: `AuthModule` already imports `UsersModule` (to get the `User` repository, since Phase 3). If `UsersModule` needed `TokenService` from `AuthModule` instead of its own direct `RefreshToken` repository, that would be `UsersModule → AuthModule → UsersModule` — a genuine circular import. Registering the same entity a second time here sidesteps that entirely, at the cost of one tiny duplicated query (a bulk `UPDATE ... WHERE userId = ?`) instead of reusing `TokenService`'s more specific per-token logic — a deliberate, worthwhile tradeoff to avoid `forwardRef()` complexity for something this simple.
- **`PermissionsGuard` is listed in `providers`, not just imported from `common/`.** As covered in file 2: because this guard has real constructor dependencies, Nest's DI container needs it registered as a provider *somewhere* it can resolve those dependencies — here, specifically, because `RolesModule` (providing the `Role` repository `PermissionsGuard` needs) is also imported into this same module.

---

## Recap: two full requests, traced end-to-end

```
Manager tries PATCH /users/:id  (Manager has users:read but NOT users:update)
  → JwtAuthGuard: verifies access_token cookie, populates request.user = { role: 'Manager', ... }
  → PermissionsGuard: reads @RequirePermissions('users:update') off this route via Reflector
      → looks up Role where name = 'Manager' → resolves its current permissions (products:*, orders:read/update, users:read)
      → 'users:update' not in that set → throws ForbiddenException
  → AllExceptionsFilter catches it → { success: false, message: "Insufficient permissions", timestamp }, HTTP 403
  → UsersController.update() never runs at all

Admin creates a user with an already-used email
  → JwtAuthGuard passes, PermissionsGuard passes (Admin has users:create)
  → ValidationPipe checks CreateUserDto (name/email/roleId shape) — passes
  → UsersController.create() → UsersService.create()
      → roleId exists → proceeds to save()
      → Postgres rejects the INSERT (unique constraint on email) → QueryFailedError, code '23505'
      → caught, rethrown as ConflictException('A user with this email already exists')
  → AllExceptionsFilter catches it → { success: false, message: "...", timestamp }, HTTP 409
```

Both verified for real against the running app and the actual Postgres database — not just reasoned through. See `qa/learning-topics-tracker.md` for the full list of what was tested.
