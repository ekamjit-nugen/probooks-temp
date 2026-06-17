Feature: RLS posture verification (STANDARDS §8.4; INV-TEN-1)
  Every tenant-scoped table must have Row-Level Security ENABLED and FORCED, so
  that even the table owner is bound by the tenant-isolation policy. A startup /
  test assertion proves the posture rather than trusting that the migration ran.

  Scenario: All tenant-scoped tables are RLS-enabled and FORCED
    Given the migrations have been applied
    When verifyRlsEnabled inspects pg_class
    Then users, clients, audit_log, idempotency_keys and refresh_tokens are all
      both rowsecurity = true and forcerowsecurity = true

  Scenario: A table missing FORCE is reported
    Given a tenant-scoped table has RLS enabled but not forced
    When verifyRlsEnabled runs
    Then it returns that table as a violation
