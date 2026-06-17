/**
 * RBAC permission matrix (STANDARDS §10.3; SPEC §4.17; INV-RBAC-1/2/3).
 *
 * The single source of truth for "which role may do what", encoded directly
 * from SPEC §4.17. Backend guards (apps/api RoleGuard) and, later, the frontend
 * both consume this — no second copy. Zero runtime deps beyond Zod (STANDARDS §2).
 *
 * Deny-by-default (INV-RBAC-1): a role holds ONLY the permissions listed for it
 * here; everything else is denied. Authorization is re-derived per request from
 * the role alone (INV-AUTH-4) — these helpers consult no session state.
 *
 * The encoding is intentionally row-shaped (one entry per §4.17 capability) so a
 * test can assert, cell by cell, that ROLE_PERMISSIONS matches the spec table.
 */
import type { UserRole } from "./roles.js";

/**
 * One permission per SPEC §4.17 capability row. SCREAMING_SNAKE names map 1:1 to
 * the table rows; the comment carries the spec row text verbatim. Rows that
 * §4.17 grants to NO role ("select filing period" = all "—",
 * "permanently delete financial records" = all "—") are intentionally NOT
 * permissions — they are global prohibitions, not grantable capabilities.
 */
export const PERMISSIONS = [
  "tenant:provision_suspend", // Provision/suspend tenants, billing
  "financial:read", // Read a tenant's financial data
  "firm_user:invite_assign", // Invite firm users / assign roles
  "firm_settings:edit", // Edit firm settings (thresholds, cap, prompt copy, benchmarks)
  "scorecard:read", // Read firm-side scorecard
  "client:create_configure", // Create client / set filing frequency & period
  "client_checklist:define", // Define per-client document checklist
  "document:upload", // Upload documents
  "document:delete_pre_lock", // Delete uploaded docs (pre-AI-lock only)
  "flag:raise", // Raise flags
  "flag:answer", // Answer flags
  "attestation:make_not_found", // Make "Not found" attestation
  "period:process", // Process period (compute draft numbers)
  "period:mark_complete", // Mark period complete (gate 2)
  "excel:download", // Download current-period Excel
  "filed_return:upload", // Upload filed-return PDFs
  "quarter_numbers:view", // View current-quarter numbers
  "confidence_signals:view", // View confidence % / operational signals
  "feedback:submit", // Submit quarterly feedback
  "permission:govern", // Set/change any permission or sharing
] as const;

