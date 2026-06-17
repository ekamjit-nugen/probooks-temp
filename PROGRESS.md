# ProBooks — Build Progress Tracker

> **Purpose:** Single source of truth for what's done, what's running, what's next.
> **Audience:** Any future Claude session (or human) picking up this project.
> **Rule:** Update this file at the start AND end of every phase. Never leave it stale.

---

## 0. Quick orient (read this first if you're new)

**Project:** ProBooks — multi-firm SaaS bookkeeping/HST portal for Canadian accounting firms (CRA, HST, T2).
**Three apps:** A=Platform Admin Console (web, Operator), B=Firm Workspace (web, Firm Admin + Accountant), C=Client Portal (mobile PWA, Client).
**Shared backend:** NestJS, Postgres (with RLS), Redis (queues + cache), S3, BullMQ workers, Claude API + Textract for OCR/extraction.
**Region:** `ca-central-1` (PIPEDA).
**Working directory:** `/Users/ekamjitsingh/Projects/ProBooksOrg/`

**Mandatory reading before any code work** (Claude Code auto-loads `CLAUDE.md` on session start, which links here):
- [`CLAUDE.md`](CLAUDE.md) — cold-start entry point. Read first.
- [`STANDARDS.md`](STANDARDS.md) — production-grade engineering conventions. **Every code-writing agent must inject this into its system prompt** (per STANDARDS §28).
- [`PRD.md`](PRD.md) — 248 use cases + 16 phases. Source of truth for what to build.
- [`SPEC.md`](SPEC.md) — invariants (INV-XXX-N codes) — what must always hold.
- This file — what's done / running / next.

**Build constraints the user set:**
> 1. Implement phases one by one. Test before moving to the next.
> 2. Each phase contains ONE user type with web OR mobile only. (Phase 0 backend is the only exception.)
> 3. Production-grade standards throughout — no style drift across agents.

---

## 1. Status at a glance

| Field | Value |
|---|---|
| **Current phase** | **Phase 0 — Backend Spine — RUNNING** |
| **Status** | **Waves 0–8 ✅ — Phase 0 AWAITING USER SIGN-OFF.** Full spine green: scaffold + foundations + Prisma/RLS/tenancy + auth/rbac/guards + audit hash chain + idempotency + observability/health/platform-repo + infra CDK (synth) + DR runbook + security review (PASS) + **full-spine integration suite + perf smoke**. Tests: **239 api · 48 shared · 29 infra**; root lint/typecheck/build/format green; `cdk synth` → 5 stacks ca-central-1. Exit checklist: [`docs/phase-0-exit-checklist.md`](docs/phase-0-exit-checklist.md) (6/9 PRD criteria met; 3 deferred to AWS account provisioning per J.2). PR: [`docs/phase-0-pr.md`](docs/phase-0-pr.md). |
| **Last updated** | 2026-06-16 (Wave 8 complete; Phase 0 ready for sign-off) |
| **Blocking?** | Awaiting user sign-off (per CLAUDE.md §4 — never silently advance to Phase 1) |
| **Owner** | Claude (current session) |

---

## 2. What's DONE

- [x] **Spec received** — user provided complete invariants + workflow specification.
- [x] **`SPEC.md` written** — the invariants source of truth saved to project folder (§3 operational phases, §4 invariants, §5–§8 cross-cutting, §9 original delivery suggestion, §10 open decisions).
- [x] **`STANDARDS.md` v1.0 written** — production-grade conventions locked. Covers stack lock-in (NestJS+Prisma+Postgres RLS, Next.js 15, Zod, Tailwind, shadcn), repo layout (pnpm + Turborepo monorepo), TS config, naming, NestJS module structure, API contract, multi-tenancy enforcement pattern (repositories never take `tenantId` as a param — context only), auth+RBAC, validation, error handling (typed `DomainError`), logging, observability, BullMQ idempotency (3-layer pattern), caching, secrets, security baseline, testing pyramid + per-phase 8-test obligation, frontend conventions, mobile PWA specifics, i18n, perf budgets, git workflow, PR template, code review checklist, ADRs, **§28 mandatory agent-injection protocol**, §29 anti-patterns. All future code-writing agents must inject this doc.
- [x] **PRD-generation workflow ran** — 11 parallel agents (10 use-case expansion + 1 phase synthesis) returned 248 use cases + 16-phase delivery roadmap. Raw output archived at [`.build/prd-workflow-output.json`](.build/prd-workflow-output.json).
- [x] **`PRD.md` v1.0 written** — 620KB, 11,417 lines. §1 overview, §2 user types, §3 two-gate spine, §4 use case catalogue (248 cases each with priority/preconditions/main+alt flows/edge cases/invariants/acceptance criteria/test cases), §5 16-phase delivery roadmap (each phase = 1 user type + 1 platform, with exit criteria + 6-track test strategy + dependencies + effort + rollback plan), §6 sequencing rationale, §7 open decisions, §8 appendix.
- [x] **Progress tracker maintained** — this file, updated at every boundary per user instruction.

