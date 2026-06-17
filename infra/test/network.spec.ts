import { Match } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { synthAllStacks, templateFor } from "./helpers";

describe("NetworkStack — data-tier isolation [§18]", () => {
  it("creates isolated subnets for the data tier and egress subnets for the app tier [§18]", () => {
    const { network } = synthAllStacks();
    const template = templateFor(network);

    const subnets = template.findResources("AWS::EC2::Subnet");
    const names = Object.values(subnets).flatMap((s) => {
      const tags =
        (s as { Properties?: { Tags?: { Key: string; Value: string }[] } })
          .Properties?.Tags ?? [];
      return tags
        .filter((t) => t.Key === "aws-cdk:subnet-name")
        .map((t) => t.Value);
    });

    expect(names).toContain("data");
    expect(names).toContain("app");
    expect(names).toContain("public");
  });

  it("provisions a NAT gateway for controlled egress [§18]", () => {
    const { network } = synthAllStacks();
    templateFor(network).resourceCountIs("AWS::EC2::NatGateway", 1);
  });

  it("enables VPC flow logs capturing ALL traffic [§18]", () => {
    const { network } = synthAllStacks();
    const template = templateFor(network);

    template.resourceCountIs("AWS::EC2::FlowLog", 1);
    template.hasResourceProperties("AWS::EC2::FlowLog", {
      TrafficType: "ALL",
      ResourceType: "VPC",
    });
  });

  it("does not place the data tier subnets on a public route [§18]", () => {
    const { network } = synthAllStacks();
    const template = templateFor(network);

    // Isolated subnets must not have a route to an internet gateway. We assert
    // there is no route with a GatewayId targeting the IGW from a data route
    // table — proxied by counting public routes (one per public subnet AZ).
    const igwRoutes = template.findResources("AWS::EC2::Route", {
      Properties: Match.objectLike({ GatewayId: Match.anyValue() }),
    });
    // 2 AZs -> 2 public default routes; data subnets contribute none.
    expect(Object.keys(igwRoutes).length).toBe(2);
  });
});
