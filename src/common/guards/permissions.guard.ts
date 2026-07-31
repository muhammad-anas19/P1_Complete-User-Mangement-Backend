import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../../modules/roles/entities/role.entity';
import { CurrentUserPayload } from '../decorators/current-user.decorator';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

// Must run AFTER JwtAuthGuard (request.user has to already exist) — see
// docs/qa/phase-4-rbac-users-understanding-check.md Q2.
//
// Resolves the CURRENT permission set for request.user's role fresh from
// the roles table on every request, rather than trusting a permissions list
// embedded in the JWT — see Q3/BE-DEC-010 for why, and Q10 for exactly what
// staleness this design does (and doesn't) eliminate.
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

    // Fail-closed: an undecorated route is treated as a mistake, never as
    // an intentionally public one. See Q11.
    if (!required || required.length === 0) {
      throw new ForbiddenException('This route has no declared permission requirement');
    }

    const request = context.switchToHttp().getRequest<{ user?: CurrentUserPayload }>();
    const user = request.user;
    if (!user) {
      // Should be unreachable if JwtAuthGuard ran first — don't trust that blindly.
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