---

## 3. What's CURRENTLY RUNNING

Nothing. Workflow complete. Awaiting user input.

---

## 4. What's NEXT — the 16-phase delivery roadmap

> Full per-phase detail (scope, use case IDs, invariants, exit criteria, test strategy, dependencies, effort, rollback) in [`PRD.md`](PRD.md) §5.

| # | Phase | User type | Platform | Effort | Status |
|---|---|---|---|---|---|
| **0** | Backend Spine (tenancy, RBAC, audit, FSM, data model) | _backend infra — no user_ | _none_ | 6 wk, 4 eng | 🏃 RUNNING |
| 1 | Platform Admin: Auth, Dashboard, Tenant Lifecycle | Platform Operator | web | 5 wk, 3 eng | 🔒 blocked by 0 |
| 2 | Platform Admin: Billing, Entitlements, Plans | Platform Operator | web | 4 wk, 3 eng | 🔒 blocked by 1 |
| 3 | Platform Admin: Observability, Compliance, Incidents | Platform Operator | web | 5 wk, 3 eng | 🔒 blocked by 1 |
| 4 | Firm Workspace: Auth, RBAC, Branding | Firm Admin | web | 4 wk, 3 eng | 🔒 blocked by 1 |
| 5 | Firm Workspace: Team, Seats, Client CRUD | Firm Admin | web | 6 wk, 4 eng | 🔒 blocked by 4 |
| 6 | Firm Workspace: Policy Config (thresholds, prompts, benchmarks) | Firm Admin | web | 5 wk, 3 eng | 🔒 blocked by 5 |
| 7 | Accountant: Dashboard, Client Setup, Engagement Config | Accountant | web | 5 wk, 4 eng | 🔒 blocked by 5 |
| 8 | Accountant: AI Pipeline, FSM, Filing | Accountant | web | 8 wk, 5 eng | 🔒 blocked by 7 |
| 9 | Accountant: Flags & Inbox | Accountant | web | 6 wk, 4 eng | 🔒 blocked by 8 |
| 10 | Client Portal: PWA Shell, Auth, Upload Pipeline | Client Owner | mobile | 10 wk, 5 eng | 🔒 blocked by 8 |
| 11 | Client Portal: Flag Inbox, Answers, Not-Found Attestation | Client Owner | mobile | 8 wk, 4 eng | 🔒 blocked by 9, 10 |
| 12 | Client Portal: Dashboard, Gates, Archive, Downloads | Client Owner | mobile | 7 wk, 4 eng | 🔒 blocked by 11 |
| 13 | Client Portal: Quarterly Feedback | Client Owner | mobile | 5 wk, 3 eng | 🔒 blocked by 12 |
| 14 | Client Portal: Staff Sub-Role Permission Model | Client Staff | mobile | 6 wk, 4 eng | 🔒 blocked by 13, conditional on open decision #1 |
| 15 | Firm Workspace: Firm-Side Scorecard, Reports | Firm Admin | web | 5 wk, 3 eng | 🔒 blocked by 9, 13 |

**Total:** ~95 weeks of engineering work; calendar time depends on parallelization (3+ phases can run concurrently once Phase 4 lands).

**Phase boundary protocol** (from `PRD.md` §8.3):
- **Entry:** read STANDARDS + PRD + this file → confirm deps → flip phase to RUNNING here.
- **Exit:** all exit criteria + all 8 test obligations + security review + PR template + user demo → flip to DONE here.

---

## 5. Open decisions (RESOLVED — 2026-06-04)

Per `SPEC.md` §10 — all six resolved by the user on 2026-06-04. Phase 0 is unblocked.

