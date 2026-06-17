/**
 * Errors for the tenant-context module (STANDARDS §12.1). All business errors
 * extend DomainError so the DomainExceptionFilter maps them to the §7.1
 * envelope — never `throw new Error(...)` (STANDARDS §29).
 */
import { DomainError } from "../errors/domain-error";

/**
 * Thrown when code requires a tenant context but none is in scope (the request
 * was not run through the seeding interceptor, or a job forgot to seed it).
 * 401: there is no authenticated principal to scope the work to. Fails closed —
 * we never fall back to a missing/empty tenant (INV-TEN-1).
 */
export class NoTenantContextError extends DomainError {
  readonly code = "NO_TENANT_CONTEXT";
  readonly httpStatus = 401;

  constructor() {
    super("No tenant context is in scope for this operation");
  }
}
