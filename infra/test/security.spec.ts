import { Match } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { synthAllStacks, templateFor } from "./helpers";

describe("KMS — customer-managed keys rotate [§17]", () => {
  it("rotates every customer-managed KMS key automatically, across all stacks [§17]", () => {
    const stacks = synthAllStacks();

    // CMKs live in the stack that consumes them: DB + storage in Security,
    // logs in Compute, Redis in Data. Every one must have rotation enabled.
    const keyOwningStacks = [stacks.security, stacks.data, stacks.compute];
    let totalKeys = 0;

    for (const stack of keyOwningStacks) {
      const keys = templateFor(stack).findResources("AWS::KMS::Key");
      for (const key of Object.values(keys)) {
        const props =
          (key as { Properties?: { EnableKeyRotation?: boolean } })
            .Properties ?? {};
        expect(props.EnableKeyRotation).toBe(true);
        totalKeys += 1;
      }
    }

    // 4 CMKs total: database, storage, logs, redis.
    expect(totalKeys).toBe(4);
  });
});

describe("IAM least privilege [§9.6][INV-TEN-3]", () => {
  it("models execution, app, and migration as three distinct roles [§9.6]", () => {
    const stacks = synthAllStacks();

    // Execution + app roles are co-located with the cluster in ComputeStack;
    // the separate migration/admin role lives in SecurityStack.
    templateFor(stacks.compute).hasResourceProperties("AWS::IAM::Role", {
      Description: Match.stringLikeRegexp("execution role"),
    });
    templateFor(stacks.compute).hasResourceProperties("AWS::IAM::Role", {
      Description: Match.stringLikeRegexp("application task role"),
    });
    templateFor(stacks.security).hasResourceProperties("AWS::IAM::Role", {
      Description: Match.stringLikeRegexp("Migration/admin task role"),
    });
  });

  it("grants NO wildcard '*' action over all resources in any role policy [INV-TEN-3]", () => {
    const stacks = synthAllStacks();

    for (const stack of [stacks.security, stacks.compute]) {
      const policies = templateFor(stack).findResources("AWS::IAM::Policy");
      for (const policy of Object.values(policies)) {
        const doc =
          (
            policy as {
              Properties?: { PolicyDocument?: { Statement?: unknown[] } };
            }
          ).Properties?.PolicyDocument ?? {};
        const statements = (doc.Statement ?? []) as {
          Action?: unknown;
          Resource?: unknown;
        }[];
        for (const stmt of statements) {
          const isWildcardAction = stmt.Action === "*";
          const isWildcardResource = stmt.Resource === "*";
          expect(isWildcardAction && isWildcardResource).toBe(false);
        }
      }
    }
  });

  it("keeps the migration/admin role separate from the app task role [§9.6]", () => {
    const stacks = synthAllStacks();

    // The migration role must NOT be the app role: different stacks, different
    // descriptions. This is the INV-TEN-3 separation at the IAM-narrative level.
    templateFor(stacks.security).resourceCountIs("AWS::IAM::Role", 1);
    templateFor(stacks.compute).resourceCountIs("AWS::IAM::Role", 2);
  });
});
