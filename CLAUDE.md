# CLAUDE.md — Entry point for any agent working in this repo

> **You are reading this because Claude Code auto-loaded it.**
> **STOP. Do not write or modify any code until you have read the four mandatory docs listed in §1.**
> Skipping this step is not allowed — it produces inconsistent code that gets rejected at review.

---

## 0. What this project is

**ProBooks** — a multi-firm SaaS bookkeeping/HST portal for Canadian accounting firms (CRA, HST, T2).

- **Three apps on one shared backend:**
  - App A — Platform Admin Console (web) — Nugen's Platform Operator
  - App B — Firm Workspace (web, desktop-first) — Firm Admin + Accountant (RBAC-separated)
  - App C — Client Portal (mobile PWA) — Client (Owner + optional Staff)
- **Stack** (locked — see [STANDARDS.md](STANDARDS.md) §1): NestJS 10 + Prisma 5 + Postgres 16 with RLS + Redis/BullMQ + S3 + Claude API + Textract + Next.js 15 App Router + Tailwind + shadcn/Radix + Zod.
- **Region:** `ca-central-1` (PIPEDA).
- **Repo layout:** pnpm + Turborepo monorepo. Layout fixed in STANDARDS §2 — do not improvise.

---

## 1. Mandatory pre-read (in this order)

Every agent — cold start or returning — MUST read these before any work:

1. **[STANDARDS.md](STANDARDS.md)** — production-grade engineering conventions. **Non-negotiable.** Stack lock-in, repo layout, naming, NestJS module structure, the multi-tenancy enforcement pattern, RBAC, Zod validation, error handling, logging, observability, BullMQ idempotency, testing pyramid + per-phase 8-test obligation, frontend conventions, mobile PWA specifics, security baseline, git workflow, PR template, code review checklist, ADRs, **§28 agent-injection protocol**, **§29 anti-patterns**.
2. **[PROGRESS.md](PROGRESS.md)** — live build state. Tells you what phase is current, what's done, what's blocked, who decided what. **Updated at every phase boundary.**
3. **[PRD.md](PRD.md)** — 248 use cases + 16-phase delivery roadmap. Read the section for the phase you're working on (§4 use cases scoped to your phase + §5 phase detail).
4. **[SPEC.md](SPEC.md)** — invariants source of truth. The INV-XXX-N codes you'll enforce in code, DB, tests. Skim §4 once; reference as needed.

**Time budget:** ~30 min cold start; ~5 min returning. If you skip these, your PR will fail review.

---

## 2. Build constraints the user set (do not violate)

1. **Phases ship one at a time.** No starting Phase N+1 before Phase N is signed off by the user. Test gate is mandatory.
2. **One user type + one platform per phase.** Each phase ships for ONE actor (Operator, Firm Admin, Accountant, Client Owner, Client Staff) on ONE platform (web OR mobile). Phase 0 is the only exception (backend infrastructure with no user-facing platform).
3. **Production-grade standards throughout.** Different agents producing different code styles is explicitly forbidden. STANDARDS.md §28 mandates that every code-writing workflow inject STANDARDS into the agent's system prompt.
4. **No code without the prerequisites.** PROGRESS.md "Open decisions" must be resolved by the user before Phase 0 begins.

---

## 3. The agent-injection protocol (read STANDARDS §28 for full text)

When you spawn a code-writing agent (`Agent` tool or `Workflow` tool):

- **You MUST inject the contents of `STANDARDS.md` into the agent's system context** before the task description.
- The agent MUST return a structured response that cites: (a) STANDARDS section numbers followed, (b) INV-XXX codes enforced, (c) tests added per §19.3, (d) any open questions (max 5).
- If a task seems to require deviating from STANDARDS, the agent STOPS and produces an ADR proposal under `docs/adr/NNNN-title.md` — it does not deviate silently.

Concrete pattern:

```
SYSTEM CONTEXT (read first; non-negotiable):
<paste contents of STANDARDS.md verbatim>

YOUR TASK:
<the actual task, with phase number + use case IDs + invariants to enforce>

OUTPUT RULES:
- Cite STANDARDS section numbers in your PR description.
- Cite INV-XXX codes enforced.
- List tests added per STANDARDS §19.3.
- List any open questions (max 5).
- If you'd need to deviate from STANDARDS, STOP and propose an ADR instead.
```

This is how we keep code uniform across agents.

---

## 4. Phase boundary protocol (PRD §8.3)

**Before starting a phase:**
1. Re-read STANDARDS.md (skim if returning) + the phase's PRD §5 entry + the phase's use cases in PRD §4.
2. Confirm dependencies in PROGRESS.md §4 are satisfied.
3. Update PROGRESS.md: move the phase from NEXT to RUNNING; update §1 "Current phase"; append §8 changelog row.
4. Use `TaskCreate` to break the phase into trackable tasks.

**Before declaring a phase done:**
1. All exit criteria in PRD §5 met.
2. All 8 test obligations met (STANDARDS §19.3):
   1. Unit tests for every service method
   2. Integration tests for every controller route
   3. Cross-tenant isolation test (probe wrong tenant → 404)
   4. RBAC matrix test (every role × every route)
   5. Invariant tests (cite INV-XXX codes)
   6. E2E for the user journey shipped
   7. Accessibility test on every new screen (axe)
   8. Performance smoke (p95 under budget)
