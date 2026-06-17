Feature: Append-only audit service with hash chaining (STANDARDS §18.3; INV-AUDIT-1/2/3)
  Every state transition records who/what/when/before→after as an append-only,
  hash-chained entry. The write is composable inside the caller's transaction so
  it is atomic with the parent state change, and the chain is verifiable.

  Scenario: Recording attributes the action to the principal in context
    Given a firm_admin principal is in the tenant context
    When a "period.processed" transition is recorded
    Then the entry's actorUserId and actorRole come from the context, not the caller

  Scenario: occurredAt defaults to now when the caller omits it
    Given a transition is recorded without an explicit occurredAt
    When the entry is written
    Then occurredAt is the service clock's current time

  Scenario: The audit write is atomic with the parent transaction
    Given a parent transaction records an audit entry and then throws
    When the transaction rolls back
    Then no audit row persists for that tenant

  Scenario: The audit write commits with the parent transaction
    Given a parent transaction records an audit entry and then commits
    When the transaction commits
    Then exactly one new audit row persists, chained from the previous head

  Scenario: Verifying an intact chain succeeds
    Given a tenant's chain of recorded entries is intact
    When the chain is verified
    Then verification passes

  Scenario: Verifying a tampered chain raises AuditChainTamperError
    Given a tenant's chain has a tampered entry at some position
    When the chain is verified
    Then an AuditChainTamperError is raised naming that position
