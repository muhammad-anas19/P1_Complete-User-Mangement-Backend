import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { ProductsModule } from './modules/products/products.module';
import { OrdersModule } from './modules/orders/orders.module';
import { HttpLoggerMiddleware } from './common/middleware/http-logger.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      load: [configuration],
    }),
    // Global default: 100 requests / 60s per IP. Stricter per-route limits
    // (login/refresh) are set via @Throttle() overrides on those specific
    // handlers. /health/* opts out via @SkipThrottle() — see
    // docs/qa/phase-5-hardening-understanding-check.md A5.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 100 }]),
    DatabaseModule,
    HealthModule,
    UsersModule,
    RolesModule,
    AuthModule,
    AuditModule,
    ProductsModule,
    OrdersModule,
  ],
  providers: [
    // Applied globally so every future controller is rate-limited by
    // default without needing to remember to add it — same "by
    // construction" reasoning as the global interceptor/filter in main.ts.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  // Middleware (not a global interceptor) specifically so it wraps every
  // request/response cycle including ones that never reach a controller
  // (e.g. a 404 on an unmapped route) — see
  // docs/qa/phase-13-logging-understanding-check.md Q5.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpLoggerMiddleware).forRoutes('*');
  }
}
