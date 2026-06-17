import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { CA_CENTRAL_1 } from "../lib/constants";

import { REGION, synthAllStacks, templateFor } from "./helpers";

/**
 * Cross-cutting residency assertions (INV-AUDIT-5 / PIPEDA). This is the
 * integration-style suite required once the App spans >1 stack: it synthesizes
 * the WHOLE App and asserts region pinning + the absence of any cross-region
 * replication anywhere.
 */
describe("Residency — everything in ca-central-1 [INV-AUDIT-5]", () => {
  it("pins every stack environment to ca-central-1 [INV-AUDIT-5]", () => {
    const stacks = synthAllStacks();

    for (const stack of [
      stacks.security,
      stacks.network,
      stacks.data,
      stacks.storage,
      stacks.compute,
    ]) {
      expect(stack.region).toBe(CA_CENTRAL_1);
      expect(REGION.region).toBe(CA_CENTRAL_1);
    }
  });

  it("declares no S3 cross-region replication anywhere [INV-AUDIT-5]", () => {
    const stacks = synthAllStacks();
    const template = templateFor(stacks.storage);

    const buckets = template.findResources("AWS::S3::Bucket");
    for (const bucket of Object.values(buckets)) {
      const props =
        (bucket as { Properties?: Record<string, unknown> }).Properties ?? {};
      expect(props).not.toHaveProperty("ReplicationConfiguration");
    }
  });

  it("provisions no cross-region RDS replica [INV-AUDIT-5]", () => {
    const stacks = synthAllStacks();
    const template = templateFor(stacks.data);

    const instances = template.findResources("AWS::RDS::DBInstance");
    for (const instance of Object.values(instances)) {
      const props =
        (instance as { Properties?: Record<string, unknown> }).Properties ?? {};
      expect(props).not.toHaveProperty("SourceRegion");
      expect(props).not.toHaveProperty("SourceDBInstanceIdentifier");
    }
  });

  it("references no region other than ca-central-1 in any synthesized template", () => {
    const stacks = synthAllStacks();

    for (const stack of [
      stacks.security,
      stacks.network,
      stacks.data,
      stacks.storage,
      stacks.compute,
    ]) {
      const json = JSON.stringify(Template.fromStack(stack).toJSON());
      // Any AWS region literal that is NOT ca-central-1 must not appear.
      const otherRegion =
        /(us|eu|ap|sa|af|me|ca)-(north|south|east|west|central|northeast|southeast)-\d/g;
      const matches = json.match(otherRegion) ?? [];
      for (const match of matches) {
        expect(match).toBe(CA_CENTRAL_1);
      }
    }
  });
});
