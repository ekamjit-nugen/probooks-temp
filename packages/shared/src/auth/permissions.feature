Feature: RBAC permission matrix (STANDARDS §10.3; SPEC §4.17; INV-RBAC-1/2/3)
  The capability matrix from SPEC §4.17 is encoded ONCE in @probooks/shared as the
  single source of truth shared by backend guards and (later) the frontend. Every
  capability maps to the exact set of roles SPEC §4.17 grants it; an action not
  granted to a role is denied by default (deny-by-default, INV-RBAC-1).

  Scenario: Every capability resolves to the roles SPEC §4.17 grants it
    Given the encoded ROLE_PERMISSIONS map
    When I read the roles that hold a given permission
    Then they equal exactly the ✓/R cells of that capability's row in SPEC §4.17

  Scenario: Deny by default for ungranted capabilities
    Given a role that SPEC §4.17 marks "—" for a capability
    When I ask whether that role holds the permission
    Then the answer is false

  Scenario: The Platform Operator never holds any financial-data permission
    Given the platform_operator role (INV-TEN-3)
    When I read its permission set
    Then it contains no read/write permission over a tenant's financial data
    And it contains only tenant-lifecycle/billing permissions

  Scenario: Clients never hold firm-internal permissions
    Given a client_owner or client_staff role (INV-RBAC-3)
    When I read its permission set
    Then it holds no scorecard, confidence/signals, firm-settings, or firm-user permission

  Scenario: hasPermission re-derives authorization from the role alone
    Given any role and any permission
    When hasPermission(role, permission) is evaluated
    Then it returns true iff the role's encoded set contains the permission
    And it consults no session or prior state (INV-AUTH-4)