/** A permission string from the SPEC §4.17 matrix. */
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Grant level for a capability/role cell in SPEC §4.17:
 *  - "grant" = ✓ (full)
 *  - "read"  = R (read-only — modeled as holding the permission; read-vs-write
 *               nuance is enforced by the route's verb + a separate write perm
 *               where the spec distinguishes, e.g. excel:download is the client's
 *               full grant while firm roles get it read-only)
 *  - "deny"  = — (deny-by-default; absent from the role's set)
 *
 * We model "R" as "holds the permission" because §4.17's read-only cells
 * (scorecard for accountant; excel for firm roles) are read surfaces guarded by
 * GET routes. The matrix test asserts these cells explicitly so the distinction
 * is not lost.
 */
type Cell = "grant" | "read" | "deny";

/** The §4.17 grid: capability → per-role cell. Mirrors the table row-for-row. */
export const CAPABILITY_MATRIX: Readonly<
  Record<Permission, Readonly<Record<UserRole, Cell>>>
> = Object.freeze({
  "tenant:provision_suspend": {
    platform_operator: "grant",
    firm_admin: "deny",
    accountant: "deny",
    client_owner: "deny",
    client_staff: "deny",
  },
  "financial:read": {
    platform_operator: "deny", // INV-TEN-3: operator never reads financial data
    firm_admin: "grant",
    accountant: "grant",
    client_owner: "grant",
    client_staff: "grant",
  },
  "firm_user:invite_assign": {
    platform_operator: "deny",
    firm_admin: "grant",
    accountant: "deny",
    client_owner: "deny",
    client_staff: "deny",
  },
  "firm_settings:edit": {
    platform_operator: "deny",
    firm_admin: "grant",
    accountant: "deny",
    client_owner: "deny",
    client_staff: "deny",
  },
  "scorecard:read": {
    platform_operator: "deny",
    firm_admin: "grant",
    accountant: "read", // R: own clients if firm policy allows (INV-RBAC-2)
    client_owner: "deny",
    client_staff: "deny",
  },
  "client:create_configure": {
    platform_operator: "deny",
    firm_admin: "grant",
    accountant: "grant",
    client_owner: "deny",
    client_staff: "deny",
  },
  "client_checklist:define": {
    platform_operator: "deny",
    firm_admin: "grant",
    accountant: "grant",
    client_owner: "deny",
    client_staff: "deny",
  },
  "document:upload": {
    platform_operator: "deny",
    firm_admin: "deny",
    accountant: "deny",
    client_owner: "grant",
    client_staff: "grant",
  },
  "document:delete_pre_lock": {
    platform_operator: "deny",
    firm_admin: "deny",
    accountant: "deny",
    client_owner: "grant",
    client_staff: "grant",
  },
  "flag:raise": {
    platform_operator: "deny",
    firm_admin: "deny",
    accountant: "grant", // red flags
    client_owner: "deny",
    client_staff: "deny",
  },
  "flag:answer": {
    platform_operator: "deny",
    firm_admin: "deny",
    accountant: "grant", // on defer
    client_owner: "grant",
    client_staff: "grant",
  },
  "attestation:make_not_found": {
    platform_operator: "deny",
    firm_admin: "deny",
    accountant: "deny",
    client_owner: "grant",
    client_staff: "grant",
  },
  "period:process": {
    platform_operator: "deny",
    firm_admin: "deny",
    accountant: "grant",
    client_owner: "deny",
    client_staff: "deny",
  },
  "period:mark_complete": {
    platform_operator: "deny",
    firm_admin: "deny",
    accountant: "grant",
    client_owner: "deny",
    client_staff: "deny",
  },
  "excel:download": {
    platform_operator: "deny",
    firm_admin: "read", // R
    accountant: "read", // R
    client_owner: "grant", // ✓ after sign-off
    client_staff: "grant",
  },
  "filed_return:upload": {
    platform_operator: "deny",
    firm_admin: "grant",
    accountant: "grant",
    client_owner: "deny",
    client_staff: "deny",
  },
  "quarter_numbers:view": {
    platform_operator: "deny",
    firm_admin: "grant",
    accountant: "grant",
    client_owner: "grant", // after gate
    client_staff: "grant",
  },
  "confidence_signals:view": {
    platform_operator: "deny",
    firm_admin: "grant",
    accountant: "grant",
    client_owner: "deny", // INV-DISP-6 / INV-RBAC-3
    client_staff: "deny",
  },
  "feedback:submit": {
    platform_operator: "deny",
    firm_admin: "deny",
    accountant: "deny",
    client_owner: "grant",
    client_staff: "grant",
  },
  "permission:govern": {
    platform_operator: "grant", // governed, audited
    firm_admin: "grant", // governed, audited
    accountant: "deny",
    client_owner: "deny",
    client_staff: "deny",
  },
});

const ALL_ROLES: readonly UserRole[] = [
  "platform_operator",
  "firm_admin",
  "accountant",
  "client_owner",
  "client_staff",
];

/** True iff a §4.17 cell grants the capability to the role (✓ or R). */
function cellGrants(cell: Cell): boolean {
  return cell === "grant" || cell === "read";
}

/**
 * Derive the role→permissions map from the §4.17 grid. The single, computed
 * source guards consume. Built once, frozen.
 */
function buildRolePermissions(): Readonly<
  Record<UserRole, ReadonlySet<Permission>>
> {
  const entries = ALL_ROLES.map((role): [UserRole, ReadonlySet<Permission>] => {
    const granted = PERMISSIONS.filter((permission) =>
      cellGrants(CAPABILITY_MATRIX[permission][role]),
    );
    return [role, Object.freeze(new Set<Permission>(granted))];
  });
  return Object.freeze(Object.fromEntries(entries)) as Readonly<
    Record<UserRole, ReadonlySet<Permission>>
  >;
}

/** role → exactly the permissions SPEC §4.17 grants it (deny-by-default). */
export const ROLE_PERMISSIONS = buildRolePermissions();

/**
 * Re-derive authorization from the role alone (INV-AUTH-4 / INV-RBAC-1). Returns
 * true iff the role's encoded set holds the permission. Consults no session or
 * prior state.
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** The full permission set for a role (read-only). */
export function permissionsForRole(role: UserRole): ReadonlySet<Permission> {
  return ROLE_PERMISSIONS[role];
}
