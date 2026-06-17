Feature: Typed domain errors and exception mapping (STANDARDS §12, §7.1)
  As the API service
  I want every business error to extend DomainError and map to the §7.1 envelope
  So that responses are consistent and unknown errors never leak internals.

  Scenario: A DomainError maps to the error envelope
    Given a thrown FlagAlreadyClearedError with httpStatus 409 and code "FLAG_ALREADY_CLEARED"
    When the DomainExceptionFilter handles it
    Then the HTTP status is 409
    And the body is { error: { code, message, details?, requestId } }
    And the body.error.code is "FLAG_ALREADY_CLEARED"
    And the body.error.requestId is present

  Scenario: A DomainError carries structured details
    Given a thrown ValidationFailedError with per-field details
    When the DomainExceptionFilter handles it
    Then the HTTP status is 400
    And body.error.code is "VALIDATION_FAILED"
    And body.error.details lists the offending fields

  Scenario: An unknown error is sanitized to a 500
    Given a thrown native Error with an internal stack trace
    When the DomainExceptionFilter handles it
    Then the HTTP status is 500
    And body.error.code is "INTERNAL_ERROR"
    And the body contains no stack trace or internal file path
    And the Sentry reporting hook is invoked once with the original error

  Scenario: requestId is propagated from the request when present
    Given an incoming request carrying a requestId
    When any error is handled
    Then body.error.requestId equals the request's requestId
