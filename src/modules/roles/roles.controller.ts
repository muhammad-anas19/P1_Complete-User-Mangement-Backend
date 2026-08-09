import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RolesService } from './roles.service';

// Gated behind users:read (not a dedicated roles:read — there's no
// standalone "manage roles" feature yet, this endpoint exists solely to
// populate the role dropdown on the user create/edit forms) so every role
// that can see the Users page can also resolve role names to ids.
@ApiTags('roles')
@ApiCookieAuth('access_token')
@Controller('roles')
@UseGuards(CsrfGuard, JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @RequirePermissions('users:read')
  @Get()
  findAll() {
    return this.rolesService.findAll();
  }
}
