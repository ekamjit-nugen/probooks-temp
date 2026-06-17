Feature: Platform operator metadata access, separated from financial data (STANDARDS §9.6; INV-TEN-3)
  The Platform Operator manages tenant lifecycle + billing metadata across all
  firms via the service_role (BYPASSRLS) connection, but is structurally barred
  from any tenant's financial data. PlatformRepository serves the metadata; it
  exposes no financial accessor, and service_role holds no DB grant on financial
  tables.

  Scenario: The operator reads tenant metadata across tenants
    Given two tenants A and B with users
    When PlatformRepository.getTenantMetadata is called for tenant A
    Then it returns A's status, region, plan and user count

  Scenario: The operator lists all tenants (cross-tenant, service_role)
    Given several tenants exist
    When PlatformRepository.listTenants is called
    Then every tenant's metadata is returned (no RLS scoping)

  Scenario: [INV-TEN-3] service_role cannot read financial data at the DB
    Given a period_summaries row exists for tenant A
    When the service_role connection selects from period_summaries
    Then the database denies it (no grant) — operator cannot read financials
