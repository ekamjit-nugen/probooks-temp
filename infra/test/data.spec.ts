import { Match } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { DB_BACKUP_RETENTION_DAYS } from "../lib/constants";

import { synthAllStacks, templateFor } from "./helpers";

describe("DataStack — RDS Postgres [§1.1][§8][§17][§18][INV-AUDIT-4]", () => {
  it("is Multi-AZ for high availability [§18]", () => {
    const { data } = synthAllStacks();
    templateFor(data).hasResourceProperties("AWS::RDS::DBInstance", {
      MultiAZ: true,
    });
  });

  it("encrypts storage with a customer-managed KMS key [INV-AUDIT-4][§18.1]", () => {
    const { data } = synthAllStacks();
    templateFor(data).hasResourceProperties("AWS::RDS::DBInstance", {
      StorageEncrypted: true,
      KmsKeyId: Match.anyValue(),
    });
  });

  it("has deletion protection and a PITR-enabling backup window [§8]", () => {
    const { data } = synthAllStacks();
    templateFor(data).hasResourceProperties("AWS::RDS::DBInstance", {
      DeletionProtection: true,
      BackupRetentionPeriod: DB_BACKUP_RETENTION_DAYS,
    });
    expect(DB_BACKUP_RETENTION_DAYS).toBeGreaterThanOrEqual(7);
  });

  it("is not publicly accessible and runs Postgres 16 [§18]", () => {
    const { data } = synthAllStacks();
    templateFor(data).hasResourceProperties("AWS::RDS::DBInstance", {
      PubliclyAccessible: false,
      Engine: "postgres",
      EngineVersion: Match.stringLikeRegexp("^16"),
    });
  });

  it("enables Performance Insights with a CMK [§18.1]", () => {
    const { data } = synthAllStacks();
    templateFor(data).hasResourceProperties("AWS::RDS::DBInstance", {
      EnablePerformanceInsights: true,
      PerformanceInsightsKMSKeyId: Match.anyValue(),
    });
  });

  it("sources DB credentials from Secrets Manager — never inline [§17]", () => {
    const { data } = synthAllStacks();
    const template = templateFor(data);

    // A generated secret exists for the DB credentials.
    template.resourceCountIs("AWS::SecretsManager::Secret", 1);

    // The master password is a DYNAMIC Secrets Manager reference
    // ({{resolve:secretsmanager:...}}), never a plaintext literal in the
    // template. CDK emits this as an Fn::Join that splices the secret ARN.
    const instances = template.findResources("AWS::RDS::DBInstance");
    const instance = Object.values(instances)[0] as {
      Properties?: { MasterUserPassword?: unknown };
    };
    const password = JSON.stringify(instance.Properties?.MasterUserPassword);
    expect(password).toContain("resolve:secretsmanager");

    // No plaintext password literal (a bare string) anywhere in the template.
    const json = JSON.stringify(template.toJSON());
    expect(json).not.toMatch(/"MasterUserPassword"\s*:\s*"(?!\{\{resolve)/);
  });
});

describe("DataStack — Redis [§15][§18]", () => {
  it("encrypts at rest AND in transit [§18.1]", () => {
    const { data } = synthAllStacks();
    templateFor(data).hasResourceProperties(
      "AWS::ElastiCache::ReplicationGroup",
      {
        AtRestEncryptionEnabled: true,
        TransitEncryptionEnabled: true,
        KmsKeyId: Match.anyValue(),
      },
    );
  });

  it("lives in a dedicated isolated subnet group [§18]", () => {
    const { data } = synthAllStacks();
    templateFor(data).resourceCountIs("AWS::ElastiCache::SubnetGroup", 1);
  });
});
