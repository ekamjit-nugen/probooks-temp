Feature: Compute and IAM enforce least privilege (STANDARDS §9.6, §13, §14, INV-TEN-3)
  The API runs on ECS Fargate. Container logs flow to an encrypted CloudWatch
  log group with explicit retention (OTel -> CloudWatch is the target). Two
  IAM task roles model least privilege: an application task role and a separate
  migration/admin task role. IMPORTANT: the Postgres `service_role` (RLS
  BYPASS) is a DATABASE role provisioned by Wave-2 migrations — it is NOT one
  of these IAM roles. The app task role must not be able to surface tenant
  financial data outside the tenant-scoped application path (INV-TEN-3 narrative).

  Scenario: An ECS cluster and a Fargate task definition exist
    Given the compute stack
    When I inspect the template
    Then exactly one ECS cluster exists
    And at least one FARGATE-compatible task definition exists

  Scenario: Container logs go to an encrypted, retained CloudWatch log group
    Given the compute stack
    When I inspect the API log group
    Then a RetentionInDays is set explicitly
    And the log group is encrypted with a customer-managed KMS key

  Scenario: The execution role and app task role are distinct
    Given the compute stack
    When I inspect the task definition
    Then the ExecutionRoleArn and TaskRoleArn reference different roles

  Scenario: A separate migration/admin task role exists
    Given the security stack
    When I inspect the IAM roles
    Then a dedicated migration role exists, distinct from the app task role

  Scenario: The app task role cannot read the migration KMS/admin grants (INV-TEN-3)
    Given the security stack
    When I inspect the app task role policies
    Then it grants no wildcard "*" action over all resources
