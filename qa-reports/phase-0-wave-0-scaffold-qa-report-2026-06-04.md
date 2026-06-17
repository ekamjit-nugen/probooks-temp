# Vegeta QA Report — Phase 0 "Backend Spine", Wave 0 Scaffold

- **Date:** 2026-06-04
- **Auditor:** Vegeta (QA Sentinel) — god-level pass, no benefit of the doubt
- **Target:** ProBooks Phase 0 monorepo scaffold (the Trunks development to date)
- **Method:** Static read of every file in scope + **runtime execution** (turbo typecheck/lint/test, ESLint `--print-config`, and a standalone proof-of-concept harness running the real `no-cross-tenant` rule against bypass fixtures).
- **Governing law:** STANDARDS.md (injected per §28), SPEC.md invariants, docs/phase-0-plan.md, CLAUDE.md §5 hard rules.

> ⚠️ **Moving-target caveat.** The repo was being actively built by Trunks _during this audit_. Between recon and the final snapshot, `apps/api/*`, `packages/shared/*`, `packages/test-utils/*`, the per-package `eslint.config.mjs` shims, `.github/workflows/ci.yml`, `README.md`, and `pnpm-lock.yaml` all appeared, and two transient lint errors self-resolved. **This report reflects the tree snapshot at ~14:46 local.** Re-run before sign-off.

---

## Executive Summary

The Wave 0 scaffold is **structurally sound and honest**. The full gate is green on a forced, uncached run:

