Feature: Financial data is tenant-scoped and operator-forbidden (STANDARDS §9.3, §10.2; INV-TEN-1, INV-TEN-3)
  Financial data (period_summaries) is reachable ONLY through the tenant-scoped
  app_user connection, only for the tenant in context, and only by roles holding
  the financial:read capability. The Platform Operator is denied at the guard,
  and would see zero rows at RLS even if it weren't.

  Scenario: [INV-TEN-3] The operator is denied the financial route at the guard
    Given the Platform Operator is authenticated
    When they GET /v1/financial/summaries
    Then the RoleGuard returns 403 (financial:read not granted to operator)
    And no handler or database access occurs

  Scenario: A firm role holding financial:read reaches the handler
    Given a firm_admin is authenticated for their tenant
    When they GET /v1/financial/summaries
    Then the request reaches the handler (200)

  Scenario: [INV-TEN-1] A tenant reads only its OWN financial rows (RLS)
    Given tenant A and tenant B each have a period summary
    When app_user reads summaries with tenant A bound
    Then only tenant A's row is returned

  Scenario: [INV-TEN-3] Financial reads are zero-rows without a bound tenant
    Given a period summary exists for tenant A
    When app_user reads summaries with NO tenant bound
    Then zero rows are returned (fail-closed RLS) — not an error leak

  Scenario: Money is serialised as a precise string at the boundary (§8.6)
    Given a period summary with net_tax 1234.5600
    When it is mapped to the transport DTO
    Then netTax is the string "1234.5600", never a float
