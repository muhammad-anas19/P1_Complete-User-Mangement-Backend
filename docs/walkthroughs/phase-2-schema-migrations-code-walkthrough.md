# Phase 2 Code Walkthrough: Entities, Migration, Seed Script

> **Written retroactively.** Phase 2 originally only got its pre-implementation [qa/phase-2-schema-migrations-understanding-check.md](../qa/phase-2-schema-migrations-understanding-check.md) — the walkthrough-doc pattern (explaining the actual code, decorator by decorator) only started after Phase 3. This fills that gap, triggered directly by a real point of confusion: it's easy to look at `permissions: Permission[]` on the `Role` class and assume the database stores an array there. It doesn't. This doc exists to make that unambiguous, alongside everything else Phase 2 actually built.

---

# Part 1 — TypeORM Entity Building Blocks

These are used for the first time in Phase 2 — Part 1 of the Phase 3/4 docs assumed you already had these, since those were written after this code existed.

## `@Entity('table_name')`

Marks a class as mapping to a real database table. The string argument is the actual table name in Postgres (`@Entity('users')` → table `users`) — without it, TypeORM would derive a name from the class automatically, but being explicit avoids surprises if the class gets renamed later.

## `@PrimaryGeneratedColumn('uuid')`

The primary key column, auto-generated as a UUID rather than an auto-incrementing integer — the actual implementation of the `BE-DEC-003` decision (see `qa/phase-2-...md` Q3). Under the hood, this is what produces the `DEFAULT uuid_generate_v4()` you saw in the real migration SQL.

## `@Column({...})`

