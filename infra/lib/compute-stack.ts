import { Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import { type Construct } from "constructs";

import { LOG_RETENTION_DAYS } from "./constants";

export interface ComputeStackProps extends StackProps {
  readonly vpc: ec2.IVpc;
}

/**
 * ComputeStack — ECS Fargate skeleton for the API (STANDARDS §13, §14).
 *
 *  - One ECS cluster in the VPC.
 *  - A Fargate task definition placeholder for the API service. No real image
 *    is required at synth time — a public skeleton image stands in.
 *  - Container logs -> an encrypted, explicitly-retained CloudWatch log group
 *    (OTel -> CloudWatch is the target; STANDARDS §14). The OTel collector
 *    sidecar is a documented placeholder (see infra/README.md).
 *  - Execution role (image pull + log shipping) and app task role (runtime,
 *    tenant-scoped) are SEPARATE identities (least privilege; INV-TEN-3).
 */
export class ComputeStack extends Stack {
  public readonly cluster: ecs.Cluster;
  public readonly apiTaskDefinition: ecs.FargateTaskDefinition;
  public readonly apiLogGroup: logs.LogGroup;
  public readonly logsKey: kms.Key;
  public readonly executionRole: iam.Role;
  public readonly appTaskRole: iam.Role;

  public constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    this.cluster = new ecs.Cluster(this, "Cluster", {
      vpc: props.vpc,
    });

    // Logs CMK is created in this stack (its only consumer) — rotated, like all
    // ProBooks CMKs. Same-stack key + log group lets CDK wire the CloudWatch
    // grant without a cross-stack dependency cycle.
    this.logsKey = new kms.Key(this, "LogsKey", {
      description: "ProBooks CloudWatch logs encryption (CMK, rotated)",
      enableKeyRotation: true,
      alias: "alias/probooks/logs",
    });

    this.apiLogGroup = new logs.LogGroup(this, "ApiLogGroup", {
      retention: LOG_RETENTION_DAYS,
      encryptionKey: this.logsKey,
    });

    // ECS agent: pull images + ship logs. AWS-managed policy is the documented
    // least-privilege baseline for the execution role. Co-located with the
    // cluster/log group it serves so CDK's grants stay intra-stack.
    this.executionRole = new iam.Role(this, "EcsExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "ECS task execution role (image pull + log shipping)",
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy",
        ),
      ],
    });

    // Application task role: deny-by-default, SEPARATE from the execution role
    // (least privilege; INV-TEN-3). No broad grants are attached — resource
    // access is added narrowly (e.g. S3 read/write on the documents bucket).
    // It never receives any grant that could surface another tenant's financial
    // data; financial access is mediated by the tenant-scoped application path +
    // Postgres RLS, not by this IAM role.
    this.appTaskRole = new iam.Role(this, "AppTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "API application task role (tenant-scoped; least privilege)",
    });

    this.apiTaskDefinition = new ecs.FargateTaskDefinition(this, "ApiTaskDef", {
      cpu: 512,
      memoryLimitMiB: 1024,
      executionRole: this.executionRole,
      taskRole: this.appTaskRole,
    });

    // Skeleton container — placeholder image; the real image is published by the
    // app's build pipeline. Logs are routed to the encrypted CloudWatch group.
    this.apiTaskDefinition.addContainer("Api", {
      image: ecs.ContainerImage.fromRegistry(
        "public.ecr.aws/docker/library/node:22-slim",
      ),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "api",
        logGroup: this.apiLogGroup,
      }),
    });
  }
}
