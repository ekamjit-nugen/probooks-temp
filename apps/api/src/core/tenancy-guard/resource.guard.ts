/**
 * ResourceGuard (STANDARDS §10.2 step 4; INV-TEN-2). The final guard: checks the
 * specific resource is in the actor's scope (e.g. a client_owner may act only on
 * their OWN client). Phase-0 ships the wiring + one working example check
 * ("own-client"); full per-domain resource checks land with their domains.
 *
 * Reads @RequireResource metadata + the principal from `req.principalClaim`. A
 * route with no @RequireResource is not resource-scoped and passes through. A
 * scope miss is a cross-scope probe → 404 (consistent with §9.4, INV-TEN-2 —
 * never leak that someone else's resource exists).
 */
import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import {
  ResourceNotFoundError,
  UnauthenticatedError,
} from "../auth/auth.errors";
import {
  RESOURCE_METADATA_KEY,
  type ResourceRule,
} from "../rbac/rbac.decorators";
import type { PrincipalClaim } from "../tenant-context/tenant-context.interceptor";

interface ResourceScopedRequest {
  principalClaim?: PrincipalClaim;
  params?: Record<string, string | undefined>;
}

/** The path param carrying the client id (STANDARDS §5.3). */
export const CLIENT_ID_PARAM = "clientId";

@Injectable()
export class ResourceGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const rule = this.reflector.getAllAndOverride<ResourceRule | undefined>(
      RESOURCE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (rule === undefined) {
      return true; // not resource-scoped
    }

    const request = context.switchToHttp().getRequest<ResourceScopedRequest>();
    const principal = request.principalClaim;
    if (principal === undefined) {
      throw new UnauthenticatedError();
    }

    if (rule.scope === "own-client") {
      return this.checkOwnClient(principal, request.params?.[CLIENT_ID_PARAM]);
    }
    // Unknown scope = fail closed.
    throw new ResourceNotFoundError();
  }

  /**
   * A client-scoped principal may act only on its OWN client. Firm/operator
   * roles (no clientId binding) are not constrained by this particular rule —
   * their access is governed by Role/Tenant guards.
   */
  private checkOwnClient(
    principal: PrincipalClaim,
    pathClientId: string | undefined,
  ): boolean {
    // A client principal: its clientId must match the path's clientId.
    if (principal.clientId !== undefined) {
      if (pathClientId === undefined || pathClientId !== principal.clientId) {
        throw new ResourceNotFoundError();
      }
    }
    return true;
  }
}