3. Security review pass (STANDARDS §18.5 STRIDE + cross-tenant probe + IDOR + rate limit).
4. PR template completed (STANDARDS §24).
5. Demo to user; get sign-off.
6. Update PROGRESS.md: move phase to DONE in §2; flip status in §4; append §8 row.

**Never silently advance.**

---

## 5. Hard rules — things you must never do

(See STANDARDS §29 for the full anti-pattern list. These are the top 12.)

1. **Do not write a service method that takes `tenantId: string` as a parameter.** Tenant context comes from `AsyncLocalStorage` via `TenantContextService`, never as an arg. STANDARDS §9.3.
2. **Do not write a query without `tenantId` in the `where` clause.** The custom ESLint rule `@probooks/no-cross-tenant` will fail your build. STANDARDS §9.3.
3. **Do not introduce a new validation library.** Zod only. Schemas live in `packages/shared`. STANDARDS §11.
4. **Do not introduce a new error library.** All thrown errors extend `DomainError`. No `throw new Error('...')` for business cases. STANDARDS §12.
5. **Do not introduce a new ORM / state library / styling library / component library.** Stack is locked at STANDARDS §1.
6. **Do not store money as `number` or Postgres `float`.** `NUMERIC(18,4)` + `decimal.js`. STANDARDS §8.6.
7. **Do not show confidence percentages to clients.** INV-DISP-6 — anywhere in App C.
8. **Do not let a client pick a date range or filing period.** INV-CFG-5, INV-EXP-3 — system-derived only.
9. **Do not silently drop a "Not found" receipt flag.** Record the attestation per INV-ATT-1..3 — immutable, attributed, timestamped.
10. **Do not delete financial records on user action.** No destructive deletes — retention-governed only. INV-AUDIT-3.
11. **Do not log emails, business numbers, or document contents.** PII redaction enforced by Pino config. STANDARDS §13.
12. **Do not commit secrets or `.env` files.** AWS Secrets Manager + Parameter Store only. STANDARDS §17.

---

## 6. File map

| File | Purpose | Update frequency |
|---|---|---|
| [CLAUDE.md](CLAUDE.md) | This file. Cold-start entry point. | Rare — when project-level conventions change |
| [STANDARDS.md](STANDARDS.md) | Engineering conventions. Mandatory pre-read. | Versioned — changes require user approval + ADR |
| [PROGRESS.md](PROGRESS.md) | Live build state. | **Every phase boundary** |
| [PRD.md](PRD.md) | 248 use cases + 16 phases. | When a phase scope changes (ADR required) |
| [SPEC.md](SPEC.md) | Invariants. | Rare — when user updates the spec |
| `.build/prd-workflow-output.json` | Archive of the 11-agent PRD generation run. | Never — historical |
| `docs/adr/NNNN-*.md` | Architecture Decision Records. | When a standard is deviated from or a stack choice is made/changed |
| `docs/runbooks/*.md` | Operational runbooks per failure mode. | As needed |
| `apps/<app>/CLAUDE.md` | App-specific conventions (added when each app starts). | When app conventions change |
| `packages/<pkg>/CLAUDE.md` | Package-specific conventions (added when each package starts). | When package conventions change |

**As the codebase grows, add directory-level `CLAUDE.md` files** at:
- `apps/api/CLAUDE.md` — backend-only conventions (domain map, module layout for the NestJS service)
- `apps/platform-admin/CLAUDE.md` — App A specifics
- `apps/firm-workspace/CLAUDE.md` — App B specifics (Firm Admin + Accountant RBAC nuances)
- `apps/client-portal/CLAUDE.md` — App C specifics (mobile PWA, offline, accessibility)
- `packages/shared/CLAUDE.md` — shared schemas + INV codes
- `infra/CLAUDE.md` — IaC conventions (CDK)

These nested files supplement, never override, the root STANDARDS.md.

---

## 7. The 6 open decisions blocking Phase 0

See [PROGRESS.md §5](PROGRESS.md). These must be resolved by the user before Phase 0 starts:

1. Client login model (Owner-only vs Owner+Staff)
2. Line-number sub-labels visibility default
3. Accountant scorecard visibility
4. Residency policy (per-firm vs default)
5. Multi-firm now vs single-firm first
6. AI takeover trigger (manual vs scheduled vs auto)

If you're a returning agent and these are still pending — surface them to the user; do not start Phase 0.

---

## 8. Quick contacts

- **User email:** `accounts@nugeninfo.com` (Nugen) · current operator: `ekamjit.singh@apploi.com`
- **Project root:** `/Users/ekamjitsingh/Projects/ProBooksOrg/`
- **Memory dir:** `/Users/ekamjitsingh/.claude/projects/-Users-ekamjitsingh-Projects-ProBooksOrg/memory/`

---

*If anything in this file conflicts with STANDARDS.md, STANDARDS.md wins. If anything in STANDARDS.md conflicts with SPEC.md invariants, SPEC.md wins. PRD.md and PROGRESS.md describe the work; they never override invariants or standards.*
