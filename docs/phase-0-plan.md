# Phase 0 — Backend Spine: Implementation Plan

> Status: APPROVED 2026-06-04. Source of truth for the Phase 0 build.
> Constraints: STANDARDS.md (all), CLAUDE.md §5 hard rules, SPEC.md invariants, PRD §5 Phase 0.
> Methodology: Trunks Modular TDD — Gherkin `.feature` → failing tests → code, maximal modules, integration tests once >1 module. UI tests N/A this phase (backend-only); backend tests mandatory.

## Decisions carried in (PROGRESS §5)

1. `client_staff` sub-role in schema/RBAC from day one (Phase 14 UI deferred).
2. Line sub-labels default off for clients (config; no Phase 0 impact).
3. Scorecard partner-only default (no Phase 0 impact).
4. Default `ca-central-1`, modeled as per-tenant region pin on `tenants`.
5. Multi-tenant spine from day one — never stripped. **Shapes this phase.**
6. AI takeover = manual accountant action; schema allows future auto (no Phase 0 impact).

## Resolved open questions

- J.1 — Internal JWT issuer behind an interface now; provider (Auth0 vs Cognito) decided in ADR-0002 at Phase 1.
- J.2 — CDK authored + `cdk synth`-validated in CI only; no live AWS deploy until the account is provisioned.

## Invariant reconciliation (SPEC canonical; see ADR-0001)

| PRD label                | Canonical                |
| ------------------------ | ------------------------ |
| INV-TENANT-1             | INV-TEN-1                |
| INV-TENANT-2             | INV-TEN-1 (RLS backstop) |
| INV-RBAC-1               | INV-RBAC-1               |
| INV-AUDIT-1 / IMMUT      | INV-AUDIT-1, INV-AUDIT-2 |
| INV-RES-CA               | INV-AUDIT-5              |
| INV-AUTH-1               | INV-AUTH-1, INV-AUTH-4   |
| INV-IDEMPOTENCY-1        | STD-7.4 (STANDARDS §7.4) |
| INV-OPERATOR-NO-FIN-DATA | INV-TEN-3                |

## Monorepo scaffold (Phase 0 subset; FE apps + ui + api-client deferred to Phase 1+)

```
probooks/
├── apps/api/
├── packages/{shared,config,test-utils}/
├── infra/
├── docs/{adr,runbooks,security}/
├── .github/workflows/
└── turbo.json · pnpm-workspace.yaml · package.json · .nvmrc
```

## Module decomposition (15 backend + 5 shared)

Backend (`apps/api/src`): config-env, errors, validation, logging, prisma, tenant-context, rls,
auth, rbac, tenancy-guard, audit, idempotency, observability, health (+financial stub), platform-repo.
Shared (`packages/shared`): branded-ids, inv-registry, auth/permissions (RBAC matrix §4.17),
response-envelope+zod-base, jobs/idempotency (+money/time stubs).

## Data model (Prisma; all tenant-scoped tables get RLS)

- tenants (region pin default ca-central-1; status FSM none→provisioned→active→suspended→deleted; plan ref)
- users (tenant_id, role, sub_role incl. client_staff, client_id?, idp link)
- clients (tenant_id) — minimal, for FK + RLS demonstration
- audit_log (append-only; prev_hash, entry_hash; who/what/when/before→after)
- idempotency_keys (tenant_id, key, response_hash, expires_at)
- refresh_tokens (jti, rotation lineage, revoked_at)

## Test obligations (8, adapted; #7 a11y N/A, #6 E2E = auth-per-role)

1 unit/method · 2 integration/route · 3 cross-tenant→404 + RLS zero-rows · 4 RBAC matrix 5 roles ·
5 invariant tests (cite codes) · 6 E2E auth per role · 8 perf smoke (auth p95<200ms, audit write<5ms, RLS<10%).

## Integration tests (Principle 5)

- auth → tenant-context → prisma → rls (defense-in-depth: RLS blocks even with app filter removed)
- audit ↔ every state transition (atomic; tamper → hash-chain verifier fails)
- idempotency ↔ mutations (same key+body cached; key+different body → 409)
- operator → financial-stub (403 at guard AND zero rows at RLS — INV-TEN-3)
- refresh rotation (old token replay → 401)

## Infrastructure (CDK, synth-validated only)

VPC · RDS PG16 Multi-AZ · ElastiCache Redis · S3+KMS · ECS Fargate skeleton · Secrets Manager ·
IAM (incl service_role) · OTel/CloudWatch — all ca-central-1. DR backup/restore runbook.
Security: docs/security/phase-0-threat-model.md (STRIDE + cross-tenant probe + IDOR + rate-limit + JWT/audit tamper).

## Build sequence (TDD waves — tests RED before code)

0 scaffold+config+CI · 1 config-env/errors/validation/logging · 2 prisma/tenant-context/rls/model ·
3 auth/rbac/guards · 4 audit · 5 idempotency · 6 observability/health/platform-repo ·
7 infra+DR+security review · 8 cross-module integration suite → exit checklist → PR.

## Exit gate (PRD §5 Phase 0)

All 9 exit checkboxes + security review pass + PR template + demo to user → PROGRESS DONE. No silent advance.
