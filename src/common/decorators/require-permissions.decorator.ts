import { SetMetadata } from '@nestjs/common';

// Attaches static metadata to a route (read back by PermissionsGuard via
// Reflector) — a different job from createParamDecorator (@CurrentUser()),
// which extracts data FROM the request. This attaches data TO the route
// itself. See docs/qa/phase-4-rbac-users-understanding-check.md Q1.
export const PERMISSIONS_KEY = 'permissions';

export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
