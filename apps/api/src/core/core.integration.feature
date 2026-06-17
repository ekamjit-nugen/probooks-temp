Feature: Core foundation modules compose correctly (Wave 1 integration)
  As the API service
  I want the validation pipe, domain errors, exception filter and logger to work together
  So that a request flowing through all of them yields the §7.1 envelope and redacted logs.

  Scenario: Bad input through the pipe surfaces a VALIDATION_FAILED envelope
    Given a controller route guarded by the ZodValidationPipe
    When a request with invalid body is sent
    Then the response status is 400
    And the body is the §7.1 error envelope with code "VALIDATION_FAILED"
    And body.error.requestId is present

  Scenario: A thrown DomainError surfaces its envelope
    Given a controller route that throws a DomainError
    When the request is sent
    Then the response status matches the error's httpStatus
    And the body is the §7.1 error envelope with the error's code

  Scenario: An unknown thrown error is sanitized to 500
    Given a controller route that throws a native Error
    When the request is sent
    Then the response status is 500
    And the body code is "INTERNAL_ERROR"
    And no stack trace or file path is leaked

  Scenario: The logger redacts PII in a logged payload
    Given a payload containing an email and a business number
    When it is logged through the configured logger
    Then the serialized output contains "[REDACTED]" and neither raw value
