import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

// Exempt from the global rate limit — orchestrator polling shouldn't be
// able to trip a limit meant for user/API traffic. See
// docs/qa/phase-5-hardening-understanding-check.md A5.
@ApiTags('health')
@SkipThrottle()
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
