Feature: Background-job idempotency — the three-layer pattern (STANDARDS §15.2; SPEC §5 Idempotency)
  Every state-changing BullMQ job must be safe under at-least-once delivery and
  retries: it must never double-process a period or double-count a document.
  The defence is three composed layers:
    Layer 1 — Redis SETNX on a job dedupe key (cheap, fast reject of obvious dups)
    Layer 2 — Redlock around the critical section (cross-instance mutual exclusion)
    Layer 3 — a DB uniqueness constraint / atomic upsert (correctness backstop)
  Redis/BullMQ are not wired in Phase 0, so this module encodes the CONTRACT:
  the deterministic dedupe-key derivation (pure, testable now) plus typed seams
  where Layers 1 and 2 plug in when queues land.

  Scenario: A dedupe key is derived deterministically from the job's identity
    Given a job context for queue "extraction", tenant T, entity "period" P, operation "process"
    When I build the dedupe key twice from the same context
    Then both keys are byte-for-byte identical

  Scenario: Dedupe-key derivation is independent of context property order
    Given two job contexts with the same values but different key insertion order
    When I build a dedupe key from each
    Then the two keys are identical

  Scenario: Different job identity yields a different dedupe key
    Given two job contexts that differ only by entity id
    When I build a dedupe key from each
    Then the two keys differ

  Scenario: The dedupe key is namespaced by queue and tenant (no bare global keys)
    Given a job context for queue "extraction" and tenant T
    When I build the dedupe key
    Then it begins with the "job:" namespace and contains the queue and tenant id

  Scenario: A malformed job context is rejected by the schema
    Given a job context missing its tenantId
    When I validate it against the job-idempotency schema
    Then validation fails

  Scenario: The orchestration contract composes the three layers in order
    Given a dedupe store (L1), a distributed lock (L2) and a critical section (L3)
    When the job runs and L1 reports the key was already seen
    Then the critical section is NOT executed (deduplicated)

  Scenario: The orchestration runs the critical section exactly once on first delivery
    Given L1 reports the key is fresh and L2 grants the lock
    When the job runs
    Then the critical section executes exactly once and the lock is released
