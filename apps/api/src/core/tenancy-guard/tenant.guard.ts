/**
 * TenantGuard (STANDARDS §9.4, §10.2 step 2; INV-TEN-2). If the request path
 * carries a tenant identifier (`:firmId`) that does NOT match the session's
 * tenant, respond 404 — NOT 403 — so cross-tenant existence does not leak.
 *
 * Reads the principal from `req.principalClaim` (set by AuthGuard). A route with
 * no `:firmId` param (e.g. /v1/auth/*, /v1/platform/*) is not tenant-scoped here
 * and passes through. Same-tenant authorization is RoleGuard's concern (403).
 */
import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";

import {
  ResourceNotFoundError,
  UnauthenticatedError,
} from "../auth/auth.errors";
import type { PrincipalClaim } from "../tenant-context/tenant-context.interceptor";

interface TenantScopedRequest {
  principalClaim?: PrincipalClaim;
  params?: Record<string, string | undefined>;
}

/** The path param name that carries the firm/tenant id (STANDARDS §5.3). */
export const FIRM_ID_PARAM = "firmId";

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<TenantScopedRequest>();
    const principal = request.principalClaim;
    if (principal === undefined) {
      throw new UnauthenticatedError();
    }

    const pathTenant = request.params?.[FIRM_ID_PARAM];
    // No tenant in the path → not tenant-scoped at this layer; pass through.
    if (pathTenant === undefined) {
      return true;
    }

    if (pathTenant !== principal.tenantId) {
      // §9.4: cross-tenant probe is 404, never 403 — do not leak existence.
      throw new ResourceNotFoundError();
    }
    return true;
  }
}
