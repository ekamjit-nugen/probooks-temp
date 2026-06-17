/**
 * User roles + permissions (STANDARDS §10.2, §10.3; SPEC §1, §4.17).
 * Lives in @probooks/shared so backend guards and (later) frontend agree on one
 * source. Zero runtime deps beyond Zod (STANDARDS §2).
 *
 * Client sub-roles (client_owner / client_staff) are carried from day one per
 * the resolved open decision #1 (PROGRESS §5); Phase 14 UI is deferred.
 */
import { z } from "zod";

/** The five principal roles spanning the three apps (SPEC §1). */
export const UserRoleSchema = z.enum([
  "platform_operator",
  "firm_admin",
  "accountant",
  "client_owner",
  "client_staff",
]);

export type UserRole = z.infer<typeof UserRoleSchema>;

/** Roles bound to a specific client within a tenant (SPEC §4.17, INV-AUTH-3). */
export const CLIENT_ROLES = Object.freeze(["client_owner", "client_staff"]);

/** True iff the role is a client-scoped role (carries a clientId, INV-AUTH-3). */
export function isClientRole(role: UserRole): boolean {
  return role === "client_owner" || role === "client_staff";
}
