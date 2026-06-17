# Phase 0 / Wave 8 — the composed full spine.
#
# These scenarios are the RED-first contract for spine.e2e.spec.ts. They compose
# the already-built Wave 0–6 primitives end to end over a REAL Postgres 16
# (Testcontainers, app_user role so RLS + grants bind) behind a real Nest app:
# the full GUARD_STACK (Auth -> Tenant -> Role -> Resource) + the @Idempotent
# interceptor in front of a thin test-only handler that, in ONE tenant-scoped
# transaction, writes a client through ClientRepository AND appends an
# AuditService entry. Tokens are real signed HS256 access tokens per role.

Feature: The ProBooks backend spine composes end to end
  As the platform
  The auth, tenant, RBAC, resource, idempotency, tenant-scoped write, and audit
  primitives must work TOGETHER, not just in isolation.

  Background:
    Given a real Postgres 16 with the committed migrations applied
    And a Nest app wiring the real GUARD_STACK + @Idempotent over a test handler
    And the handler writes a client and appends an audit entry in one transaction
    And requests are driven with real signed access tokens connected as app_user

  # 1 — Happy path  [INV-AUTH-4][INV-TEN-1][INV-AUDIT-1][§9.3/§10.2]
  Scenario: A firm_admin creates a client with an idempotency key
    Given a valid firm_admin access token for tenant A
    When it POSTs the create with an Idempotency-Key
    Then the response is 201
    And exactly one client row exists for tenant A
    And exactly one audit entry was appended in the same transaction
    And tenant A's audit hash chain verifies clean

  # 2 — Idempotent replay  [§7.4]
  Scenario: The same key and same body replays with the side effect exactly once
    Given a firm_admin already created a client with a given key and body
    When the same key and same body is POSTed again
    Then the response is 201 and byte-identical to the first
    And there is still exactly one client row and one audit entry for that key

  # 3 — Idempotency conflict  [§7.4]
  Scenario: The same key with a different body is a conflict
    Given a firm_admin already created a client with a given key
    When the same key is POSTed with a different body
    Then the response is 409
    And no second client row and no second audit entry are written

  # 4 — Cross-tenant isolation  [INV-TEN-1][INV-TEN-2][§9.4]
  Scenario: A tenant A token probing tenant B's path is 404, not 403
    Given a valid firm_admin token scoped to tenant A
    When it targets tenant B's path
    Then the response is 404
    And as app_user a cross-tenant read returns zero rows even with the app filter removed

  # 5 — Operator dual-block  [INV-TEN-3]
  Scenario: The platform operator is blocked at the guard AND at the DB grant
    Given a valid platform_operator access token
    When it reads the financial summaries route
    Then the response is 403 at the guard
    And service_role has no grant to read period_summaries

  # 7 — Audit tamper  [INV-AUDIT-2]
  Scenario: Tampering an audit row fails the chain verifier at that position
    Given a committed audit chain for a tenant
    When a privileged out-of-band actor mutates one entry
    Then the chain verifier fails at that entry's position
