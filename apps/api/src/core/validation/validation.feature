Feature: Zod validation pipe (STANDARDS §11)
  As the API service
  I want request body/query/params parsed against a provided Zod schema
  So that invalid input is rejected with a typed VALIDATION_FAILED error
  carrying per-field details, using Zod only (never class-validator).

  Scenario: Valid input passes through unchanged and typed
    Given a ZodValidationPipe bound to a schema { name: string }
    And an input { name: "Ada" }
    When the pipe transforms the input
    Then it returns the parsed value { name: "Ada" }

  Scenario: Invalid input raises a typed validation error
    Given a ZodValidationPipe bound to a schema { age: number >= 0 }
    And an input { age: -1 }
    When the pipe transforms the input
    Then it throws a ValidationFailedError
    And the error code is "VALIDATION_FAILED"
    And the error httpStatus is 400
    And the error details map "age" to a message

  Scenario: Multiple field errors are all reported
    Given a ZodValidationPipe bound to a schema requiring name and age
    And an input missing both
    When the pipe transforms the input
    Then the error details include both "name" and "age"

  Scenario: Unknown extra fields are stripped or rejected per schema
    Given a strict object schema
    And an input with an unexpected field
    When the pipe transforms the input
    Then the unexpected field causes a VALIDATION_FAILED error
