/**
 * The canonical guard stack, in the STANDARDS §10.2 order:
 *   AuthGuard → TenantGuard → RoleGuard → ResourceGuard
 *
 * Nest runs guards left-to-right, so spreading GUARD_STACK into @UseGuards
 * applies them in the required order. AuthGuard sets req.principalClaim first;
 * the rest read it. Usage:
 *
 *   @UseGuards(...GUARD_STACK)
 *   @RequireRole('accountant')
 *   @RequireResource({ kind: 'client', scope: 'own-client' })
 *   class FooController {}
 */
import { AuthGuard } from "../auth/auth.guard";
import { RoleGuard } from "../rbac/role.guard";

import { ResourceGuard } from "./resource.guard";
import { TenantGuard } from "./tenant.guard";

/** Apply with `@UseGuards(...GUARD_STACK)`. Order is load-bearing (§10.2). */
export const GUARD_STACK = [
  AuthGuard,
  TenantGuard,
  RoleGuard,
  ResourceGuard,
] as const;
