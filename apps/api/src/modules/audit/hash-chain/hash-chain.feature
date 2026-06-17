Feature: Deterministic per-tenant audit hash chain (STANDARDS §18.3; INV-AUDIT-1/2)
  Every audit entry is hashed into a tamper-evident chain. An entry's hash binds
  its own fields, its position in the tenant's chain, and the previous entry's
  hash, so any mutation, deletion, reordering, or insertion breaks the chain and
  is detectable by replaying it (INV-FIN-8 spirit: reproducible from inputs).

  Background:
    Given a strong hash (sha256) and a deterministic field canonicalization

  Scenario: The hash is reproducible from the same inputs
    Given an entry's hashed fields
    When the entry hash is computed twice
    Then both computations produce the identical hex digest

  Scenario: Key order does not change the hash
    Given two field objects with the same keys/values in different insertion order
    When each is canonicalized and hashed
    Then both produce the identical hex digest

  Scenario: The first entry links to a fixed genesis
    Given a tenant with no prior audit entries
    When the first entry's previous hash is requested
    Then it is the defined genesis hash (a constant, not empty)

  Scenario: Each entry's hash depends on the previous entry's hash
    Given two entries A then B where B.prevHash = A.entryHash
    When A is mutated and A.entryHash recomputed
    Then B.prevHash no longer equals the recomputed A.entryHash (link broken)

  Scenario: Changing any single hashed field changes the digest
    Given an entry's hashed fields
    When exactly one field value is altered
    Then the recomputed entry hash differs from the original
