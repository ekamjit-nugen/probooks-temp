/**
 * HealthService (STANDARDS §14). Composes the liveness + readiness answers.
 *
 * - Liveness: the process can answer — no dependencies touched (a failing DB
 *   must NOT cause a liveness failure, or the orchestrator would kill a pod that
 *   is merely waiting on Postgres).
 * - Readiness: every critical dependency (Postgres on both the app_user and
 *   service_role connections) is reachable. Aggregated to ok / not-ready.
 *
 * The two Prisma clients are injected as Pingable seams; the service never binds
 * a tenant (health is not tenant-scoped) — it runs a dependency-free SELECT 1.
 */
import { Injectable } from "@nestjs/common";

import { PlatformPrismaService } from "../../core/prisma/platform-prisma.service";
import { PrismaService } from "../../core/prisma/prisma.service";

import { checkDatabase, type HealthCheck } from "./database.health-indicator";

export interface LivenessResult {
  readonly status: "ok";
}

export interface ReadinessResult {
  readonly status: "ok";
  readonly checks: readonly HealthCheck[];
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformPrisma: PlatformPrismaService,
  ) {}

  /** Process is up. Cheap and dependency-free. */
  liveness(): LivenessResult {
    return { status: "ok" };
  }

  /**
   * Run every dependency check and return the aggregate. Returns the checks so
   * the caller (controller) can 200 when all up, or surface a 503 with the
   * failing checks. Checks never throw individually.
   */
  async readiness(): Promise<{
    ready: boolean;
    checks: readonly HealthCheck[];
  }> {
    const checks = await Promise.all([
      checkDatabase("database", this.prisma),
      checkDatabase("platformDatabase", this.platformPrisma),
    ]);
    const ready = checks.every((c) => c.status === "up");
    return { ready, checks };
  }
}
