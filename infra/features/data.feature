Feature: The data tier is encrypted, durable, and private (STANDARDS §1.1, §8, §17, §18)
  Postgres holds tenant financial data; it must be Multi-AZ, encrypted with a
  customer-managed KMS key, protected from deletion, backed up for PITR, and
  unreachable from the public internet. Credentials never appear inline —
  they come from Secrets Manager. Redis (cache/queue) is encrypted in transit
  and at rest and lives in private subnets.

  Scenario: RDS Postgres is Multi-AZ for high availability
    Given the data stack
    When I inspect the database instance
    Then MultiAZ is true

  Scenario: RDS storage is encrypted with a customer-managed KMS key [INV-AUDIT-4]
    Given the data stack
    When I inspect the database instance
    Then StorageEncrypted is true
    And a KmsKeyId references a customer-managed key

  Scenario: RDS has deletion protection and PITR-enabling backups
    Given the data stack
    When I inspect the database instance
    Then DeletionProtection is true
    And BackupRetentionPeriod is at least 7 days

  Scenario: RDS is not publicly accessible and runs Postgres 16
    Given the data stack
    When I inspect the database instance
    Then PubliclyAccessible is false
    And the engine is postgres major version 16

  Scenario: RDS credentials come from Secrets Manager, never inline [§17]
    Given the data stack
    When I inspect the template
    Then a Secrets Manager secret is generated for the DB credentials
    And no plaintext master password literal appears in the template

  Scenario: Redis encrypts data at rest and in transit
    Given the data stack
    When I inspect the ElastiCache replication group
    Then AtRestEncryptionEnabled is true
    And TransitEncryptionEnabled is true
