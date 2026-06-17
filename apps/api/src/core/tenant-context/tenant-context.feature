Feature: Request-scoped tenant context (STANDARDS §9.2/§9.3; INV-TEN-1/2)
  The tenant context carries the authenticated principal for the duration of a
  request via AsyncLocalStorage. Repositories read tenantId from it — never as a
  parameter — so no call site can accidentally query across tenants.

  Scenario: A seeded context is readable inside the request
    Given a request runs inside runWithContext with tenant T and a firm_admin
    When a repository calls require()
    Then it receives the same tenantId, userId and userRole

  Scenario: Reading the context with no tenant in scope fails closed
    Given no context has been seeded
    When require() is called
    Then a NoTenantContextError (DomainError, 401) is thrown
    And it is never silently treated as a missing/empty tenant

  Scenario: Contexts do not leak between concurrent requests
    Given two requests run concurrently under different tenants
    When each reads its tenantId
    Then each sees only its own tenant, never the other's

  Scenario: A client principal carries a clientId; a firm principal does not
    Given a client_owner principal is seeded
    Then the context exposes a clientId
    And a firm_admin principal exposes no clientId
