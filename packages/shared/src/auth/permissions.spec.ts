/**
 * Proves the encoded RBAC matrix matches SPEC §4.17 cell-by-cell, and that the
 * helpers re-derive authorization from the role alone (STANDARDS §10.3; SPEC
 * §4.17; INV-RBAC-1/2/3, INV-AUTH-4, INV-TEN-3, INV-DISP-6).
 *
 * EXPECTED_417 is a literal transcription of the SPEC §4.17 grid (✓ / R / —).
 * If the encoded CAPABILITY_MATRIX ever drifts from the spec, this test fails.
 */
import { describe, expect, it } from "vitest";

import {
  CAPABILITY_MATRIX,
  hasPermission,
  PERMISSIONS,
  permissionsForRole,
  ROLE_PERMISSIONS,
  type Permission,
} from "./permissions.js";
import type { UserRole } from "./roles.js";

type Cell = "✓" | "R" | "—";

/**
 * SPEC §4.17 transcribed verbatim. Order: [operator, firm_admin, accountant,
 * client_owner, client_staff]. Client column ("Client") applies to BOTH client
 * sub-roles unless the row note distinguishes (none do in §4.17).
 *
 * Rows that §4.17 grants to NO role are NOT permissions (global prohibitions):
 *   - "Select filing period / date range" → all "—" (INV-CFG-5)
 *   - "Permanently delete financial records" → all "—" (INV-AUDIT-3)
 * They are asserted separately below.
 */
const EXPECTED_417: Readonly<Record<Permission, readonly Cell[]>> = {
  "tenant:provision_suspend": ["✓", "—", "—", "—", "—"],
  "financial:read": ["—", "✓", "✓", "✓", "✓"],
  "firm_user:invite_assign": ["—", "✓", "—", "—", "—"],
  "firm_settings:edit": ["—", "✓", "—", "—", "—"],
  "scorecard:read": ["—", "✓", "R", "—", "—"],
  "client:create_configure": ["—", "✓", "✓", "—", "—"],
  "client_checklist:define": ["—", "✓", "✓", "—", "—"],
  "document:upload": ["—", "—", "—", "✓", "✓"],
  "document:delete_pre_lock": ["—", "—", "—", "✓", "✓"],
  "flag:raise": ["—", "—", "✓", "—", "—"],
  "flag:answer": ["—", "—", "✓", "✓", "✓"],
  "attestation:make_not_found": ["—", "—", "—", "✓", "✓"],
  "period:process": ["—", "—", "✓", "—", "—"],
  "period:mark_complete": ["—", "—", "✓", "—", "—"],
  "excel:download": ["—", "R", "R", "✓", "✓"],
  "filed_return:upload": ["—", "✓", "✓", "—", "—"],
  "quarter_numbers:view": ["—", "✓", "✓", "✓", "✓"],
  "confidence_signals:view": ["—", "✓", "✓", "—", "—"],
  "feedback:submit": ["—", "—", "—", "✓", "✓"],
  "permission:govern": ["✓", "✓", "—", "—", "—"],
};

const ROLE_ORDER: readonly UserRole[] = [
  "platform_operator",
  "firm_admin",
  "accountant",
  "client_owner",
  "client_staff",
];

function expectedHolds(cell: Cell): boolean {
  return cell === "✓" || cell === "R";
}

describe("RBAC matrix equals SPEC §4.17 [INV-RBAC-1]", () => {
  it("encodes exactly the §4.17 capability rows (no extra, none missing)", () => {
    expect(new Set(PERMISSIONS)).toEqual(
      new Set(Object.keys(EXPECTED_417) as Permission[]),
    );
  });

  it.each(PERMISSIONS)(
    "capability '%s' matches §4.17 cell-by-cell across all 5 roles",
    (permission) => {
      const expectedRow = EXPECTED_417[permission];
      ROLE_ORDER.forEach((role, index) => {
        const expectedCell = expectedRow[index];
        const encodedHolds = hasPermission(role, permission);
        expect(encodedHolds).toBe(expectedHolds(expectedCell as Cell));
      });
    },
  );

  it("ROLE_PERMISSIONS is derivable straight from CAPABILITY_MATRIX", () => {
    for (const role of ROLE_ORDER) {
      const fromMatrix = PERMISSIONS.filter((permission) => {
        const cell = CAPABILITY_MATRIX[permission][role];
        return cell === "grant" || cell === "read";
      });
      expect([...ROLE_PERMISSIONS[role]].sort()).toEqual(fromMatrix.sort());
    }
  });
});

describe("Invariant cross-checks on the matrix", () => {
  it("[INV-TEN-3] platform_operator holds NO financial-data permission", () => {
    expect(hasPermission("platform_operator", "financial:read")).toBe(false);
    expect(hasPermission("platform_operator", "quarter_numbers:view")).toBe(
      false,
    );
    expect(hasPermission("platform_operator", "confidence_signals:view")).toBe(
      false,
    );
    expect(hasPermission("platform_operator", "excel:download")).toBe(false);
    expect(hasPermission("platform_operator", "scorecard:read")).toBe(false);
  });

  it("[INV-TEN-3] platform_operator holds ONLY lifecycle/governance permissions", () => {
    expect([...permissionsForRole("platform_operator")].sort()).toEqual(
      ["permission:govern", "tenant:provision_suspend"].sort(),
    );
  });

  it("[INV-RBAC-3][INV-DISP-6] clients hold no firm-internal permissions", () => {
    for (const role of ["client_owner", "client_staff"] as const) {
      expect(hasPermission(role, "confidence_signals:view")).toBe(false);
      expect(hasPermission(role, "scorecard:read")).toBe(false);
      expect(hasPermission(role, "firm_settings:edit")).toBe(false);
      expect(hasPermission(role, "firm_user:invite_assign")).toBe(false);
      expect(hasPermission(role, "flag:raise")).toBe(false);
      expect(hasPermission(role, "period:process")).toBe(false);
      expect(hasPermission(role, "period:mark_complete")).toBe(false);
    }
  });

  it("[INV-RBAC-2] only firm_admin fully edits firm settings; accountant denied", () => {
    expect(hasPermission("firm_admin", "firm_settings:edit")).toBe(true);
    expect(hasPermission("accountant", "firm_settings:edit")).toBe(false);
  });

  it("[INV-RBAC-1] deny-by-default: an unknown role-permission pair is false", () => {
    // client_staff is not granted period:process anywhere → denied.
    expect(hasPermission("client_staff", "period:process")).toBe(false);
  });
});
