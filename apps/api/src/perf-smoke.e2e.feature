# Phase 0 / Wave 8 — Test obligation #8: performance smoke (STANDARDS §19.3 #8, §22).
#
# These are SMOKE GATES — regression tripwires, NOT SLO proofs. There is no
# deployed server in Phase 0, so we cannot do real load testing (k6) against live
# infra; that is deferred to account provisioning (J.2) alongside Multi-AZ
# failover RTO validation. Instead we exercise the REAL Phase-0 components in
# process — HmacTokenService, AuditService over a real Postgres 16 (Testcontainers,
# app_user role so RLS + grants bind), and an RLS-on vs RLS-bypass SELECT — and
# assert generous, headroom-padded ceilings so the gate catches gross regressions
# without flaking on noisy CI/Testcontainers substrate.
#
# Each smoke warms up, discards the first iteration, then measures p50/p95 over a
# loop and asserts a CI-safe ceiling padded well above the prod SLO. The true prod
# SLO is named in the scenario + the it() name + an inline comment.

Feature: Phase-0 components stay within performance smoke budgets
  As the platform
  Core auth, audit, and RLS paths must not grossly regress
  So that the production SLO budgets (§22) remain attainable.

  Background:
    Given the real Phase-0 components (HmacTokenService, AuditService, RLS)
    And a warm-up pass whose first iteration is discarded
    And measurements taken as p50/p95 over a loop (not max), with padded ceilings

  # 1 — Auth  [§22 API p95<300ms; SLO auth p95<200ms]
  Scenario: Issuing and verifying an access token stays well under the smoke ceiling
    Given an HmacTokenService with a fixed test secret
    When it signs then verifies an access token 200 times
    Then the p95 round-trip is under the padded smoke ceiling (50ms; prod SLO <200ms)

  # 2 — Audit write  [INV-AUDIT-1; SLO audit write <5ms on warm RDS]
  Scenario: Recording an audit entry over real Postgres stays under the smoke ceiling
    Given an AuditService over a real Postgres 16 as app_user in a tenant tx
    When it records 50 audit entries
    Then the p95 write is under the padded smoke ceiling (150ms; prod target <5ms on warm RDS)

  # 3 — RLS overhead  [INV-TEN-1; prod target <10% overhead]
  Scenario: The RLS-enforced read path is within a sane multiple of the bypass path
    Given a tenant-scoped SELECT as app_user (RLS forced) and as service_role (BYPASSRLS)
    When each is run 50 times
    Then the RLS path p95 is under an absolute padded ceiling and a generous multiple of bypass (prod target <10%)
