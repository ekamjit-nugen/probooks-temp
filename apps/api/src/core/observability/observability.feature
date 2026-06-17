Feature: Observability — correlation + RED metrics (STANDARDS §13, §14)
  Every request carries a correlation id and a W3C trace context, and every route
  emits Rate/Errors/Duration. This makes errors traceable end-to-end (the id
  lands in the §7.1 error envelope) and gives the metrics backend RED signals.

  # --- Trace context (pure) ----------------------------------------------
  Scenario: A valid incoming traceparent is continued with a new span id
    Given a request with a well-formed traceparent header
    When the trace context is derived
    Then the trace id is preserved and a fresh parent (span) id is issued

  Scenario: A missing or malformed traceparent starts a fresh root trace
    Given a request with no traceparent (or a malformed one)
    When the trace context is derived
    Then a new non-zero trace id and span id are generated, flagged sampled

  Scenario: An all-zero trace id is rejected as malformed
    Given a traceparent whose trace id is all zeroes
    When it is parsed
    Then parsing returns null

  # --- Request id correlation --------------------------------------------
  Scenario: A safe incoming x-request-id is adopted and echoed
    Given a request with a valid x-request-id header
    When the middleware runs
    Then req.requestId equals the header and the response echoes x-request-id

  Scenario: A missing/unsafe x-request-id is replaced with a generated UUID
    Given a request with no (or an unsafe) x-request-id header
    When the middleware runs
    Then req.requestId is a generated UUID and is echoed on the response

  Scenario: [§7.1] The request id flows into the error envelope
    Given a route that throws a DomainError
    When a request with x-request-id "req-abc" hits it
    Then the error envelope's requestId is "req-abc"

  # --- RED metrics --------------------------------------------------------
  Scenario: A completed request records rate + duration for its route template
    Given a route GET /health/live
    When a request completes
    Then the recorder has one observation for "GET /health/live" with a duration

  Scenario: A 5xx response increments the error count (RED's E)
    Given a route that returns 503
    When a request completes
    Then the recorder counts it as an error for that route