A regular table column. The options object is where you state things TypeScript's own type can't express to Postgres: `unique: true` (a real database constraint, not just an app-level check — Q5), `type: 'varchar'` (needed whenever the TS type is nullable/a union, since `reflect-metadata` can't infer a concrete SQL type from `string | null` on its own — this is exactly the bug hit and fixed during Phase 2's actual build, see the tracker's build notes), `nullable: true`, `default: ...`, or `type: 'enum', enum: SomeEnum` (generates a real native Postgres `ENUM` type, not just a `varchar` with app-side checking).

## `@CreateDateColumn()` / `@UpdateDateColumn()` / `@DeleteDateColumn()`

Three special, auto-managed timestamp columns. The first two are set automatically on insert/update — you never write to them yourself. `@DeleteDateColumn()` is different in kind: it's what turns `.remove()`/`.delete()` into no-ops for that entity and makes `.softDelete()`/`.softRemove()` the real deletion path — and critically, it also makes TypeORM's default `find()`/`findOne()` **automatically exclude** any row where this column is non-null, with zero extra filtering code required anywhere else in the app.

## `@ManyToOne()` + `@JoinColumn()` — the "many" side

Used on `User.role`. This is what a plain foreign key column looks like in TypeORM: many `User` rows can point at the same `Role` row. `@JoinColumn({ name: 'role_id' })` says *this side* owns the actual foreign key column in the database (the `Role` entity has no matching `@OneToMany` back-reference defined here — it isn't needed unless you want to conveniently fetch "all users with this role" starting from a `Role` instance, which this project doesn't need).

## `@ManyToMany()` + `@JoinTable()` — the relationship that isn't a column at all

Covered in detail just above in this conversation, formalized here: this pair of decorators tells TypeORM to manage the relationship through a **separate junction table**, not a column on either side. `@JoinTable()` (only declared on *one* side of the relationship — here, `Role`) specifies that table's exact name and column names. There is deliberately no `@Column()` anywhere near `permissions: Permission[]` — that's the tell that it isn't stored the way a plain field is.

## `eager: true`

An option on a relation decorator meaning "automatically fetch this related data on every query for this entity, without needing to ask for it explicitly." Used on both `Role.permissions` and `User.role` — RBAC checks (`PermissionsGuard`, Phase 4) almost always need a role's permissions loaded alongside it, so this avoids having to remember `relations: ['role', 'role.permissions']` at every single call site.

## `@Exclude()` (from `class-transformer`, not TypeORM)

Used on `User.passwordHash`. Not a database concern at all — it doesn't affect what's stored or queried. It only matters at the moment an entity instance gets serialized to JSON via `instanceToPlain()` (Phase 3's `ResponseEnvelopeInterceptor`), which is the one place this field actually gets stripped before reaching a client.

---

# Part 2 — File-by-File Walkthrough

## 1. `src/modules/roles/entities/permission.entity.ts`

```ts
@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```
The simplest entity in the project — deliberately so. Notice there is **no relation field on this class at all**, no `roles: Role[]` back-reference. That's a real choice, not an omission: this project never needs to start from a `Permission` and ask "which roles have this" in code (only the reverse — starting from a `Role`, per `PermissionsGuard`) — adding an unused back-reference would just be speculative complexity. `@Column({ unique: true })` on `name` is what makes `'users:read'`, `'products:update'`, etc. each exist as exactly one row, ever — the seed script (file 7) relies on this to be safely re-runnable.

---

## 2. `src/modules/roles/entities/role.entity.ts`

```ts
@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @ManyToMany(() => Permission, { eager: true })
  @JoinTable({
    name: 'role_permissions',
    joinColumn: { name: 'role_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  permissions: Permission[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```
- **`() => Permission`**: a *function* returning the related entity class, not the class directly — TypeORM requires this lazy form specifically to sidestep JavaScript module-loading order issues (if `Permission` and `Role` ever imported each other, a direct reference could be `undefined` at the moment this file first evaluates; wrapping it in an arrow function defers reading it until it's actually needed).
- **`@JoinTable({ name: 'role_permissions', joinColumn: {...}, inverseJoinColumn: {...} })`**: this exact configuration is what produced the real `role_permissions` table you saw queried above — `joinColumn` is the FK column pointing back at *this* entity (`Role` → `role_id`), `inverseJoinColumn` is the FK column pointing at the *other* entity (`Permission` → `permission_id`). Left to its defaults, TypeORM would pick column names on its own; naming them explicitly here means the actual Postgres schema reads clearly even to someone who never opens the entity file.
- **Confirmed fact, not assumption**: querying `psql`'s `\d roles` (done just above, live) shows zero `permissions` column. The property only exists as a TypeScript-side, in-memory result of a join — see the chat explanation immediately preceding this doc for the full mechanism.

---

## 3. `src/modules/users/entities/user.entity.ts`

```ts
export enum UserStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
  PENDING = 'Pending',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Exclude()
  @Column({ name: 'password_hash', type: 'varchar', nullable: true })
  passwordHash: string | null;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.PENDING })
  status: UserStatus;

  @Column({ name: 'avatar_url', type: 'varchar', nullable: true })
  avatarUrl: string | null;

  @Column({ name: 'last_active', type: 'timestamptz', nullable: true })
  lastActive: Date | null;

  @Column({ name: 'role_id' })
  roleId: string;

  @ManyToOne(() => Role, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
```
- **`{ name: 'password_hash', ... }` inside `@Column()`**: the *first* argument to the decorator options controls the actual Postgres column name (`snake_case`, matching SQL convention), independent of the TypeScript property name (`camelCase`, matching JS/TS convention) — this mapping happens on every column with an explicit `name`.
- **`passwordHash: string | null`, `nullable: true`, no default**: reflects the real business rule directly in the type system — an Admin-invited user genuinely has no password yet (`PRD.md` Workflow 6), and the type signature makes every place this field is read forced to handle the `null` case rather than assuming a value always exists.
- **`type: 'varchar'` explicitly stated on every nullable string column**: this is the fix for a real bug hit while building this file — TypeORM couldn't infer a SQL type from a `string | null` union via reflection alone (it saw `Object`, which Postgres has no equivalent for), so every nullable string column here states its type explicitly rather than relying on inference.
- **`roleId: string` *and* `role: Role` as two separate fields**: this looks redundant but each serves a different purpose — `roleId` is the plain scalar value (useful when you just need the ID, e.g. checking `if (dto.roleId)` in `UsersService`, Phase 4), while `role` is the full related object, populated automatically because of `eager: true`. TypeORM keeps both in sync from the single `role_id` database column.
- **`onDelete: 'RESTRICT'`**: a real Postgres foreign-key behavior, not application logic — attempting to delete a `Role` row that any `User` still references fails at the database level, full stop, regardless of what application code does or doesn't check first.

---

## 4. `src/modules/auth/entities/refresh-token.entity.ts`

```ts
@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'token_hash', unique: true })
  tokenHash: string;

  @Index()
  @Column({ name: 'family_id' })
  familyId: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'ip_address', type: 'varchar', nullable: true })
  ipAddress: string | null;

  @Column({ name: 'user_agent', type: 'varchar', nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```
- **`onDelete: 'CASCADE'` here, vs. `'RESTRICT'` on `User.role`**: a deliberate, different choice per relationship. If a user row were ever truly hard-deleted (not the normal path — soft delete is, per Q10 — but a defensive default for something like a future GDPR-erasure feature), it makes sense for their refresh token *history* to disappear with them; it would make no sense for a `Role` to vanish out from under users still actively assigned to it, hence `RESTRICT` there instead.
- **`@Index()` on `familyId`, but no `unique: true`**: many rows legitimately share the same `familyId` (every token in one rotation chain) — the index exists purely for the lookup speed of "revoke every row in this family," not to enforce uniqueness (that's what `tokenHash`'s own `unique: true` is for, on a *different* column).
- No `eager: true` anywhere on this entity — unlike `User`/`Role`, nothing routinely needs "the user, automatically, every time I look up a refresh token."

---

## 5. `src/modules/roles/roles.module.ts` and `src/modules/users/users.module.ts` (Phase 2 form)

```ts
@Module({
  imports: [TypeOrmModule.forFeature([Role, Permission])],
  exports: [TypeOrmModule],
})
export class RolesModule {}
```
`TypeOrmModule.forFeature([Role, Permission])` is what turns these entity *classes* into actually-injectable `Repository<Role>`/`Repository<Permission>` instances anywhere this module is imported. `exports: [TypeOrmModule]` re-exports that same registration outward — this is the exact mechanism `AuthModule` (Phase 3) and `UsersModule` (Phase 4) later rely on to get a `Role`/`User` repository just by importing `RolesModule`/`UsersModule`, without re-registering the entity themselves.

---

## 6. The migration — `src/database/migrations/1784878251210-InitSchema.ts`

Generated by `migration:generate`, diffing the four entities above against an empty database (`qa/phase-2-...md` Q7) — not hand-written. A few lines worth reading literally, now that you've seen the entities that produced them:

```sql
CREATE TABLE "role_permissions" (
  "role_id" uuid NOT NULL,
  "permission_id" uuid NOT NULL,
  CONSTRAINT "PK_..." PRIMARY KEY ("role_id", "permission_id")
)
```
This is the entire physical footprint of `Role.permissions: Permission[]` — two columns, a **composite primary key** across both of them (meaning the same `role_id`+`permission_id` pair can only ever exist once — you can't accidentally grant a role the same permission twice), and nothing else. No `permissions` array anywhere.

```sql
ALTER TABLE "users" ADD CONSTRAINT "..." FOREIGN KEY ("role_id") REFERENCES "roles"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION
```
The literal database-level enforcement of `onDelete: 'RESTRICT'` from `User.role`.

```ts
public async down(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`ALTER TABLE "role_permissions" DROP CONSTRAINT "..."`);
  // ...
  await queryRunner.query(`DROP TABLE "role_permissions"`);
  // ...
  await queryRunner.query(`DROP TABLE "users"`);
  await queryRunner.query(`DROP TYPE "public"."users_status_enum"`);
  await queryRunner.query(`DROP TABLE "roles"`);
  await queryRunner.query(`DROP TABLE "permissions"`);
}
```
The `down()` method is the *exact reverse order* of `up()` — foreign keys are dropped before the tables they reference are dropped, and the `users_status_enum` type is dropped only *after* the `users` table (the only table using that type) is already gone. This ordering isn't arbitrary; Postgres would reject dropping a table that something else still has a foreign key pointing at, or dropping an enum type still in use by an existing column — `down()` has to respect the same dependency order `up()` built up, just backwards.

---

## 7. `src/database/seeds/seed-roles-permissions.ts`

```ts
async function seed() {
  await AppDataSource.initialize();
  const permissionRepo = AppDataSource.getRepository(Permission);
  const roleRepo = AppDataSource.getRepository(Role);

  const permissionsByName = new Map<string, Permission>();
  for (const name of PERMISSIONS) {
    let permission = await permissionRepo.findOneBy({ name });
    if (!permission) {
      permission = await permissionRepo.save(permissionRepo.create({ name }));
    }
    permissionsByName.set(name, permission);
  }

  for (const [roleName, permissionNames] of Object.entries(ROLE_PERMISSIONS)) {
    const permissions = permissionNames.map((n) => permissionsByName.get(n)!);
    let role = await roleRepo.findOne({ where: { name: roleName } });
    if (!role) {
      role = roleRepo.create({ name: roleName, permissions });
    } else {
      role.permissions = permissions;
    }
    await roleRepo.save(role);
  }
}
```
- **`AppDataSource.initialize()` / `AppDataSource.getRepository(...)`, not Nest's `@InjectRepository()`**: this script runs standalone via `ts-node` (`npm run seed`), completely outside Nest's application context — there's no DI container here at all, so it uses TypeORM's `DataSource` API directly, the same `data-source.ts` file the migration CLI uses (Phase 1).
- **Find-or-create, not blind insert, for both permissions and roles**: this is what makes the whole script safe to run repeatedly — re-running it after editing `ROLE_PERMISSIONS` updates existing rows in place (`role.permissions = permissions; await roleRepo.save(role)`) rather than erroring on a duplicate `name` or creating a second copy.
- **`role.permissions = permissions` then `.save(role)`**: this is the *write* side of the many-to-many relationship — assigning a plain JS array of already-fetched `Permission` entities to the property, then saving, is what TypeORM translates into the actual `INSERT`/`DELETE` statements against `role_permissions` needed to make that role's rows match the array you assigned. You never write raw SQL against the join table yourself, here or anywhere else in this codebase.

---

## Recap: what actually happens when `PermissionsGuard` reads `role.permissions`

```
PermissionsGuard.canActivate()
  → this.rolesRepo.findOne({ where: { name: 'Manager' } })
      → TypeORM issues (roughly):
          SELECT r.* FROM roles r WHERE r.name = 'Manager'
          SELECT p.* FROM permissions p
            JOIN role_permissions rp ON rp.permission_id = p.id
            WHERE rp.role_id = <Manager's id>          -- because permissions is eager: true
      → assembles one Role object in memory:
          { id: '...', name: 'Manager', permissions: [ {name:'products:read'}, {name:'products:update'}, ... ] }
  → role.permissions.map(p => p.name) → Set { 'products:read', 'products:update', 'orders:read', 'orders:update', 'users:read' }
  → checked against whatever @RequirePermissions(...) declared
```
Two real SQL queries, a join, and an in-memory assembly — every time. Nothing about the `Permission[]` array is stored as an array anywhere in Postgres.
