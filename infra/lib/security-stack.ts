import { Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import { type Construct } from "constructs";

/**
 * SecurityStack — customer-managed KMS keys + IAM task roles (STANDARDS §17, §18, §9.6).
 *
 * Owns the cryptographic + identity primitives the other stacks consume:
 *
 *  - Customer-managed KMS keys for the cross-stack data domains (DB, S3), each
 *    with automatic rotation enabled (STANDARDS §17). Separate keys keep the
 *    blast radius small and let grants be scoped per resource. The CloudWatch
 *    logs key and the Redis key are created in the stack that consumes them
 *    (ComputeStack / DataStack) to avoid cross-stack key-policy cycles — they
 *    are equally customer-managed and rotated. See infra/README.md.
 *
 *  - Three IAM roles modelling least privilege (STANDARDS §9.6, INV-TEN-3):
 *      * executionRole  — ECS agent pulls images + writes the bootstrap logs.
 *      * appTaskRole    — the running API. Tenant-scoped data access only; it
 *                         is granted NOTHING here that could surface another
 *                         tenant's financial rows. Resource grants are attached
 *                         narrowly by the owning stacks (e.g. S3 read/write on
 *                         the documents bucket).
 *      * migrationRole  — a SEPARATE migration/admin task role for running
 *                         Prisma migrations. It maps to the OPERATIONAL use of
 *                         the Postgres `service_role`.
 *
 * IMPORTANT (do not conflate): the Postgres `service_role` (RLS BYPASS) is a
 * *database* role created by the Wave-2 SQL migrations — it is NOT an IAM role.
 * `migrationRole` is the IAM identity that the migration task assumes in order
 * to *connect* as the DB `service_role`; the RLS-bypass itself is enforced in
 * Postgres, not IAM. See infra/README.md.
 */
export class SecurityStack extends Stack {
  public readonly databaseKey: kms.Key;
  public readonly storageKey: kms.Key;

  /**
   * Separate migration/admin task role. The ECS execution + app task roles are
   * created in ComputeStack (co-located with the cluster/log group they are
   * attached to, which avoids cross-stack IAM dependency cycles). This role is
   * the migration/admin identity and is intentionally modelled apart from the
   * app role — see the class doc above and infra/README.md.
   */
  public readonly migrationRole: iam.Role;

  public constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.databaseKey = new kms.Key(this, "DatabaseKey", {
      description: "ProBooks RDS Postgres encryption (CMK, rotated)",
      enableKeyRotation: true,
      alias: "alias/probooks/database",
    });

    this.storageKey = new kms.Key(this, "StorageKey", {
      description: "ProBooks S3 document encryption (CMK, rotated)",
      enableKeyRotation: true,
      alias: "alias/probooks/storage",
    });

    // Separate migration/admin task role. Distinct identity for running Prisma
    // migrations as the Postgres `service_role`. Kept apart from the app role so
    // the RLS-bypass connection path is auditable and not reachable by the API.
    this.migrationRole = new iam.Role(this, "MigrationTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description:
        "Migration/admin task role (DB service_role connection; NOT the DB role itself)",
    });
  }
}
