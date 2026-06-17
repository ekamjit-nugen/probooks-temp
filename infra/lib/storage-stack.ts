import { Stack, type StackProps } from "aws-cdk-lib";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import { type Construct } from "constructs";

export interface StorageStackProps extends StackProps {
  /** Imported by ARN to avoid cross-stack key-policy mutation (see DataStack). */
  readonly storageKeyArn: string;
}

/**
 * StorageStack — the document bucket (STANDARDS §18, INV-EXP-7, INV-AUDIT-5).
 *
 *  - blockPublicAccess: BLOCK_ALL — closed to the public internet entirely.
 *  - encryption: KMS with a customer-managed key (default at-rest encryption).
 *  - enforceSSL: true — a bucket policy denies any non-TLS request.
 *  - versioned: true — object history is retained (no destructive overwrite).
 *  - NO cross-region replication — residency is pinned to ca-central-1
 *    (INV-AUDIT-5 / PIPEDA). Replication is deliberately not configured.
 *
 * Signed-URL-only access (5-min expiry, no raw object keys in URLs — INV-EXP-7)
 * is enforced at the application layer; the bucket itself is private by default.
 */
export class StorageStack extends Stack {
  public readonly documentsBucket: s3.Bucket;

  public constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const storageKey = kms.Key.fromKeyArn(
      this,
      "ImportedStorageKey",
      props.storageKeyArn,
    );

    this.documentsBucket = new s3.Bucket(this, "DocumentsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: storageKey,
      bucketKeyEnabled: true,
      enforceSSL: true,
      versioned: true,
      // No `replicationRules` / `ReplicationConfiguration` — cross-region copy
      // is forbidden by PIPEDA residency (INV-AUDIT-5).
    });
  }
}
