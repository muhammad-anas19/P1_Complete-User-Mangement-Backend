import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { RolesModule } from '../roles/roles.module';
import { AuditModule } from '../audit/audit.module';
import { UserTokensModule } from '../user-tokens/user-tokens.module';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// RefreshToken is registered here too (not just in AuthModule) so
// UsersService can revoke a deleted user's sessions directly — this
// deliberately avoids UsersModule <-> AuthModule importing each other
// (AuthModule already imports UsersModule for the User repository; the
// reverse would be a circular dependency). The same entity can be
// registered via forFeature() in more than one module — each gets its own
// injectable Repository bound to the same underlying table, no conflict.
//
// RolesModule is imported for the Role repository, needed by both
// UsersService (validating roleId) and PermissionsGuard (resolving
// permissions by role name).
@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken]),
    RolesModule,
    AuditModule,
    UserTokensModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, PermissionsGuard, CsrfGuard],
  exports: [TypeOrmModule],
})
export class UsersModule {}
