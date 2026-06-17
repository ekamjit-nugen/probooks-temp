/**
 * HealthController (STANDARDS §14). Unauthenticated infrastructure endpoints —
 * deliberately NOT decorated with the guard stack (GUARD_STACK), so they need no
 * token (load balancers / ECS probes call them). Because they carry no guards,
 * the deny-by-default rule (§10.4) does not apply — there is nothing tenant- or
 * role-scoped here; the routes touch no tenant data.
 *
 *   GET /health/live  — liveness  (process up; never touches the DB)
 *   GET /health/ready — readiness (Postgres reachable on both connections)
 */
import { Controller, Get } from "@nestjs/common";

import { ServiceNotReadyError } from "./health.errors";
import {
  HealthService,
  type LivenessResult,
  type ReadinessResult,
} from "./health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("live")
  live(): LivenessResult {
    return this.health.liveness();
  }

  @Get("ready")
  async ready(): Promise<ReadinessResult> {
    const { ready, checks } = await this.health.readiness();
    if (!ready) {
      // 503 with the failing checks in the envelope details (§7.2).
      throw new ServiceNotReadyError(checks);
    }
    return { status: "ok", checks };
  }
}
