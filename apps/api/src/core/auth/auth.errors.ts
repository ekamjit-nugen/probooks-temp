/**
 * Auth/RBAC/tenancy DomainErrors (STANDARDS §12.1, §7.2, §10, §9.4). All extend
 * DomainError so the DomainExceptionFilter maps them to the §7.1 envelope —
 * never `throw new Error(...)` (STANDARDS §29).
 *
 * Status mapping (STANDARDS §7.2):
 *   401 Unauthenticated  — no/invalid/expired token
 *   403 Forbidden        — authenticated but role/permission denied (same-tenant)
 *   404 NotFound         — cross-tenant probe (never 403; STANDARDS §9.4, INV-TEN-2)
 */
import { DomainError } from "../errors/domain-error";

/** 401 — the request carries no valid authenticated principal. */
export class UnauthenticatedError extends DomainError {
  readonly code = "UNAUTHENTICATED";
  readonly httpStatus = 401;

  constructor(reason?: string) {
    super(reason ?? "Authentication is required");
  }
}

/**
 * 401 — the presented token failed verification (bad signature, tampered
 * claims, expired, wrong type). Deliberately does NOT leak which check failed.
 */
export class InvalidTokenError extends DomainError {
  readonly code = "INVALID_TOKEN";
  readonly httpStatus = 401;

  constructor() {
    super("The authentication token is invalid or expired");
  }
}

/**
 * 401 — a refresh token was replayed (already rotated/revoked). Defense: the
 * caller revokes the whole lineage (INV-AUTH-4 spirit; STANDARDS §10.1).
 */
export class RefreshTokenReplayError extends DomainError {
  readonly code = "REFRESH_TOKEN_REPLAY";
  readonly httpStatus = 401;

  constructor() {
    super("The refresh token has already been used or revoked");
  }
}

/**
 * 403 — authenticated, same tenant, but the role/permission is not granted
 * (deny-by-default, INV-RBAC-1). Distinct from cross-tenant (which is 404).
 */
export class ForbiddenError extends DomainError {
  readonly code = "FORBIDDEN";
  readonly httpStatus = 403;

  constructor(reason?: string) {
    super(reason ?? "You do not have permission to perform this action");
  }
}

/**
 * 404 — the requested resource is not found OR is a cross-tenant probe. Cross-
 * tenant access returns 404, NOT 403, so existence does not leak across the
 * boundary (STANDARDS §9.4, INV-TEN-2).
 */
export class ResourceNotFoundError extends DomainError {
  readonly code = "NOT_FOUND";
  readonly httpStatus = 404;

  constructor(reason?: string) {
    super(reason ?? "The requested resource was not found");
  }
}
