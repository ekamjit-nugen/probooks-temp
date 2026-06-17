import { Match } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { synthAllStacks, templateFor } from "./helpers";

describe("StorageStack — documents bucket [§18][INV-EXP-7][INV-AUDIT-5]", () => {
  it("blocks ALL public access [§18]", () => {
    const { storage } = synthAllStacks();
    templateFor(storage).hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it("encrypts with a customer-managed KMS key [§18.1]", () => {
    const { storage } = synthAllStacks();
    templateFor(storage).hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({
            ServerSideEncryptionByDefault: Match.objectLike({
              SSEAlgorithm: "aws:kms",
              KMSMasterKeyID: Match.anyValue(),
            }),
          }),
        ]),
      },
    });
  });

  it("enables versioning [§18]", () => {
    const { storage } = synthAllStacks();
    templateFor(storage).hasResourceProperties("AWS::S3::Bucket", {
      VersioningConfiguration: { Status: "Enabled" },
    });
  });

  it("denies non-TLS (insecure) requests via bucket policy [§18.1]", () => {
    const { storage } = synthAllStacks();
    templateFor(storage).hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Deny",
            Condition: Match.objectLike({
              Bool: { "aws:SecureTransport": "false" },
            }),
          }),
        ]),
      }),
    });
  });

  it("declares no cross-region replication [INV-AUDIT-5]", () => {
    const { storage } = synthAllStacks();
    const buckets = templateFor(storage).findResources("AWS::S3::Bucket");
    for (const bucket of Object.values(buckets)) {
      const props =
        (bucket as { Properties?: Record<string, unknown> }).Properties ?? {};
      expect(props).not.toHaveProperty("ReplicationConfiguration");
    }
  });
});
