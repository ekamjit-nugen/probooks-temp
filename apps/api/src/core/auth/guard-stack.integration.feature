Feature: Full guard stack over a test controller (STANDARDS §10.2; §19.3 #3/#4)
  The canonical stack AuthGuard → TenantGuard → RoleGuard → ResourceGuard is
  applied to a representative controller. The principal is built ONLY from the
  verified token; the request body's tenantId is ignored. Authorization is
  re-derived per request from role + tenant (INV-AUTH-4).

  Scenario: RBAC matrix — every role attempts every guarded route
    Given a controller route guarded by @RequireRole / @RequirePermission per SPEC §4.17
    When each of the 5 roles presents a valid token for the right tenant
    Then only the roles SPEC §4.17 permits get 2xx; the rest get 403

  Scenario: Cross-tenant probe returns 404, not 403
    Given a user authenticated for tenant A
    When they call /v1/firms/<tenantB>/ping
    Then the response is 404 (INV-TEN-2, §9.4) — existence is not leaked
    And a same-tenant role denial on the same controller is 403 (not 404)

  Scenario: Unauthenticated request is 401
    Given no Bearer token
    When any guarded route is called
    Then the response is 401

  Scenario: Deny-by-default — an unannotated guarded route is denied
    Given a controller method with no @RequireRole/@RequirePermission/@Public
    When an authenticated user calls it
    Then the response is 403

  Scenario: TenantContext is seeded from the verified token for the handler
    Given a valid token for tenant A
    When the handler reads TenantContextService.require()
    Then it sees tenant A — derived from the token, never from the body
