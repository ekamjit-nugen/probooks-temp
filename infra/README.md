# @probooks/infra — AWS CDK (synth-validated only)

Phase-0 backend infrastructure for ProBooks, modelled as an **AWS CDK v2
(TypeScript)** app. Everything is pinned to **`ca-central-1`** (INV-AUDIT-5 /
PIPEDA) with **no cross-region replication anywhere**.

> **There is no live AWS account.** This package is **synth-validated only** —
> nothing deploys (see `docs/phase-0-plan.md` J.2). CI runs
> `pnpm --filter @probooks/infra synth` (job `infra-synth`). The account is left
> undefined; the **region** is the load-bearing residency control and is
> asserted by tests.

## Commands

```bash
pnpm --filter @probooks/infra synth      # cdk synth -> cdk.out/ (ca-central-1)
pnpm --filter @probooks/infra test       # Vitest + aws-cdk-lib/assertions
pnpm --filter @probooks/infra lint       # shared ESLint flat config
pnpm --filter @probooks/infra typecheck  # tsc --noEmit
pnpm --filter @probooks/infra build      # tsc --noEmit (no deploy artifact)
```

Run on Node 22 (`.nvmrc`).

## Stack map

A single CDK `App` (`bin/probooks-infra.ts`) wires five modular stacks, each
with `env: { region: 'ca-central-1' }`:

| Stack              | File                    | Models                                                                                                                                                                                                                                                             |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ProBooksSecurity` | `lib/security-stack.ts` | Customer-managed KMS keys (database, storage) with rotation; the **migration/admin** IAM task role.                                                                                                                                                                |
| `ProBooksNetwork`  | `lib/network-stack.ts`  | VPC — public / private-with-egress (app) / **isolated** (data) subnets; NAT egress; VPC flow logs (ALL).                                                                                                                                                           |
| `ProBooksData`     | `lib/data-stack.ts`     | RDS **Postgres 16, Multi-AZ**, CMK-encrypted, deletion-protected, PITR backups, Performance Insights, **not public**, isolated subnets, credentials from **Secrets Manager**. ElastiCache **Redis** (CMK at rest + in transit, isolated subnets, own rotated CMK). |
| `ProBooksStorage`  | `lib/storage-stack.ts`  | S3 documents bucket — **block all public access**, CMK default encryption, `enforceSSL`, versioned, **no cross-region replication**.                                                                                                                               |
| `ProBooksCompute`  | `lib/compute-stack.ts`  | ECS **Fargate** cluster + API task-definition skeleton; logs -> CMK-encrypted, retained CloudWatch group; **execution** + **app task** IAM roles (separate, least privilege); own rotated logs CMK.                                                                |

`lib/constants.ts` holds the region pin + retention windows.

### Why some KMS keys / IAM roles live with their consumer

CDK creates a CloudFormation dependency whenever a resource references a KMS key
or grants an IAM role across stacks. The CloudWatch **logs** key and **Redis**
key, and the ECS **execution / app** roles, are created in the stack that
consumes them (Compute / Data) so CDK's automatic grants stay intra-stack and no
cross-stack dependency cycle forms. They are equally customer-managed and
rotated; the tests assert rotation across **all** stacks. The cross-stack keys
that don't cycle (database, storage) stay in `ProBooksSecurity` and are imported
by ARN (`kms.Key.fromKeyArn`, immutable) by their consumers.

## IMPORTANT: Postgres `service_role` is NOT an IAM role

Do not conflate two different "service_role" concepts:

- The Postgres **`service_role`** (RLS **BYPASS**) is a **database** role created
  by the Wave-2 SQL migrations. It is what platform-operator/metadata and
  migration code connect as to bypass row-level security. It is enforced **in
  Postgres**, not in AWS IAM.
- The **`migrationRole`** here is an **IAM** task role — the identity the
  migration/admin ECS task assumes in order to _connect to the database_ (and
  there present the DB `service_role` credentials). The IAM role does not, by
  itself, bypass RLS.

The application **app task role** is deliberately separate from the migration
role and is granted nothing that could surface another tenant's financial data
outside the tenant-scoped application path; tenant isolation is enforced by the
application repositories + Postgres RLS (INV-TEN-1) and the operator/financial
grant separation (INV-TEN-3), not by IAM.

## Observability

Container logs flow to an encrypted, explicitly-retained CloudWatch log group.
**OpenTelemetry -> CloudWatch** is the target (STANDARDS §14); the OTel collector
sidecar is a documented placeholder here — wired when the API ships in Phase 1+.

## Tests (`test/`)

`aws-cdk-lib/assertions` `Template.fromStack(...)`. Each test cites the
invariant / STANDARDS section in its name. `test/helpers.ts` synthesizes the
whole App (the cross-cutting integration path), and `test/residency.spec.ts`
asserts region pinning + the absence of any cross-region replication anywhere.

## Invariants enforced

- **INV-AUDIT-5** — residency: every stack in `ca-central-1`; no cross-region
  S3 replication or RDS replica.
- **INV-AUDIT-4** — RDS storage encrypted with a customer-managed KMS key.
- **INV-TEN-3** — app task role ≠ migration role; no wildcard `*/*` grants.
- **INV-EXP-7** — documents bucket is private (signed-URL-only access is enforced
  at the app layer).

See `docs/runbooks/dr-backup-restore.md` (DR) and
`docs/security/phase-0-threat-model.md` (STRIDE / threat model).
