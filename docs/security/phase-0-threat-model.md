# Phase 0 — Threat model & security review

> **Scope:** the Phase-0 backend spine (Waves 0–6) + the synth-only
> infrastructure (Wave 7, `infra/`). No user-facing surface ships in Phase 0;
> this review covers the tenancy/RBAC/audit/idempotency spine, the auth token
> layer, and the modelled AWS infrastructure. Method per STANDARDS §18.5:
> STRIDE pass + cross-tenant probe + IDOR + rate-limit + JWT/audit tamper.

## 1. Assets & trust boundaries

| Asset                                                         | Sensitivity      | Boundary                                           |
| ------------------------------------------------------------- | ---------------- | -------------------------------------------------- |
| Tenant financial data (`period_summaries`, future flags/docs) | High (PIPEDA)    | DB RLS + app repositories                          |
| Tenant metadata (status/plan/region/user count)               | Medium           | `PlatformRepository` (service_role, metadata only) |
| Audit log (hash-chained)                                      | High (integrity) | append-only DB role grants                         |
| Access / refresh tokens                                       | High             | HS256 signer (ADR-0005), Secrets Manager secret    |
| DB credentials, KMS keys                                      | Critical         | Secrets Manager + customer-managed KMS             |
| Documents (S3)                                                | High             | private bucket + signed-URL app layer              |

Boundaries: client/firm/operator → API (authn/authz) → repositories
(tenant-scoped) → Postgres (**RLS backstop**). Migration/operator paths use the
DB `service_role`; everything else uses `app_user`.

## 2. STRIDE

| Threat                     | Vector                            | Mitigation (where)                                                                                                         | Status      |
| -------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **S**poofing               | Forged JWT / wrong issuer         | HS256 verify, `typ`/`iss`/`aud`/`exp` checked, constant-time compare (ADR-0005, Wave 3)                                    | ✅          |
| **S**poofing               | Body-supplied `tenantId`          | Principal is server-derived from the **verified** token; body `tenantId` ignored (Wave 3 guard-stack test)                 | ✅          |
| **T**ampering              | Mutating/deleting audit rows      | `audit_log` grants: app_user + service_role have **no** UPDATE/DELETE; hash chain detects reorder/mutate (Wave 4)          | ✅          |
| **T**ampering              | Replaying a rotated refresh token | Rotation lineage; replay → 401 + revoke lineage (Wave 3)                                                                   | ✅          |
| **R**epudiation            | "I didn't do that"                | Append-only audit attributes who/what/when, hash-chained (Wave 4, INV-AUDIT-1/2)                                           | ✅          |
| **I**nformation disclosure | Cross-tenant read                 | App filter (`tenantId` in every where) **+** RLS ENABLE+FORCE fail-closed; proven 0 rows even with filter removed (Wave 2) | ✅          |
| **I**nformation disclosure | Operator reads financial data     | `service_role` has **no grant** on `period_summaries`; operator → 403 at RoleGuard (Wave 6, INV-TEN-3)                     | ✅          |
| **I**nformation disclosure | Data leaving region               | All infra pinned `ca-central-1`; no cross-region replication; asserted in `infra/test/residency.spec.ts` (INV-AUDIT-5)     | ✅          |
| **I**nformation disclosure | Secrets in code/logs              | Secrets Manager only; Pino PII redaction; gitleaks in CI (§13/§17)                                                         | ✅          |
| **D**enial of service      | Endpoint flooding                 | Rate-limit policy defined (§18.1); enforcement lands with HTTP routes (Phase 1)                                            | ⚠️ deferred |
| **E**levation of privilege | Role escalation                   | Deny-by-default RoleGuard; RBAC matrix proven cell-by-cell (Wave 3, INV-RBAC-1)                                            | ✅          |
| **E**levation of privilege | IAM wildcard grant                | No role policy grants `*` action over `*` resources; asserted in `infra/test/security.spec.ts` (INV-TEN-3)                 | ✅          |

## 3. Targeted checks (STANDARDS §18.5)

- **Cross-tenant probe → 404, not 403.** TenantGuard returns 404 on tenant
  mismatch (Wave 3, §9.4); does not leak existence. ✅
- **RLS zero-rows backstop.** With the app-layer `tenantId` filter removed, a
  non-superuser `app_user` still reads 0 cross-tenant rows (Wave 2). ✅
- **IDOR.** ResourceGuard scopes a `client_*` principal to its own client;
  repositories never accept `tenantId` as a parameter (context only, §9.3). ✅
- **Idempotency abuse.** Same key + different body → 409; replay runs the
  handler at most once (Layer-3 unique index serialises, Wave 5). ✅
- **JWT tamper.** Tampered signature/claims/`typ`/`exp` all reject (ADR-0005). ✅
- **Audit tamper.** Mutating/deleting/reordering rows fails the chain verifier
  at the exact position (Wave 4). ✅

## 4. Infrastructure-specific findings (Wave 7, synth-validated)

- Data tier (RDS, Redis) in **isolated** subnets, **not publicly accessible**;
  app tier egresses via NAT; VPC flow logs ALL. ✅
- RDS Multi-AZ, CMK `StorageEncrypted`, deletion protection, 14-day PITR
  backups, Performance Insights; credentials from Secrets Manager (no inline
  password — dynamic `{{resolve:secretsmanager:...}}`). ✅
- Redis encrypted at rest (CMK) **and** in transit. ✅
- S3 documents bucket blocks **all** public access, CMK default encryption,
  `enforceSSL` (TLS-deny policy), versioned, **no cross-region replication**. ✅
- KMS customer-managed keys with **rotation** on (asserted across all stacks). ✅
- ECS execution role ≠ app task role; separate migration/admin role; no
  wildcard grants (INV-TEN-3). ✅

## 5. Residual risks / deferred (tracked, not blocking Phase 0)

| Item                       | Why deferred                   | Lands in                 |
| -------------------------- | ------------------------------ | ------------------------ |
| Rate-limit **enforcement** | No HTTP routes ship in Phase 0 | Phase 1                  |
| WAF / CSP / HSTS headers   | Web surfaces start Phase 1     | Phase 1                  |
| ClamAV upload scanning     | Upload pipeline                | Phase 10                 |
| OTel collector wiring      | No live backend yet            | Phase 1+                 |
| Live AWS account / deploy  | Synth-only (J.2)               | when account provisioned |

## 6. Verdict

No P0/P1 issues in the Phase-0 scope. The deferred items are sequenced to the
phase that introduces their attack surface and are not reachable in Phase 0
(backend spine, no user-facing platform). Cross-tenant isolation (INV-TEN-1/2/3),
audit integrity (INV-AUDIT-1/2/3), and residency (INV-AUDIT-5) are enforced and
test-proven. **Security review: PASS for Phase 0.**
