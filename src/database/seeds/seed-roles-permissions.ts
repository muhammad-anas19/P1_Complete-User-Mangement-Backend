import { AppDataSource } from '../data-source';
import { Permission } from '../../modules/roles/entities/permission.entity';
import { Role } from '../../modules/roles/entities/role.entity';

// Fixed reference data, not user content — a deliberate seed script rather
// than a migration, per docs/qa/phase-0-auth-rbac-understanding-check.md
// Q12 and docs/qa/phase-2-schema-migrations-understanding-check.md Q9.
// Idempotent: safe to re-run any time (e.g. after editing ROLE_PERMISSIONS).

const PERMISSIONS = [
  'users:read',
  'users:create',
  'users:update',
  'users:delete',
  'products:read',
  'products:create',
  'products:update',
  'products:delete',
  'orders:read',
  'orders:create',
  'orders:update',
  'orders:delete',
] as const;

// Mirrors the role matrix in docs/PRD.md Section 2 — the access policy
// lives here as data, not as scattered `if (role === 'Admin')` checks
// throughout the application code.
const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  Admin: PERMISSIONS,
  Manager: [
    'products:read',
    'products:update',
    'orders:read',
    'orders:update',
    'users:read',
  ],
  Viewer: ['users:read', 'products:read', 'orders:read'],
};

async function seed() {
  await AppDataSource.initialize();
  const permissionRepo = AppDataSource.getRepository(Permission);
  const roleRepo = AppDataSource.getRepository(Role);

  const permissionsByName = new Map<string, Permission>();
  for (const name of PERMISSIONS) {
    let permission = await permissionRepo.findOneBy({ name });
    if (!permission) {
      permission = await permissionRepo.save(permissionRepo.create({ name }));
      console.log(`created permission: ${name}`);
    }
    permissionsByName.set(name, permission);
  }

  for (const [roleName, permissionNames] of Object.entries(ROLE_PERMISSIONS)) {
    const permissions = permissionNames.map((n) => permissionsByName.get(n)!);
    let role = await roleRepo.findOne({ where: { name: roleName } });

    if (!role) {
      role = roleRepo.create({ name: roleName, permissions });
      console.log(`created role: ${roleName}`);
    } else {
      role.permissions = permissions;
      console.log(`updated role: ${roleName}`);
    }
    await roleRepo.save(role);
  }

  await AppDataSource.destroy();
  console.log('Seed complete.');
}

seed().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
