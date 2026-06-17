/**
 * RoleGuard (STANDARDS §10.2 step 3, §10.4; INV-RBAC-1, INV-AUTH-4). Authorizes
 * the request against @RequireRole / @RequirePermission metadata, re-deriving
 * authority from the principal's CURRENT role each request (never prior session
 * state). DENY BY DEFAULT: a guarded route bearing none of @RequireRole /
 * @RequirePermission / @Public is denied (403) — the unannotated-route backstop.
 *
 * Reads the principal from `req.principalClaim`, which AuthGuard (running first)
 * built from the verified token. Same-tenant role denial is 403 (cross-tenant is
 * 404 — that is TenantGuard's job, §9.4).
 */
import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  hasPermission,
  type Permission,
  type UserRole,
} from "@probooks/shared";

import { ForbiddenError } from "../auth/auth.errors";
import type { PrincipalClaim } from "../tenant-context/tenant-context.interceptor";

import {
  PERMISSIONS_METADATA_KEY,
  PUBLIC_METADATA_KEY,
  ROLES_METADATA_KEY,
} from "./rbac.decorators";

interface RequestWithPrincipal {
  principalClaim?: PrincipalClaim;
}

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.isPublic(context)) {
      return true;
    }

    const targets = [context.getHandler(), context.getClass()];
    const roles =
      this.reflector.getAllAndOverride<UserRole[] | undefined>(
        ROLES_METADATA_KEY,
        targets,
      ) ?? [];
    const permissions =
      this.reflector.getAllAndOverride<Permission[] | undefined>(
        PERMISSIONS_METADATA_KEY,
        targets,
      ) ?? [];

    // Deny-by-default (§10.4): no role/permission annotation and not @Public.
    if (roles.length === 0 && permissions.length === 0) {
      throw new ForbiddenError(
        "Route is not authorized (no role/permission/@Public declared)",
      );
    }

    const role = this.principal(context).userRole;
    this.checkRoles(roles, role);
    this.checkPermissions(permissions, role);
    return true;
  }

  /** Reject if a role allow-list exists and the role is not on it. */
  private checkRoles(roles: UserRole[], role: UserRole): void {
    if (roles.length > 0 && !roles.includes(role)) {
      throw new ForbiddenError("Role is not permitted for this action");
    }
  }

  /** Reject if the role lacks ANY of the required permissions (§4.17). */
  private checkPermissions(permissions: Permission[], role: UserRole): void {
    for (const permission of permissions) {
      if (!hasPermission(role, permission)) {
        throw new ForbiddenError(
          "Role lacks a required permission for this action",
        );
      }
    }
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  private principal(context: ExecutionContext): PrincipalClaim {
    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const principal = request.principalClaim;
    if (principal === undefined) {
      // AuthGuard must have run first; absence here is a misconfiguration.
      throw new ForbiddenError("No authenticated principal");
    }
    return principal;
  }
}
