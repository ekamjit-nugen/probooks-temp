/**
 * RBAC decorators (STANDARDS §10.2, §10.4). Attach authorization metadata that
 * the guards read. Deny-by-default (§10.4): a guarded controller method with
 * none of @RequireRole / @RequirePermission / @Public is DENIED, and the
 * RoleGuard flags such an unannotated route.
 *
 * @Public is the rare exception (requires an ADR per §10.4) — it marks a route
 * that legitimately needs no authenticated principal.
 */
import { SetMetadata, type CustomDecorator } from "@nestjs/common";
import type { Permission, UserRole } from "@probooks/shared";

export const ROLES_METADATA_KEY = "probooks:require-roles";
export const PERMISSIONS_METADATA_KEY = "probooks:require-permissions";
export const PUBLIC_METADATA_KEY = "probooks:public";
export const RESOURCE_METADATA_KEY = "probooks:require-resource";

/** Allow only these roles (INV-RBAC-1). At least one role must be listed. */
export function RequireRole(
  ...roles: [UserRole, ...UserRole[]]
): CustomDecorator {
  return SetMetadata(ROLES_METADATA_KEY, roles);
}

/** Require ALL of these permissions (deny-by-default; SPEC §4.17). */
export function RequirePermission(
  ...permissions: [Permission, ...Permission[]]
): CustomDecorator {
  return SetMetadata(PERMISSIONS_METADATA_KEY, permissions);
}

/** Mark a route as needing NO authenticated principal (rare; §10.4 — ADR). */
export function Public(): CustomDecorator {
  return SetMetadata(PUBLIC_METADATA_KEY, true);
}

/**
 * A resource-scope rule for ResourceGuard (e.g. a client_owner may act only on
 * their own client). Phase-0 ships the wiring + a working example check; full
 * per-domain checks land with their domains.
 */
export interface ResourceRule {
  /** Kind of resource being guarded (e.g. "client"). */
  readonly kind: string;
  /** Named scope check the ResourceGuard knows how to evaluate. */
  readonly scope: "own-client";
}

/** Require the actor to be in scope of the named resource rule. */
export function RequireResource(rule: ResourceRule): CustomDecorator {
  return SetMetadata(RESOURCE_METADATA_KEY, rule);
}
