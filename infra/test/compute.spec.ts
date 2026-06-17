import { Match } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { LOG_RETENTION_DAYS } from "../lib/constants";

import { synthAllStacks, templateFor } from "./helpers";

describe("ComputeStack — ECS Fargate skeleton [§13][§14]", () => {
  it("creates exactly one ECS cluster", () => {
    const { compute } = synthAllStacks();
    templateFor(compute).resourceCountIs("AWS::ECS::Cluster", 1);
  });

  it("defines a FARGATE-compatible task definition", () => {
    const { compute } = synthAllStacks();
    templateFor(compute).hasResourceProperties("AWS::ECS::TaskDefinition", {
      RequiresCompatibilities: Match.arrayWith(["FARGATE"]),
    });
  });

  it("ships container logs to a CMK-encrypted, explicitly-retained log group [§14]", () => {
    const { compute } = synthAllStacks();
    templateFor(compute).hasResourceProperties("AWS::Logs::LogGroup", {
      RetentionInDays: LOG_RETENTION_DAYS,
      KmsKeyId: Match.anyValue(),
    });
  });

  it("uses distinct execution and task roles (least privilege) [INV-TEN-3]", () => {
    const { compute } = synthAllStacks();
    const template = templateFor(compute);

    const taskDefs = template.findResources("AWS::ECS::TaskDefinition");
    const def = Object.values(taskDefs)[0] as {
      Properties?: { ExecutionRoleArn?: unknown; TaskRoleArn?: unknown };
    };
    const execArn = JSON.stringify(def.Properties?.ExecutionRoleArn);
    const taskArn = JSON.stringify(def.Properties?.TaskRoleArn);

    expect(execArn).toBeTruthy();
    expect(taskArn).toBeTruthy();
    expect(execArn).not.toBe(taskArn);
  });
});