1. **Client login model** — **Owner + `client_staff` carried in the schema/RBAC from day one; Phase 14 UI deferred.** Attestations/feedback/audit attribute to the specific login. Near-zero cost in Phase 0; avoids a later retrofit.
2. **Line-number sub-labels (105/108/109)** — **Default OFF for clients (accountant-only), firm-overridable** (INV-CFG-1 toggle). Pure config default; no Phase 0 impact.
3. **Scorecard visibility to accountants** — **Partner-only by default (INV-SIG-5); firm setting may grant an accountant read-only access to their OWN row.** Affects Phase 15.
4. **Residency** — **Default `ca-central-1` for all tenants, modeled as a per-tenant region pin** (set in the Phase 1 provisioning wizard). PIPEDA-aligned by default; contractually flexible later.
5. **Multi-firm now vs later** — **Multi-tenant spine from day one** (current PRD/STANDARDS assumption). May deploy single-firm, but the `tenant_id` + RLS + tenant-scoped repository isolation layer is never stripped. This is what shapes Phase 0.
6. **Who initiates AI takeover** — **Manual accountant action is the primary trigger; schema allows a future scheduled / "all docs received" trigger.** Sets the one-way document-lock boundary (INV-DOC-3/4); affects Phases 8 + 10.

---

## 6. How to resume if you're a new agent

If you're reading this fresh:

1. **Read this file completely.** Sections 0–4 orient you.
2. **Read [`STANDARDS.md`](STANDARDS.md) end-to-end** — it locks the stack, conventions, and the agent-injection protocol. Different agents producing different code styles is explicitly forbidden.
3. **Read [`PRD.md`](PRD.md)** for the phase you're starting — §4 has the use cases, §5 has the phase detail.
4. **Read [`SPEC.md`](SPEC.md)** §4 for the INV-XXX-N codes you'll enforce.
5. **Check open decisions in §5** — if Phase 0 hasn't started, these may still be unresolved.
6. **Check tasks** — `TaskList` for current state. The active task tells you exactly where to pick up.
7. **Phase boundary protocol:**
   - On entry: edit §1 "Current phase" and §4 status column; append §8 changelog row.
   - On exit: edit §2 to mark phase done; flip §4 status; append §8 row; demo to user.
8. **The user's email is `accounts@nugeninfo.com`**; firm name is Nugen.

---

## 7. Key files & locations

| What | Where |
|---|---|
| Cold-start entry point (auto-loaded by Claude Code) | [`CLAUDE.md`](CLAUDE.md) |
| Engineering standards (mandatory pre-read) | [`STANDARDS.md`](STANDARDS.md) |
| Product requirements | [`PRD.md`](PRD.md) |
| Invariants spec | [`SPEC.md`](SPEC.md) |
| This progress tracker | [`PROGRESS.md`](PROGRESS.md) |
| Workflow output archive | [`.build/prd-workflow-output.json`](.build/prd-workflow-output.json) (1.4MB, raw JSON of the 11-agent expansion + synthesis run) |
| Working directory | `/Users/ekamjitsingh/Projects/ProBooksOrg/` |
| Memory dir (Claude) | `/Users/ekamjitsingh/.claude/projects/-Users-ekamjitsingh-Projects-ProBooksOrg/memory/` |
| ADRs (created as needed) | `docs/adr/NNNN-*.md` |
| Runbooks (created as needed) | `docs/runbooks/<incident>.md` |

---

## 8. Change log

