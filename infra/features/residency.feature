Feature: Data residency is pinned to ca-central-1 (INV-AUDIT-5 / PIPEDA)
  Every ProBooks stack and every stateful resource lives in the Canadian
  region. There is no live AWS account; this is synth-validated only. No
  resource may be replicated or copied to another region — residency is a
  hard PIPEDA requirement, not a preference.

  Scenario: Every stack is synthesized for the ca-central-1 region
    Given the ProBooks infrastructure App
    When each stack is synthesized
    Then the resolved environment region is "ca-central-1"
    And no stack declares any other region

  Scenario: S3 buckets have no cross-region replication
    Given the storage stack
    When I inspect every S3 bucket
    Then none declares a ReplicationConfiguration
    And no replication destination points outside ca-central-1

  Scenario: RDS does not provision a cross-region read replica
    Given the data stack
    When I inspect the database
    Then it has no cross-region replica or source region
