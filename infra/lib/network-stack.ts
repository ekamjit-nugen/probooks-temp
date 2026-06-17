import { Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { type Construct } from "constructs";

/**
 * NetworkStack — the VPC that isolates the data tier (STANDARDS §18).
 *
 * Three subnet tiers:
 *  - PUBLIC              — ALB / NAT only; nothing stateful.
 *  - PRIVATE_WITH_EGRESS — the ECS application tier; outbound via NAT.
 *  - PRIVATE_ISOLATED    — RDS + ElastiCache; NO route to the internet.
 *
 * VPC flow logs (ALL traffic) are enabled for forensic audit. The data tier
 * lives only in isolated subnets, so RDS/Redis can never be publicly reachable.
 */
export class NetworkStack extends Stack {
  public readonly vpc: ec2.Vpc;

  public constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "app",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 22,
        },
        {
          name: "data",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
      // Forensic audit trail of all VPC traffic (STANDARDS §18 / §18.3 spirit).
      flowLogs: {
        all: {
          trafficType: ec2.FlowLogTrafficType.ALL,
        },
      },
    });
  }
}
