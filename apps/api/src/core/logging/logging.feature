Feature: Structured logging with PII redaction (STANDARDS §13)
  As the API service
  I want a Pino-based, injectable logger that redacts PII
  So that emails, business numbers, names and document contents never appear
  in logs, and every line carries request correlation fields.

  Scenario: Logger is injected, not constructed ad-hoc
    Given the LoggingModule is imported
    When a provider injects the logger
    Then it receives a configured Pino logger instance

  Scenario: Emails are redacted
    Given a log payload containing an "email" field
    When the line is serialized through the redaction config
    Then the email value is "[REDACTED]"

  Scenario: Business numbers are redacted
    Given a log payload containing a "businessNumber" field
    When the line is serialized through the redaction config
    Then the businessNumber value is "[REDACTED]"

  Scenario: Names and document contents are redacted
    Given a log payload containing "name" and "documentContents" fields
    When the line is serialized through the redaction config
    Then both values are "[REDACTED]"

  Scenario: Correlation fields are present on every line
    Given a request in flight
    When a line is logged
    Then it carries requestId, route and latencyMs
    And it carries tenantId and userId seams (null until TenantContext lands in Wave 2)

  Scenario: Pretty transport only in local dev
    Given NODE_ENV is "production"
    When the logger is built
    Then no pretty transport is configured
    And output is JSON
