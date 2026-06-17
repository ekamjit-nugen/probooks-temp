Feature: Typed, validated application configuration (STANDARDS §17, §1, §3)
  As the API service
  I want all environment configuration validated against a Zod schema at boot
  So that a missing or malformed variable fails fast with a clear message,
  and no code reads process.env outside this module.

  Background:
    Given the configuration module parses a raw environment record with Zod

  Scenario: Valid environment produces a typed AppConfig
    Given NODE_ENV is "test"
    And PORT is "3000"
    And LOG_LEVEL is "info"
    When the environment is validated
    Then a typed AppConfig is returned
    And AppConfig.port is the number 3000
    And AppConfig.nodeEnv is "test"

  Scenario: Missing required variable fails fast at boot
    Given LOG_LEVEL is absent and no default applies
    And an unparseable PORT value "not-a-number"
    When the environment is validated
    Then validation throws a clear, aggregated configuration error
    And the error names every offending variable

  Scenario: Defaults applied for omitted optional variables
    Given only NODE_ENV is provided
    When the environment is validated
    Then PORT defaults to 3000
    And LOG_LEVEL defaults to "info"

  Scenario: SecretsProvider returns a secret from the environment-backed implementation
    Given an environment variable "SOME_SECRET" with value "shh"
    When the secret "SOME_SECRET" is requested from the env-backed SecretsProvider
    Then the value "shh" is returned

  Scenario: SecretsProvider rejects a missing secret rather than returning undefined
    Given no environment variable "ABSENT_SECRET"
    When the secret "ABSENT_SECRET" is requested
    Then a clear missing-secret error is thrown

  Scenario: AWS Secrets Manager provider is a deferred stub
    Given the AWS-backed SecretsProvider stub
    When any secret is requested
    Then it throws a not-implemented error citing Wave 7
