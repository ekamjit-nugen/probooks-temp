/**
 * Health DomainErrors (STANDARDS §12.1). Extend DomainError so the
 * DomainExceptionFilter maps them to the §7.1 envelope.
 */
import { DomainError } from "../../core/errors/domain-error";

import type { HealthCheck } from "./database.health-indicator";

/**
 * 503 — a readiness probe found a critical dependency down (STANDARDS §7.2:
 * "503 dependency down"). Carries the per-dependency checks so an operator can
 * see WHICH dependency failed without reading logs.
 */
export class ServiceNotReadyError extends DomainError {
  readonly code = "SERVICE_NOT_READY";
  readonly httpStatus = 503;

  constructor(checks: readonly HealthCheck[]) {
    super("One or more critical dependencies are unavailable.", {
      checks: checks.map((c) => ({ name: c.name, status: c.status })),
    });
  }
}
