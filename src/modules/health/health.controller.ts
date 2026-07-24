import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  /**
   * Liveness: "is this process alive and not deadlocked?" Deliberately checks
   * nothing external — if the orchestrator gets a response at all, the
   * process is alive. A failing liveness check means: kill and restart.
   */
  @Get('live')
  @HealthCheck()
  checkLiveness() {
    return this.health.check([]);
  }

  /**
   * Readiness: "can this instance serve real traffic right now?" Pings the
   * DB — a failing readiness check means: stop routing traffic here, but
   * don't necessarily restart (e.g. a temporary DB failover).
   */
  @Get('ready')
  @HealthCheck()
  checkReadiness() {
    return this.health.check([() => this.db.pingCheck('database')]);
  }
}
