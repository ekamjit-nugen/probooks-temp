# Phase 0 — Backend Spine: Exit Checklist

> **Purpose:** Evidence map for the Phase-0 exit gate (CLAUDE.md §4 / PRD §5 Phase 0 / phase-0-plan.md).
> **Status:** Ready for user sign-off **at the synth-only boundary** (plan decision J.2 — no live AWS account in Phase 0).
> **Verified:** Node 22.22.1, Docker up (Testcontainers Postgres 16). Counts: **api 239 · shared 48 · infra 29** tests; root `lint`/`typecheck`/`build`/`format:check` green; `cdk synth` → 5 stacks in `ca-central-1`.

Three of the nine PRD exit criteria (#5 IaC sign-off, #6 traces *flowing* to a backend, #7 DR drill *on staging*) depend on a **live AWS account that Phase 0 deliberately does not provision** (J.2: "CDK authored + `cdk synth`-validated in CI only; no live AWS deploy until the account is provisioned"). Their **buildable** parts are complete and test-proven; their **live-environment** parts are carried forward as provisioning-time tasks. They are marked ⏸ **DEFERRED (J.2)** below, not falsely checked.

---

## 1. PRD §5 Phase-0 exit criteria (9)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | All role types authenticate via test harness; JWT carries `tenant_id` + role + sub_role | ✅ | `core/auth/refresh-rotation.e2e.spec.ts`, `core/auth/guard-stack.integration.spec.ts` (5 roles incl. `client_staff`), `core/auth/hmac-token.service.spec.ts`; access-claim `clientId` rule (INV-AUTH-3) |
| 2 | Cross-tenant query returns zero rows (RLS verified) | ✅ | `core/rls/rls.e2e.spec.ts` (real PG16, app_user, filter-removed → 0 rows); reinforced `spine.e2e.spec.ts` §4b |
| 3 | Audit INSERT works; UPDATE/DELETE rejected at DB level | ✅ | `modules/audit/audit.e2e.spec.ts`. **Note:** enforced via **REVOKE/append-only grants** on `audit_log` (app_user *and* service_role have no UPDATE/DELETE) — equivalent-or-stronger than the PRD's "DB-trigger" wording; migration `20260605120000_audit_hash_chain` |
| 4 | Idempotency dedups POSTs within 24h window | ✅ | `modules/idempotency/idempotency.e2e.spec.ts`; reinforced `spine.e2e.spec.ts` §2/§3. **Wave-8 fix:** `IdempotencyInterceptor` now re-binds the tenant ALS around the handler subscription (latent bug surfaced by the composed spine test) |
| 5 | RDS/S3/Redis pinned to `ca-central-1`; IaC review signed off | ⏸ **DEFERRED (J.2)** | Modeled + **asserted**: `infra/test/residency.spec.ts` (every stack `ca-central-1`, no CRR, no cross-region replica). Security review written → PASS (`docs/security/phase-0-threat-model.md`). **Pending:** human IaC sign-off at this demo; no live resources exist (synth-only) |
| 6 | OpenTelemetry traces flowing; per-tenant metric dimensions | ⏸ **DEFERRED (J.2)** | **Built + tested:** W3C trace-context parse/derive (`core/observability/trace-context.spec.ts`), RED metrics interceptor keyed by route template (`red-metrics.interceptor.spec.ts`), request-id middleware. **Deferred:** live export — no OTel collector/backend in Phase 0 (lands Phase 1+) |
| 7 | DR runbook documented; backup/restore drill completed on staging | ⏸ **DEFERRED (J.2)** | **Documented:** `docs/runbooks/dr-backup-restore.md` (PITR, S3 versioning, KMS, restore-validation checklist, quarterly cadence). **Deferred:** live drill — no staging/live AWS (runs when the account is provisioned) |
| 8 | Operator zero read access to financial tables (policy + RLS dual block) | ✅ | `modules/financial/financial.guard.integration.spec.ts`, `modules/platform/platform.e2e.spec.ts`; reinforced `spine.e2e.spec.ts` §5a (403 at RoleGuard) + §5b (`has_table_privilege('service_role','period_summaries','SELECT')` = false) — INV-TEN-3 |
| 9 | Hash-chain integrity verifier passes | ✅ | `modules/audit/hash-chain/hash-chain.verifier.spec.ts`, `modules/audit/audit.e2e.spec.ts`; reinforced `spine.e2e.spec.ts` §7 (tamper → verifier fails at position) |

**6 fully met · 3 deferred-to-provisioning (J.2).** No criterion is blocked by a defect; the deferrals are the explicit, approved scope boundary of a synth-only Phase 0.

---

## 2. Test obligations (STANDARDS §19.3 — 8, adapted per plan)

| # | Obligation | Status | Evidence |
|---|---|---|---|
| 1 | Unit tests for every service method | ✅ | per-module `*.service.spec.ts` across all waves |
| 2 | Integration tests for every controller route | ✅ | `*.e2e.spec.ts` / `*.integration.spec.ts`; `spine.e2e.spec.ts` HTTP routes |
| 3 | Cross-tenant isolation → 404 + RLS zero-rows | ✅ | `tenant.guard.spec.ts`, `rls.e2e.spec.ts`, `spine.e2e.spec.ts` §4a/§4b |
| 4 | RBAC matrix — every role × every route | ✅ | `guard-stack.integration.spec.ts` (5 roles), `role.guard.spec.ts`, `packages/shared` permissions matrix |
| 5 | Invariant tests citing INV-XXX codes | ✅ | test names cite INV-TEN/AUTH/AUDIT/RBAC codes throughout |
| 6 | E2E for the user journey (Phase-0 = auth-per-role + full spine) | ✅ | `refresh-rotation.e2e.spec.ts`, **`spine.e2e.spec.ts`** (auth→tenant→RBAC→RLS write→atomic audit→idempotency composed) |
| 7 | Accessibility (axe) on every new screen | N/A | no UI ships in Phase 0 (backend spine) |
| 8 | Performance smoke (p95 under budget) | ✅ | **`perf-smoke.e2e.spec.ts`** — auth issue+verify p95, audit-write p95, RLS-overhead, over real components (in-process tripwires; k6 SLO load-test deferred to live infra, J.2) |

---

## 3. Security review

`docs/security/phase-0-threat-model.md` — STRIDE pass + cross-tenant-probe/IDOR/rate-limit/JWT-tamper/audit-tamper checks → **verdict: PASS for Phase 0**. Rate-limit enforcement, WAF/CSP/HSTS, ClamAV, OTel export sequenced to the phase that introduces their attack surface (Phase 1 / Phase 10).

---

## 4. ADRs produced in Phase 0

0001 (INV canonicalization) · 0003 (NestJS tsconfig) · 0004 (cross-package resolution) · 0005 (internal HS256 signer) · 0006 (CDK tsconfig overrides). Auth0-vs-Cognito provider decision (ADR-0002) is intentionally Phase-1 (J.1 — internal JWT issuer behind an interface for now).

---

## 5. Sign-off

- [ ] User reviews this checklist and the three J.2 deferrals.
- [ ] User signs off the IaC residency review (criterion #5, human gate).
- [ ] User accepts Phase 0 **at the synth-only boundary**, with #5/#6/#7 live-environment parts carried into account provisioning.
- [ ] On sign-off: `PROGRESS.md` Phase 0 → DONE; Phase 1 (Platform Admin Console) unblocked.

> Per CLAUDE.md §4: **never silently advance.** Phase 1 does not start until the user signs off here.
</content>
</invoke>
