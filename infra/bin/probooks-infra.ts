import { App, type Environment } from "aws-cdk-lib";

import { ComputeStack } from "../lib/compute-stack";
import { CA_CENTRAL_1 } from "../lib/constants";
import { DataStack } from "../lib/data-stack";
import { NetworkStack } from "../lib/network-stack";
import { SecurityStack } from "../lib/security-stack";
import { StorageStack } from "../lib/storage-stack";

/**
 * ProBooks Phase-0 infrastructure App (CDK v2, synth-validated only).
 *
 * Every stack is pinned to ca-central-1 (INV-AUDIT-5 / PIPEDA). There is no
 * live AWS account; `cdk synth` is the only thing run (CI job `infra-synth`).
 * The account is left undefined so synth is account-agnostic; the region is
 * the load-bearing residency control and is asserted in tests.
 */
const env: Environment = { region: CA_CENTRAL_1 };

export const app = new App();

const security = new SecurityStack(app, "ProBooksSecurity", { env });

const network = new NetworkStack(app, "ProBooksNetwork", { env });

new DataStack(app, "ProBooksData", {
  env,
  vpc: network.vpc,
  databaseKeyArn: security.databaseKey.keyArn,
});

new StorageStack(app, "ProBooksStorage", {
  env,
  storageKeyArn: security.storageKey.keyArn,
});

new ComputeStack(app, "ProBooksCompute", {
  env,
  vpc: network.vpc,
});

app.synth();