| Gate                                          | Result                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `turbo run typecheck`                         | ✅ 4/4 packages pass                                                                                 |
| `turbo run lint --force`                      | ✅ 3/3 pass (uncached)                                                                               |
| `turbo run test`                              | ✅ shared 2 tests, api 1 test — all pass                                                             |
| TS base config vs STANDARDS §3                | ✅ byte-for-byte match, no drift                                                                     |
| `.gitignore` secrets coverage (hard-rule #12) | ✅ `.env`, `.env.*`, `*.pem`, `*.key` ignored                                                        |
| ADR discipline (§28: deviate→ADR)             | ✅ NestJS tsconfig overrides documented in ADR-0003; INV canonicalization in ADR-0001                |
| CI (`.github/workflows/ci.yml`)               | ✅ typecheck + lint + format:check + test + build + gitleaks secret scan + cdk-synth (graceful skip) |
| PROGRESS.md honesty                           | ✅ claims "Wave 0 scaffold begun" — **no over-claiming** of unbuilt modules                          |

**The risk is concentrated in the one piece of real security logic that exists: the `@probooks/no-cross-tenant` ESLint rule.** It ships with **zero tests** and has **six empirically-proven evasion paths** (plus one false positive), while being cited as the compile-time enforcement of INV-TEN-1.

### Ship verdict for Wave 0: **FIX-AND-CONTINUE**

The scaffold may proceed. **Hard gate before Wave 2 (the wave that introduces Prisma queries):** the tenant-isolation rule must be tested, its `where`-less false-negative closed, and its known holes documented — because Wave 2 is when developers begin _relying_ on it. Shipping query code against a porous, untested rule is the moment INV-TEN-1 actually gets violated.

No P0 today: there is no query/data-model/RLS code on disk yet, so there is nothing for a cross-tenant leak to leak _from_. The findings are pre-positioned defects, not live ones.

---

## Findings

### P1 — Fix before Wave 2 (queries)

#### S-1 — `no-cross-tenant` rule has SIX confirmed bypasses (false negatives)

- **File:** `packages/config/eslint-rules/no-cross-tenant.js:60–90`
- **Violates:** STANDARDS §9.3 (the lint rule is the compile-time backstop for INV-TEN-1), SPEC INV-TEN-1.
- **Proof (real ESLint run against fixtures):** the rule flagged only the naive literal-`where`-missing-`tenantId` case. All of these passed silently:

  | #   | Code                                                                                  | Why it slips through (AST reasoning)                                                                                                                                                              |
  | --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --------------------------------------------------------------------------------- |
  | a   | `prisma.user.findMany({ orderBy:{...} })` / `findMany()`                              | No `where` property → line 73 `if (!whereProp) return;`. **A `where`-less query returns the entire table across ALL tenants — this is the exact leak the rule exists to stop.** Highest severity. |
  | b   | `prisma.user.upsert({ where:{id}, ... })`                                             | `upsert` is not in `TENANT_SCOPED_METHODS` (line 17–30). `upsert` _has_ a `where` and reads/writes cross-tenant.                                                                                  |
  | c   | `prisma.$queryRawUnsafe('SELECT * FROM users')` / `$queryRaw` / `$executeRaw(Unsafe)` | Raw SQL bypasses entirely.                                                                                                                                                                        |
  | d   | `prisma.user.findMany(opts)` (variable arg)                                           | Line 67 `if (!arg                                                                                                                                                                                 |     | arg.type !== 'ObjectExpression') return;` — non-literal whole-arg silently exits. |
  | e   | `prisma.user['findMany']({ where:{id} })`                                             | Line 62 `callee.property.type !== 'Identifier'` — computed member access exits.                                                                                                                   |
  | f   | (also: `createMany`/`create` never check `data` for `tenantId`)                       | Inserts can omit tenant scope; rule only inspects `where`.                                                                                                                                        |

- **Severity rationale:** RLS (Wave 2) is the _runtime_ hard backstop, so these are not a P0 _today_. But (a) is trivially exploitable and trivially fixable, and the rule is advertised as enforcing a security invariant. P1.
- **Recommended fix:**
  - Close (a): if the method is a read/`update`/`delete`/`count`/`aggregate`/`groupBy` and there is **no `where` at all**, report `missingTenant` (require an explicit opt-out comment for the rare legitimate full-scan).
  - Add `upsert` to the scoped set; for `upsert`/`update`/`delete` also verify `where` scope.
  - Flag `$queryRaw*`/`$executeRaw*` with a "manual tenant-scope review required" message (`TaggedTemplateExpression` + `CallExpression`).
  - Treat computed-member (`['findMany']`) and non-literal whole-arg as `nonLiteralWhere`-style "cannot verify" reports rather than silent exits.
  - For `createMany`/`create`, optionally check that `data` includes `tenantId`.

#### T-1 — Security-critical custom ESLint rule has ZERO tests

- **File:** `packages/config/eslint-rules/no-cross-tenant.js` (no sibling `.spec`/`.test`; `eslint-rules/` contains only the rule).
- **Violates:** STANDARDS §19.3 #1 ("unit tests for every … method"), §28.3, §19.2 (sibling test convention). This is non-trivial AST logic (8+ branches) guarding INV-TEN-1.
- **Reasoning:** The one bit of genuine logic in the entire scaffold is untested. The bypasses in S-1 would have been caught by a `RuleTester` valid/invalid suite. Every future change to this rule is unguarded against regression.
- **Recommended fix:** Add `no-cross-tenant.spec.(m)js` using ESLint's `RuleTester` with `valid` cases (tenantId present, present via spread, create/connect with no where) and `invalid` cases (literal missing tenantId, `where`-less query, upsert, computed member, raw query). Wire it into the `@probooks/config` package's `test` script (currently the config package has **no** `test` script — turbo skips it).

### P2 — Fix during Phase 0 (before exit gate)

#### B-1 — `no-cross-tenant` false POSITIVE on the idiomatic spread pattern

- **File:** `packages/config/eslint-rules/no-cross-tenant.js:83–89`
- **Proof:** `prisma.user.findMany({ where: { ...withTenant } })` was flagged `missingTenant` even though `withTenant` may carry `tenantId`. A `SpreadElement` is not a `Property`, so `hasTenant` is false.
- **Impact:** Developer friction → people will sprinkle `eslint-disable`, eroding the rule's authority everywhere.
- **Fix:** When the `where` object contains a spread, downgrade to the `nonLiteralWhere` "cannot statically verify" message (review, not hard error), consistent with the non-literal philosophy already in the rule.

#### G-1 — No guard against destructive deletes

- **Files:** rule treats `delete`/`deleteMany` as merely needing `tenantId`; nothing forbids their existence.
- **Violates:** CLAUDE.md hard-rule #10, SPEC INV-AUDIT-3 ("No permanent deletion of financial records … by any user role").
- **Reasoning:** The scaffold's only enforcement asset (the config package) has no complementary rule banning hard deletes on financial models. Easy to add now; expensive to retrofit after delete calls proliferate.
- **Fix:** Add a sibling `no-hard-delete` rule (or extend this one) flagging `delete`/`deleteMany` on financial models, pointing at the retention/soft-delete pattern. Track via ADR if deferred.

#### G-2 — Config/rule source files are outside the lint + type net

- **File:** `packages/config/eslint.config.js:10` — `ignores: ['**/*.config.*']`, plus `eslint-rules/*.js` is in no tsconfig project (proven: linting it directly errors `was not found by the project service`).
- **Impact:** `eslint.config.js`, `prettier.config.js`, `vitest.config.ts`, **and the security-critical rule file itself** receive no static checking.
- **Fix:** Add a dedicated flat-config block (or a JS-project tsconfig / `allowDefaultProject`) so `eslint-rules/**` is linted with untyped rules; reconsider blanket-ignoring all `*.config.*`.

### P3 — Cleanups / pre-position before service code

#### B-2 — `main.ts` fire-and-forget bootstrap with no `.catch()`

- **File:** `apps/api/src/main.ts:15` — `void bootstrap();`
- **Reasoning (Vegeta checklist: silenced promise rejection):** if `app.listen` rejects (port in use, bad config), it becomes an unhandled rejection with no structured error log / deterministic exit code.
- **Fix:** `bootstrap().catch((err) => { Logger.error(err, 'Bootstrap'); process.exit(1); });`

#### T-2 — Direct `process.env` read bypasses the (planned) config-env module

- **File:** `apps/api/src/main.ts:10` — `process.env.PORT ?? 3000`.
- **Violates (forward-looking):** STANDARDS §17 + plan Wave 1 (config-env owns all env via a validated schema; no scattered `process.env`).
- **Fix:** Acceptable as a bootstrap stub; migrate to the validated config service when Wave 1's config-env module lands. Leave a `// TODO(wave-1): move to ConfigEnvService` marker.

#### G-3 — No coverage thresholds enforced

- **Files:** `apps/api/package.json` jest block (has `collectCoverageFrom`, no `coverageThreshold`); `packages/shared/vitest.config.ts` (no coverage gate).
- **Violates (forward-looking):** STANDARDS §19.1 (≥85% lines on services/domain logic).
- **Fix:** Wire `coverageThreshold` (Jest) / `test.coverage.thresholds` (Vitest) before the first service method lands so the bar is enforced from day one, not retrofitted.

---

## Coverage Table

| File / module                                                         | Audited          | Tests present                  | Verdict                                                                |
| --------------------------------------------------------------------- | ---------------- | ------------------------------ | ---------------------------------------------------------------------- |
| `packages/config/eslint-rules/no-cross-tenant.js`                     | ✅ + runtime PoC | ❌ **none**                    | **P1 (S-1, T-1, B-1)**                                                 |
| `packages/config/eslint.config.js`                                    | ✅               | n/a                            | P2 (G-2)                                                               |
| `packages/config/tsconfig.base.json`                                  | ✅               | n/a                            | ✅ matches STANDARDS §3 exactly                                        |
| `packages/config/prettier.config.js`                                  | ✅               | n/a                            | ✅                                                                     |
| `packages/config/package.json`                                        | ✅               | n/a                            | ✅ (exports resolve; no test script — see T-1)                         |
| `apps/api/src/main.ts`                                                | ✅               | ❌                             | P3 (B-2, T-2)                                                          |
| `apps/api/src/app.module.ts`                                          | ✅               | ✅ `app.module.spec.ts` passes | ✅ scaffold-appropriate                                                |
| `apps/api/{tsconfig,tsconfig.build,nest-cli,package}.json`            | ✅               | n/a                            | ✅ (overrides justified by ADR-0003)                                   |
| `apps/api/eslint.config.mjs` (shim)                                   | ✅               | n/a                            | ✅ re-exports shared config                                            |
| `packages/shared/src/index.ts`                                        | ✅               | ✅ `index.spec.ts` (2)         | ✅                                                                     |
| `packages/shared/{package,tsconfig,tsconfig.build,vitest.config}`     | ✅               | n/a                            | ✅ (P3 G-3: no coverage gate)                                          |
| `packages/test-utils/src/index.ts` + configs                          | ✅               | n/a (helpers)                  | ✅ Testcontainers deps pinned; no test runner (acceptable for helpers) |
| Root `package.json` / `pnpm-workspace.yaml` / `turbo.json` / `.nvmrc` | ✅               | n/a                            | ✅ Node 22 pinned, pnpm 9 locked, globs correct                        |
| `.gitignore`                                                          | ✅               | n/a                            | ✅ secrets covered (hard-rule #12)                                     |
| `.github/workflows/ci.yml`                                            | ✅               | n/a                            | ✅ comprehensive (secret scan + full gate + synth skip)                |
| `docs/adr/0001`, `0003`                                               | ✅               | n/a                            | ✅ present; tsconfig reference resolves                                |
| `README.md`                                                           | ⚠️ not reviewed  | n/a                            | out of scope (appeared mid-audit)                                      |

---

## Plan-vs-Reality (docs/phase-0-plan.md)

Wave 0 scope per the plan = **"scaffold + config + CI."** All present:

- ✅ Monorepo scaffold (`apps/api`, `packages/{config,shared,test-utils}`, `turbo.json`, `pnpm-workspace.yaml`).
- ✅ Config package (tsconfig base, prettier, flat ESLint + custom rule).
- ✅ CI pipeline.
- ✅ ADRs 0001 + 0003.

Correctly **NOT yet present** (Waves 1–8, not defects):

- 15 backend modules (config-env, prisma, tenant-context, rls, auth, rbac, tenancy-guard, audit, idempotency, observability, health, platform-repo, …) — Waves 1–6.
- Prisma data model + RLS — Wave 2. **This is the wave that activates the S-1/T-1 risk.**
- `infra/` CDK stacks — Wave 7 (CI already references `@probooks/infra` with a graceful skip).
- `docs/security/phase-0-threat-model.md` — Wave 7.
- ADR-0002 (Auth0 vs Cognito) — deferred to Phase 1 per plan J.1.

**No "claimed-done-but-missing" defects.** PROGRESS.md §3 honestly reports "Wave 0 scaffold begun."

---

## Prioritized Action Plan (hand to Trunks)

1. **[P1 / blocks Wave 2] T-1 + S-1(a):** Add a `RuleTester` suite for `no-cross-tenant`; close the `where`-less false-negative; add a `test` script to `@probooks/config` and wire it into CI.
2. **[P1 / blocks Wave 2] S-1(b–f):** Cover `upsert`, raw queries, computed-member, non-literal arg; check `data` on creates.
3. **[P2] B-1:** Stop false-positiving on spread `where`.
4. **[P2] G-1:** Add `no-hard-delete` guard (or ADR to defer) — INV-AUDIT-3.
5. **[P2] G-2:** Bring config + rule source into the lint/type net.
6. **[P3] B-2, T-2, G-3:** bootstrap `.catch()`; config-env TODO marker; coverage thresholds.

**Re-run this audit after fixes** — and once more right before the Phase 0 exit gate, because RLS + the real query layer (the things INV-TEN-1 actually rides on) do not exist yet.

---

_Generated by Vegeta. The scaffold survived the assault; its one weapon (the tenant rule) did not. Test it, harden it, then advance._
