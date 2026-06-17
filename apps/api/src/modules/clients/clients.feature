Feature: Tenant-scoped client repository exemplar (STANDARDS §9.3; INV-TEN-1/2)
  ClientRepository is the reference implementation every domain repository
  follows: it reads the tenant from context, never as a parameter, and puts
  tenantId in every query's where — proven against real RLS.

  Scenario: Listing clients returns only the current tenant's rows
    Given clients exist for tenant A and tenant B
    When listForTenant runs under tenant A's context
    Then only tenant A's clients are returned

  Scenario: Fetching another tenant's client by id returns nothing
    Given a client belongs to tenant B
    When findByIdForTenant runs under tenant A's context with B's client id
    Then null is returned (RLS hides the row; the caller maps it to 404)

  Scenario: A repository call with no tenant context fails closed
    Given no tenant context is seeded
    When listForTenant runs
    Then NoTenantContextError is thrown before any query executes
