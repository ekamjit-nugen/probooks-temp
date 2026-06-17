Feature: Tenant-bound Prisma access (STANDARDS §8.4, §9.6; INV-TEN-1/3)
  PrismaService connects as the NON-superuser app_user role so RLS is enforced.
  Every tenant-scoped unit of work runs inside a transaction that issues
  SET LOCAL app.tenant_id so the RLS policies bind to the request's tenant,
  which is read from TenantContext — never passed as a parameter.

  Scenario: runInTenantTx binds the current tenant for the transaction
    Given a seeded tenant context for tenant T
    When runInTenantTx runs a query
    Then app.tenant_id is set to T for that transaction only
    And rows for other tenants are invisible to the query

  Scenario: runInTenantTx with no tenant in scope fails closed
    Given no tenant context is seeded
    When runInTenantTx is called
    Then NoTenantContextError is thrown before any query runs

  Scenario: SET LOCAL scoping is per-transaction
    Given runInTenantTx ran for tenant A
    When a later unscoped query runs on the same connection
    Then app.tenant_id is no longer A (it did not leak past the transaction)

  Scenario: The platform service_role bypasses RLS for operator/migration work
    Given the PlatformPrismaService connected as service_role
    When it reads tenants across the table
    Then it returns rows for multiple tenants (BYPASSRLS), unlike app_user
