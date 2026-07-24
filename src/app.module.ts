import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      load: [configuration],
    }),
    DatabaseModule,
    HealthModule,
    UsersModule,
    RolesModule,
    // modules/auth (login/logout/refresh, RefreshToken entity wiring) is
    // added in Phase 3 — see docs/phases.md.
  ],
})
export class AppModule {}
