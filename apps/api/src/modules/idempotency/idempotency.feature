Feature: HTTP idempotency for state-creating POSTs (STANDARDS §7.4; SPEC §5 Idempotency)
  A state-creating POST may carry an Idempotency-Key header (a UUID). The backend
  stores (tenant_id, key) → the request fingerprint + the stored response, so a
  retried delivery never double-creates state. Same key + same body replays the
  first response; same key + different body is a 409; a still-in-flight duplicate
  is a 409. Everything is tenant-scoped — RLS isolates keys across firms.

  # --- Fingerprint module (pure) ------------------------------------------
  Scenario: The request fingerprint is stable for the same method, path and body
    Given a POST to "/v1/things" with body {"a":1,"b":2}
    When I fingerprint it twice
    Then both fingerprints are identical

  Scenario: The fingerprint ignores body key order
    Given two POSTs to the same path with bodies {"a":1,"b":2} and {"b":2,"a":1}
    When I fingerprint each
    Then the two fingerprints are identical

  Scenario: A different body yields a different fingerprint
    Given two POSTs to the same path with bodies {"a":1} and {"a":2}
    When I fingerprint each
    Then the fingerprints differ

  Scenario: A different path yields a different fingerprint
    Given the same body POSTed to "/v1/things" and "/v1/others"
    When I fingerprint each
    Then the fingerprints differ

  # --- Service / repository (tenant-scoped, over RLS) ----------------------
  Scenario: A fresh key is claimed so the handler may run exactly once
    Given no idempotency row exists for key K in the current tenant
    When the request begins with key K
    Then the outcome is "claimed"

  Scenario: A completed key with the same body replays the stored response
    Given key K was claimed and completed with response 201 {"id":"x"}
    When a second request begins with key K and the SAME body
    Then the outcome is "replay" carrying status 201 and body {"id":"x"}

  Scenario: [§7.4] A completed key with a different body is a conflict
    Given key K was claimed and completed for body B1
    When a second request begins with key K and a DIFFERENT body B2
    Then an IdempotencyKeyConflictError (409) is raised

  Scenario: An in-flight key with the same body is reported in progress
    Given key K is claimed but not yet completed
    When a second request begins with key K and the same body
    Then an IdempotencyRequestInProgressError (409) is raised

  Scenario: An expired key is treated as absent and re-claimed
    Given key K was completed but its row is past expires_at
    When a new request begins with key K
    Then the outcome is "claimed"

  Scenario: Releasing an in-flight key lets a later retry re-claim it
    Given key K is claimed and the handler then fails
    When the request releases key K
    Then a later request with key K is "claimed" again (the failure was not cached)

  # --- Tenancy ------------------------------------------------------------
  Scenario: [INV-TEN-1] Idempotency keys are isolated per tenant
    Given tenant A claimed and completed key K
    When tenant B begins a request with the same key string K
    Then tenant B's outcome is "claimed" (A's key is invisible under RLS)

  # --- Interceptor (HTTP wiring) ------------------------------------------
  Scenario: A POST without an Idempotency-Key passes straight through
    Given an @Idempotent POST route
    When a request arrives with no Idempotency-Key header
    Then the handler runs normally and nothing is persisted

  Scenario: A malformed Idempotency-Key is rejected
    Given an @Idempotent POST route
    When a request arrives with a non-UUID Idempotency-Key
    Then a 400 IdempotencyKeyMalformedError is raised

  Scenario: The first POST runs the handler and persists the response
    Given an @Idempotent POST route and a valid Idempotency-Key
    When the first request arrives
    Then the handler runs once and its response is stored for replay

  Scenario: A retried POST with the same key replays without re-running the handler
    Given the first POST with key K completed
    When an identical POST with key K arrives again
    Then the stored response is returned and the handler side effect runs only once
