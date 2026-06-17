Feature: Document storage is private and encrypted (STANDARDS §18, INV-EXP-7)
  S3 holds client documents. The bucket blocks ALL public access, encrypts at
  rest with a customer-managed KMS key, enforces TLS, versions objects, and is
  never cross-region replicated. Signed-URL-only access is enforced at the app
  layer; the bucket itself is closed by default.

  Scenario: The documents bucket blocks all public access
    Given the storage stack
    When I inspect the documents bucket
    Then BlockPublicAcls, BlockPublicPolicy, IgnorePublicAcls, RestrictPublicBuckets are all true

  Scenario: The documents bucket is encrypted with a customer-managed KMS key [§18.1]
    Given the storage stack
    When I inspect the documents bucket
    Then default encryption uses aws:kms with a customer-managed key

  Scenario: The documents bucket enforces TLS and versioning
    Given the storage stack
    When I inspect the documents bucket and its policy
    Then versioning is enabled
    And a bucket policy denies non-TLS (aws:SecureTransport false) requests

  Scenario: KMS keys rotate automatically [§17]
    Given the security stack
    When I inspect every customer-managed KMS key
    Then EnableKeyRotation is true
