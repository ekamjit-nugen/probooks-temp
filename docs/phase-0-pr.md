# PR: Phase 0 — Backend Spine (Multi-Tenant Foundation, RBAC, Audit, Idempotency, Infra)

> Filled per STANDARDS §24. This is the phase-level PR description for the entire Phase-0 backend spine (Waves 0–8). No git remote / commits exist yet — create the initial commit(s) on user sign-off (see Exit checklist §5).

## Phase / Scope
- **Phase:** 0 — Backend Spine
- **User type:** none (backend infrastructure; the only no-user phase, per CLAUDE.md §2 / PRD §5)
- **Platform:** backend
- **Use cases / spine contracts:** multi-tenant RLS, RBAC matrix, append-only hash-chained audit, JWT refresh rotation, HTTP idempotency, operator-cannot-read-financial-data, `ca-central-1` residency

## What changed
Stood up the shared NestJS backend spine every later phase depends on: env/config + typed errors + Zod validation + Pino logging (Wave 1); Prisma + Postgres 16 RLS (`app_user`/`service_role`) + AsyncLocalStorage tenant context (Wave 2); JWT auth (internal HS256 behind an interface) + RBAC guard stack + cross-tenant 404 (Wave 3); append-only audit log with hash chaining (Wave 4); HTTP idempotency (Wave 5); observability/health + platform-repo/financial-stub (Wave 6); AWS CDK infrastructure synth-validated in `ca-central-1` + DR runbook + security review (Wave 7); the composed full-spine integration suite + performance smoke (Wave 8). One latent production bug fixed: `IdempotencyInterceptor` now re-binds the tenant ALS around the handler subscription (surfaced by the Wave-8 composition test; the per-module idempotency test couldn't catch it because its handler did no tenant-scoped work).

## Invariants enforced / depended on
- **INV-TEN-1/2** — `tenant_id` in every repository `where` + RLS ENABLE+FORCE fail-closed; cross-tenant → 0 rows even with the app filter removed; cross-tenant path → 404 not 403.
- **INV-TEN-3** — operator → 403 at RoleGuard **and** `service_role` has no grant on `period_summaries` (dual block); infra app-task-role ≠ migration role, no wildcard IAM grants.
- **INV-AUTH-1/3/4** — no platform-set credentials; refresh rotation w/ replay → 401 + lineage revoke; per-request re-derived authz; client bound to one client/tenant.
- **INV-RBAC-1** — deny-by-default; §4.17 matrix proven cell-by-cell across 5 roles.
- **INV-AUDIT-1/2/3** — append-only, hash-chained, atomic with parent tx; UPDATE/DELETE revoked at DB grant level; tamper → verifier fails at position.
- **STD-7.4** — idempotency: same key+body replays (side effect once), key+different body → 409.
- **INV-AUDIT-4/5, INV-EXP-7** — CMK encryption, `ca-central-1` everywhere (no cross-region), private documents bucket.

## Standards citations
§1 (stack lock-in) · §3/§4 (TS strict, lint/style) · §6 (module layout) · §7.1/§7.4 (envelope, idempotency) · §8 (Prisma/RLS/money/time) · §9.3/§9.4/§9.6 (tenancy enforcement, 404, platform repo) · §10 (auth/RBAC) · §11 (Zod) · §12 (DomainError) · §13/§14 (logging/observability) · §15.2 (idempotency layers) · §17/§18 (secrets/security) · §19.2/§19.3 (Testcontainers; 8 obligations) · §26.5 (ADRs).

## Tests
- [x] Unit (per-module `*.service.spec.ts`)
- [x] Integration (Testcontainers — real Postgres 16; `*.e2e.spec.ts` / `*.integration.spec.ts`)
- [x] Cross-tenant isolation test (`rls.e2e.spec.ts`, `tenant.guard.spec.ts`, `spine.e2e.spec.ts`)
- [x] RBAC matrix test (`guard-stack.integration.spec.ts`, 5 roles)
- [x] Invariant test(s) (codes cited in test names)
- [x] E2E for shipped flow (`spine.e2e.spec.ts` — full composed spine; `refresh-rotation.e2e.spec.ts`)
- [ ] A11y (axe) — **N/A** (no UI in Phase 0)
- [x] Performance smoke (`perf-smoke.e2e.spec.ts`; k6 SLO load-test deferred to live infra — J.2)

**Counts:** api 239 · shared 48 · infra 29. Root `lint`/`typecheck`/`build`/`format:check` green; `cdk synth` → 5 stacks `ca-central-1`.

## Security review (required — auth/RBAC/tenancy touched)
- [x] STRIDE pass — `docs/security/phase-0-threat-model.md` (verdict PASS)
- [x] No new PII in logs (Pino redaction; gitleaks in CI)
- [x] Cross-tenant probe → 404
- [ ] Rate limit on write routes — **deferred to Phase 1** (no HTTP product routes ship in Phase 0; tracked in the threat model residual-risk register)

## Rollback
Phase 0 ships no user-facing surface and is uncommitted until sign-off; "rollback" = do not create the initial commit. Post-commit, the spine is additive infrastructure with no runtime data path live (synth-only infra). Rollback plan: N/A per PRD §5.

## Out of scope (and why)
- Live AWS deploy, OTel live export, DR drill on staging, k6 SLO load test — **J.2 boundary** (no account provisioned in Phase 0); carried into account provisioning.
- Auth provider choice (Auth0 vs Cognito) — **ADR-0002 at Phase 1** (J.1; internal HS256 issuer behind an interface for now).
- All UI, all domain features (flags, documents, periods, export, feedback) — later phases per PRD §5.
