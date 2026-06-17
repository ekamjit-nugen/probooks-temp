import { App, type Environment } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { ComputeStack } from "../lib/compute-stack";
import { CA_CENTRAL_1 } from "../lib/constants";
import { DataStack } from "../lib/data-stack";
import { NetworkStack } from "../lib/network-stack";
import { SecurityStack } from "../lib/security-stack";
import { StorageStack } from "../lib/storage-stack";

/** The region every stack must pin to (INV-AUDIT-5 / PIPEDA). */
export const REGION: Environment = { region: CA_CENTRAL_1 };

export interface SynthedStacks {
  readonly app: App;
  readonly security: SecurityStack;
  readonly network: NetworkStack;
  readonly data: DataStack;
  readonly storage: StorageStack;
  readonly compute: ComputeStack;
}

/**
 * Builds the full Phase-0 App the way `bin/probooks-infra.ts` does, so tests
 * exercise the real wiring (cross-cutting integration — STANDARDS §19 / plan
 * Principle 5). Returns the stacks plus a Template-per-stack accessor.
 */
export function synthAllStacks(): SynthedStacks {
  const app = new App();

  const security = new SecurityStack(app, "ProBooksSecurity", { env: REGION });
  const network = new NetworkStack(app, "ProBooksNetwork", { env: REGION });
  const data = new DataStack(app, "ProBooksData", {
    env: REGION,
    vpc: network.vpc,
    databaseKeyArn: security.databaseKey.keyArn,
  });
  const storage = new StorageStack(app, "ProBooksStorage", {
    env: REGION,
    storageKeyArn: security.storageKey.keyArn,
  });
  const compute = new ComputeStack(app, "ProBooksCompute", {
    env: REGION,
    vpc: network.vpc,
  });

  return { app, security, network, data, storage, compute };
}

/** Convenience: a CloudFormation Template for one stack. */
export function templateFor(
  stack: Parameters<typeof Template.fromStack>[0],
): Template {
  return Template.fromStack(stack);
}