| When | Phase | What changed | By |
|---|---|---|---|
| 2026-06-01 | bootstrap | Progress tracker created; PRD generation workflow launched | Claude (current session) |
| 2026-06-01 | bootstrap | STANDARDS.md v1.0 written — production-grade conventions locked; agent-injection protocol defined (§28) | Claude (current session) |
| 2026-06-01 | bootstrap | PRD workflow completed (11 agents, 532k tokens, 1063s); 248 use cases + 16-phase plan returned | Claude (current session) |
| 2026-06-01 | bootstrap | SPEC.md saved (invariants source); PRD.md v1.0 written (620KB, 11,417 lines); PROGRESS.md rewritten with 16-phase roadmap | Claude (current session) |
| 2026-06-01 | bootstrap | CLAUDE.md written — cold-start entry point auto-loaded by Claude Code; points at the 4 mandatory pre-reads + agent-injection protocol + phase boundary protocol + 12 hard "do not" rules | Claude (current session) |
| 2026-06-04 | pre-0 | All 6 open decisions resolved (§5); path/identity drift corrected to `/Users/ekamjitsingh/Projects/ProBooksOrg/`; Trunks agent upgraded to Modular TDD (Gherkin → failing tests → code; max modules; integration tests once >1 module; UI+backend both tested). Phase 0 unblocked. | Claude (current session) |
| 2026-06-04 | 0 entry | Phase 0 plan approved & saved (`docs/phase-0-plan.md`); J.1 internal JWT issuer behind interface (provider → ADR-0002), J.2 CDK synth-only. Phase 0 → RUNNING; Wave 0 scaffold begun. | Claude (current session) |
| 2026-06-04 | 0 / Wave 0 | Monorepo scaffold complete & verified green (pnpm+Turborepo; apps/api NestJS, packages/{shared,config,test-utils}; ESLint flat + @probooks/no-cross-tenant rule; Jest+Vitest; CI workflow; ADR-0001/0003). lint+typecheck+test+build+format all pass. | Claude (current session) |
| 2026-06-04 | 0 / Wave 1 | Foundations via Trunks (Modular TDD): core/{config-env, errors, validation, logging} + §7.1 envelope in shared. Gherkin→failing tests→code; cross-module integration spec. Verified green (build/typecheck/lint/format + 35 api & 8 shared tests). ADR-0004 (cross-package resolution). STANDARDS §11/§12/§13/§17/§7.1; INV-AUDIT-4 (log redaction). | Claude (current session) (Trunks) |
| 2026-06-05 | 0 / Wave 2 | Prisma/RLS/tenancy via Trunks (Modular TDD): core/{prisma (PrismaService app_user + runInTenantTx SET LOCAL; PlatformPrismaService service_role/BYPASSRLS), tenant-context (ALS TenantContextService.require + seeding interceptor seam), rls (verifyRlsEnabled)}. Prisma schema + 3 migrations (uuid_generate_v7 PL/pgSQL, init spine, RLS+roles: ENABLE+FORCE, NULLIF fail-closed, app_user/service_role, audit_log append-only). shared: auth/roles (UserRole + client sub-roles). clients.repository exemplar (§9.3). RLS proven on REAL Postgres 16 as NON-superuser app_user: cross-tenant SELECT → 0 rows even with WHERE filter removed (INV-TEN-1); service_role bypasses (INV-TEN-3); audit no UPDATE/DELETE (INV-AUDIT-2/3). Green: build/typecheck/lint/format + 64 api & 10 shared tests. STANDARDS §5.2/§8/§9.2/§9.3/§9.6; INV-TEN-1/2/3, INV-AUTH-3, INV-AUDIT-2/3, INV-RBAC-1. | Claude (current session) (Trunks) |
| 2026-06-05 | 0 / Wave 3 | Auth/RBAC/guards via Trunks (Modular TDD): core/auth (TokenIssuer/TokenVerifier interfaces + HmacTokenService HS256 via node:crypto behind them — ADR-0005; refresh rotation w/ replay detection on refresh_tokens, revoke-lineage on replay; AuthGuard verify→principal, financial scope excluded for operator INV-TEN-3; access-claim INV-AUTH-3 clientId rule). core/rbac (RoleGuard deny-by-default + @RequireRole/@RequirePermission; permissions matrix in shared encodes SPEC §4.17, proven cell-by-cell by test). core/tenancy-guard (TenantGuard cross-tenant→404-not-403 §9.4/INV-TEN-2; ResourceGuard own-client; GUARD_STACK order Auth→Tenant→Role→Resource). env.schema +JWT_SECRET/TTLs; TenantContext.permissions now typed Permission (shared). Full guard-stack integration (supertest): RBAC matrix 5 roles × routes, cross-tenant 404, deny-by-default 403, principal server-derived from VERIFIED token (body tenantId ignored). Refresh rotation proven on REAL Postgres 16 (rotate revokes prior + persists successor; replay→401+lineage revoked; tenant-isolated). Green: build/typecheck/lint/format + 116 api & 37 shared tests. ADR-0005. STANDARDS §10.1/§10.2/§10.4/§9.4; INV-AUTH-1/3/4, INV-RBAC-1/2/3, INV-TEN-2/3, INV-DISP-6. | Claude (current session) (Trunks) |
| 2026-06-16 | 0 / Wave 8 | Cross-module integration suite + perf smoke + exit artifacts via Trunks (Modular TDD); Phase 0 → **ready for sign-off**. **Full-spine integration** (`apps/api/src/spine.e2e.spec.ts`, STANDARDS §6/§9.3/§9.4/§10.2/§19): boots REAL Postgres 16 (Testcontainers, app_user) + a real Nest app wiring the actual `GUARD_STACK` (Auth→Tenant→Role→Resource) + `@Idempotent` interceptor over a test-only controller whose handler does, in ONE tenant-scoped tx, a real `ClientRepository.create` **+ atomic `AuditService.record`**, driven by supertest with real signed HS256 tokens. Proves the primitives COMPOSE end-to-end: happy path 201 (row+audit same tx, chain verifies) [INV-AUTH-4/INV-TEN-1/INV-AUDIT-1]; idempotent replay = side-effect-once (1 row,1 audit) [STD-7.4]; key+diff body→409; cross-tenant→404 + RLS 0-rows backstop [INV-TEN-1/2]; operator dual-block 403-at-guard + service_role no-grant on period_summaries [INV-TEN-3]; audit tamper→verifier fails at position [INV-AUDIT-2]. Refresh-replay intentionally not duplicated (already covered by `refresh-rotation.e2e`). **Real latent bug fixed:** `IdempotencyInterceptor` re-bound tenant ALS around `complete/release` but NOT around `next.handle()` — handler subscribed in a `mergeMap` after async `begin()` resolved, so the request ALS had unwound → every tenant-scoped idempotent handler threw NO_TENANT_CONTEXT (the prior idempotency e2e missed it: counter-only handler). Fix: subscribe handler inside `withTenant(ctx, () => firstValueFrom(next.handle()))`; reuses the Wave-2 `TenantContextService.runWithContext` seam. Added `ClientRepository.create(input, tx?)` (§9.3: tenant-from-context, optional parent tx for atomic audit composition). **Perf smoke** (`apps/api/src/perf-smoke.e2e.spec.ts`, §19.3 #8 — last open obligation, §22): in-process tripwires over real components — auth issue+verify p95 ≈0.01ms (ceiling <50ms; SLO <200ms), audit write p95 ≈3–4ms warm (ceiling <150ms; SLO <5ms warm RDS), RLS read p95 ≈1ms (absolute ceiling <50ms; SLO <10% overhead); k6 SLO load-test + Multi-AZ RTO deferred to live infra (J.2). **Exit artifacts:** `docs/phase-0-exit-checklist.md` (9 PRD criteria → evidence: 6 met, 3 = IaC-signoff/OTel-live-export/DR-staging-drill DEFERRED to account provisioning J.2, honestly marked not false-checked; all 8 test obligations met, #7 a11y N/A) + `docs/phase-0-pr.md` (filled §24 template). Green: api **239** (+3 from 236; spine +9 earlier, perf +3) · shared 48 · infra 29; root lint/typecheck/build/format clean; `cdk synth` → 5 stacks ca-central-1. No new ADR. **Phase 0 NOT flipped DONE — awaiting user sign-off (CLAUDE.md §4).** | Claude (current session) (Trunks) |
| 2026-06-10 | 0 / Wave 7 | Infra (CDK, synth-validated only) + DR runbook + Phase-0 security review via Trunks (Modular TDD). **Infra** (`infra/` = `@probooks/infra`, AWS CDK v2 TS, **synth-only** per plan J.2; STANDARDS §1.1/§1.3/§17/§18): 5 modular stacks all pinned `ca-central-1` (INV-AUDIT-5) — Security (customer-managed KMS keys w/ rotation for DB+storage; separate migration/admin IAM role), Network (VPC w/ isolated data subnets + NAT egress + flow logs ALL; data tier not public), Data (RDS **PG16 Multi-AZ**, CMK `StorageEncrypted` INV-AUDIT-4, deletion protection, 14-day backups→PITR, Perf Insights, not public, creds from Secrets Manager via dynamic `{{resolve:secretsmanager}}` — never inline; Redis CMK at-rest + in-transit, isolated), Storage (S3 documents bucket — block-all-public, CMK default encryption, `enforceSSL` TLS-deny policy, versioned, **no cross-region replication**, INV-EXP-7), Compute (ECS Fargate cluster + API task-def skeleton, CMK+retained CloudWatch logs, execution role ≠ app task role — INV-TEN-3). Modular TDD: Gherkin `.feature` → failing `aws-cdk-lib/assertions` tests → CDK code; 29 infra tests incl. a whole-App residency integration suite (every stack region = ca-central-1, no S3 CRR, no RDS cross-region replica). Resolved a real cross-stack KMS/IAM dependency cycle by co-locating logs-CMK + ECS roles in Compute and Redis-CMK in Data (DB/storage CMKs imported by ARN). **service_role ≠ IAM role** documented (Postgres RLS-bypass role from Wave 2 migrations, not infra). CI `infra-synth` job now satisfied. **DR runbook** (`docs/runbooks/dr-backup-restore.md`): Multi-AZ failover, RDS PITR-to-new-instance (RTO ≤60min/RPO ≤5min), S3 version restore, KMS-compromise, restore-validation checklist (RLS ENABLED+FORCED, cross-tenant probe, service_role no-grant, audit-chain verify), quarterly drill cadence — all `ca-central-1`, no cross-region. **Security review** (`docs/security/phase-0-threat-model.md`, STANDARDS §18.5): full STRIDE table over the spine + infra, targeted cross-tenant-probe/IDOR/rate-limit/JWT-tamper/audit-tamper checks, residual-risk register (rate-limit/WAF/ClamAV/OTel deferred to phase that introduces their surface) → **verdict PASS for Phase 0**. ADR-0006 (CDK tsconfig overrides: CommonJS + `exactOptionalPropertyTypes:false` for the CDK toolchain only — mirrors ADR-0003; all other strict flags + shared ESLint retained; scoped to one synth-only package). Green: root lint 4/4 · typecheck 5/5 · test 4/4 (api 227 + shared 48 + infra 29) · build 3/3 · format clean; `pnpm --filter @probooks/infra synth` → 5 stacks synthesized in ca-central-1. STANDARDS §1.1/§1.3/§17/§18/§26.1/§26.5/§28; INV-AUDIT-4/5, INV-TEN-3, INV-EXP-7. | Claude (current session) (Trunks) |
| 2026-06-09 | 0 / Wave 6 | Observability + Health + Platform-repo/financial-stub via Trunks (Modular TDD). **Observability** (core/observability, STANDARDS §13/§14): request-id middleware closes the Wave-2 envelope seam (accepts a sanitised x-request-id or generates a UUID; attaches req.requestId so DomainExceptionFilter stamps it into the §7.1 envelope — proven end-to-end; echoes x-request-id); W3C trace-context (pure parse/derive of `traceparent` — continue incoming trace w/ new span, else fresh sampled root; all-zero ids rejected; echoed); RED metrics — MetricsRecorder seam + InMemoryMetricsRecorder + RedMetricsInterceptor hooking res `finish` for the TRUE final status, keyed by route TEMPLATE (bounded cardinality), 5xx=errors; OTel/Prometheus exporters deferred (no backend in Phase 0). Wired global in AppModule (middleware forRoutes('*') + APP_INTERCEPTOR). **Health** (modules/health, §14): unguarded /health/live (process up, no DB) + /health/ready (pings app_user + service_role via dependency-free SELECT 1; 200 ok / 503 SERVICE_NOT_READY DomainError with per-dep checks); wired into AppModule. **Platform-repo + financial-stub** (§9.6, INV-TEN-3): new migration 20260608130000 adds period_summaries financial stub (tenant+client-scoped, money NUMERIC(18,4) §8.6, RLS ENABLE+FORCE+fail-closed policy) — grants app_user ONLY, service_role gets NO grant so INV-TEN-3 is enforced at the DB grant layer; PlatformRepository (service_role, raw SQL, tenant METADATA only — status/region/plan/userCount, cross-tenant by design, no financial accessor); FinancialRepository (app_user, §9.3 tenant-scoped) + FinancialService (Decimal→string at boundary §8.6) + guarded FinancialController (@RequirePermission financial:read). Proven on REAL Postgres 16: operator→403 at RoleGuard (guard layer) + firm/accountant reach handler; tenant reads only its own financial rows (INV-TEN-1); fail-closed with no tenant in context (require throws) AND raw app_user with no app.tenant_id → 0 rows (RLS); service_role SELECT on period_summaries → permission denied (INV-TEN-3 DB layer); PlatformRepository reads metadata across tenants. Green: build/typecheck/lint/format + 227 api (+46) & 48 shared tests. STANDARDS §6/§8.6/§9.3/§9.6/§10.2/§13/§14; INV-TEN-1/2/3. | Claude (current session) (Trunks) |
| 2026-06-08 | 0 / Wave 5 | HTTP idempotency (STANDARDS §7.4) via Trunks (Modular TDD): modules/idempotency (fingerprint — canonical sha256 of method+path+body, order-independent, body hashed not stored §13; errors — IdempotencyKeyConflict/RequestInProgress 409 + KeyMalformed 400, all DomainError; repository — tenant-scoped atomic `INSERT … ON CONFLICT (tenant_id,key) DO UPDATE … WHERE expires_at<now()` = Layer-3 backstop §15.2, claim/complete/release over runInTenantTx so RLS binds; service — replay/conflict/in-progress decisions + 24h TTL via injected clock; @Idempotent decorator + interceptor — ALS snapshot re-bound across the RxJS subscription boundary so post-handler complete/release stay tenant-scoped; module exports service+interceptor, not yet imported into AppModule — lands ahead of Phase-1 controllers, mirroring audit). Shared: jobs/idempotency.ts encodes the three-layer pattern (L1 Redis SETNX seam, L2 Redlock seam, L3 DB upsert) — deterministic namespaced dedupe-key builder + Zod context + runIdempotentJob orchestration; Redis/BullMQ NOT wired (deferred), pure parts tested. New migration 20260608120000_idempotency_request_response extends the stub table (request_fingerprint, state CHECK in_progress→completed, response_status/body, response_hash→nullable; backward-compatible, RLS+grants already cover new cols). Proven on REAL Postgres 16 as NON-superuser app_user: first call runs handler once + persists; retry same key+body replays WITHOUT re-running (side-effect once); same key + different body → 409; missing header → pass-through; malformed key → 400; two concurrent same-key → handler AT MOST once (Layer-3 serialises on unique index); same key string in two tenants isolated (INV-TEN-1); expiry re-claim + release-on-failure. Green: build/typecheck/lint/format + 181 api (+36) & 48 shared (+11) tests. STANDARDS §6/§7.2/§7.4/§9.3/§9.4/§12/§13/§15.2; INV-TEN-1, STD-7.4 (plan's INV-IDEMPOTENCY-1). | Claude (current session) (Trunks) |
| 2026-06-05 | 0 / Wave 4 | Append-only audit log with hash chaining via Trunks (Modular TDD): modules/audit (audit.repository INSERT-only tenant-scoped — NO update/delete method; audit.service records who[from context]/what/when/before→after, composable in caller's tx for atomicity INV-AUDIT-1, + verify(); audit.errors AuditChainTamperError; audit.clock seam; audit.module). hash-chain/ (pure: GENESIS_PREV_HASH = sha256 of a domain label; computeEntryHash = sha256 over canonical(position‖prev_hash‖who/what/when/before→after) — reproducible, key-order-independent; verifier walks (tenant,position) asc detecting entry-hash-mismatch / prev-hash-mismatch / position-gap). New migration 20260605120000_audit_hash_chain adds position(bigint)/prev_hash/entry_hash/actor_role/occurred_at + UNIQUE(tenant_id,position) fork backstop (STD §15.2 layer 3) + UNIQUE(entry_hash); schema.prisma AuditLog updated. Concurrency: pg_advisory_xact_lock keyed by tenant serializes appends (no fork) — proven with 10 concurrent appends → contiguous 1..10 + verify ok. Proven on REAL Postgres 16 as NON-superuser app_user: append+chain; tamper (mutate/delete/reorder via DB owner) → verifier fails at the right position; app_user (and service_role) cannot UPDATE/DELETE audit_log (append-only INV-AUDIT-2/3); atomic rollback (parent throws → 0 rows) + commit (→1 row chained) INV-AUDIT-1; tenant isolation via RLS. Reconciled Wave 2 rls.e2e audit INSERT for the new NOT NULL columns. Green: build/typecheck/lint/format + 145 api (+29) & 37 shared tests. STANDARDS §6/§8.3/§9.3/§15.2/§18.3/§26.1; INV-AUDIT-1/2/3 (INV-FIN-8 spirit). | Claude (current session) (Trunks) |

> **Update protocol:** Every time a phase starts or ends, append a row here AND update sections 1–4. Never silently advance.
