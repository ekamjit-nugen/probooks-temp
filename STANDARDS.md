# ProBooks — Engineering Standards

> **This document is mandatory pre-reading for every agent (human or AI) before writing or modifying code in this repository.**
> Code that violates these standards is rejected at review. Consistency across the platform is non-negotiable — different agents must produce the same code.

**Document status:** v1.0 — locked baseline. Changes require user approval and a versioned changelog entry at §27.

---

## 0. How to use this document

1. **Read end-to-end before your first commit.** Skim section titles once; deep-read the section your work touches.
2. **When uncertain, look for a template here first**, then for a precedent in the codebase. Only invent when neither exists, and document the decision.
3. **Cite section numbers in PR descriptions** when explaining choices (e.g. "follows §9.3 multi-tenancy enforcement").
4. **If you disagree with a standard**, raise it as a PR against this doc — don't deviate silently.
5. **Every workflow that generates code must inject this document into agent prompts.** Pattern provided at §28.

---

## 1. Stack lock-in

These choices are **fixed**. Don't introduce alternatives without a written ADR (§26.5).

### 1.1 Backend
| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript 5.x, `strict: true`, `noUncheckedIndexedAccess: true` | Type safety is a security feature, not a convenience |
| Runtime | Node.js 22 LTS | Stable, native fetch, performance |
| Framework | NestJS 10+ | Modular monolith with clear boundaries; matches spec |
| ORM | Prisma 5+ | Type-safe, migrations, supports Postgres RLS |
| Database | Postgres 16 (RDS, `ca-central-1`) | RLS for tenant isolation backstop |
| Queue/Cache | Redis 7 + BullMQ 5 | Spec mandate |
| Object storage | S3 (`ca-central-1` bucket) | Spec mandate |
| AI | Claude API (Sonnet 4.6 / Opus 4.7) primary, AWS Textract fallback | Spec mandate |
| Observability | OpenTelemetry → Datadog/Honeycomb; Sentry for errors | Spec mandate |
| Secrets | AWS Secrets Manager + Parameter Store | No `.env` in repo, ever (§17) |

### 1.2 Frontend
| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 App Router (RSC + Server Actions where appropriate) | Same framework across all 3 apps, code reuse, edge-friendly |
| Language | TypeScript 5.x, strict | Same as backend |
| Styling | Tailwind CSS 4 + CSS variables for theme tokens | Predictable, no CSS-in-JS runtime |
| Component primitives | Radix UI + shadcn/ui (vendored, not npm) | Accessible by default, fully customizable |
| Design system | `packages/ui` — internal package, single source | Visual consistency across 3 apps |
| Server state | TanStack Query 5 | Caching, retries, optimistic updates |
| Client state | Zustand (only when truly client-only) | Prefer server state; reach for client state last |
| Forms | React Hook Form + Zod resolvers | Single Zod schema shared with backend |
| Icons | Lucide React | One icon set; no mixing |
| Mobile PWA | Next.js + `next-pwa` + Web App Manifest | App C only |

### 1.3 Shared
| Layer | Choice | Why |
|---|---|---|
| Validation | Zod 3+ | One schema language for BE+FE+forms |
| Repo layout | pnpm workspaces + Turborepo | Monorepo; shared types/schemas without publishing |
| Package manager | pnpm 9+ (locked via `packageManager` in root `package.json`) | Faster, stricter, no phantom deps |
| Node version | `.nvmrc` pinned; CI enforces match | No "works on my machine" |
| Lint | ESLint 9 (flat config) + `@typescript-eslint` | One config from `packages/config` |
| Format | Prettier 3 (no overrides) | Auto-format on commit |
| Test | Jest (BE), Vitest (FE), Playwright (E2E), Testcontainers (Postgres in integration) | One stack each layer |
| API spec | OpenAPI 3.1 (generated from Nest decorators via `@nestjs/swagger`) | Source of truth for typed clients |
| IaC | AWS CDK in TypeScript | Same language across the stack |

---

## 2. Repository structure

Monorepo. Exact layout below — do not rename or relocate without an ADR.

```
probooks/
├── apps/
│   ├── platform-admin/           # App A — Platform Operator (web)
│   ├── firm-workspace/           # App B — Firm Admin + Accountant (web)
│   ├── client-portal/            # App C — Client (mobile PWA)
│   └── api/                      # NestJS backend (one service)
├── packages/
│   ├── shared/                   # Zod schemas, INV codes, shared types, period math, HST math
│   ├── ui/                       # Shared design system (shadcn-derived) + theme tokens
│   ├── api-client/               # Auto-generated typed OpenAPI client (do NOT hand-edit)
│   ├── config/                   # eslint, tsconfig, prettier, tailwind base
│   └── test-utils/               # Test helpers, factories, fixtures, Testcontainers helpers
├── infra/                        # CDK stacks (VPC, ECS, RDS, ElastiCache, S3, CloudFront, IAM)
├── docs/
│   ├── PRD.md
│   ├── PROGRESS.md
│   ├── STANDARDS.md              # this file
│   ├── SPEC.md                   # the user's invariants document
│   └── adr/                      # numbered ADRs (NNNN-title.md)
├── .github/workflows/            # CI pipelines
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

**Rules:**
- An app **never** imports from another app. Cross-app sharing goes through `packages/`.
- A package **never** imports from an app.
- `packages/shared` has zero runtime dependencies beyond Zod (peers).
- `packages/api-client` is regenerated by CI; never hand-edit.

---

## 3. TypeScript configuration

`packages/config/tsconfig.base.json` (every package extends this):

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "esModuleInterop": false,
    "verbatimModuleSyntax": true
  }
}
```

**Rules:**
- No `any`. Use `unknown` + narrow. Exception: third-party type holes — wrap and assert with a comment citing the library.
- No `@ts-ignore`. Use `@ts-expect-error` with a one-line reason if absolutely needed.
- No non-null assertion `!` on user-facing data paths. Validate or narrow.
- Branded types for IDs: `type TenantId = Brand<string, 'TenantId'>`. Mixing `tenantId` and `clientId` at a call site must be a compile error.

---

## 4. Code style — formatting & lint

`packages/config/eslint.config.js` is the only config. Apps extend it; no per-app overrides without an ADR.

**Non-negotiables:**
- Prettier formats on save and on commit (Husky + lint-staged).
- No `console.log` in committed code — use the logger (§13).
- Imports ordered: node built-ins → external → internal aliases (`@probooks/shared`) → relative. ESLint enforces.
- One export per file by default; barrel files only at package boundaries.
- No default exports for components, services, or modules. Named exports only. Exception: Next.js page/layout files where the framework requires default.
- File-name casing: `kebab-case.ts` for everything except React components (`PascalCase.tsx`).
- Max file length: 400 lines (soft); 600 lines (hard) — refactor before exceeding.
- Max function length: 50 lines (soft); 80 (hard).
- Cyclomatic complexity: max 10 (lint-enforced).

---

## 5. Naming conventions

### 5.1 Code
| Kind | Convention | Example |
|---|---|---|
| Variables, functions | camelCase | `getOpenFlagCount` |
| Types, interfaces, classes | PascalCase | `PeriodState`, `FlagRepository` |
| Type for value (not class) | PascalCase, no `I` prefix | `User` not `IUser` |
| Constants | UPPER_SNAKE | `MAX_UPLOAD_BYTES` |
| Enums | PascalCase name, PascalCase values | `PeriodState.Processing` |
| React components | PascalCase + `.tsx` | `CurrentQuarterCard.tsx` |
| Hooks | `use` + PascalCase | `useOpenFlagCount` |
| Test files | sibling `.spec.ts` (unit) or `.e2e.ts` (Playwright) | `flag.service.spec.ts` |
| Zod schemas | `XSchema` + inferred `type X = z.infer<typeof XSchema>` | `FlagSchema`, `type Flag` |

### 5.2 Database (Postgres)
| Kind | Convention | Example |
|---|---|---|
| Tables | `snake_case`, plural | `flags`, `period_attestations` |
| Columns | `snake_case`, singular | `tenant_id`, `created_at` |
| Primary keys | `id` (UUID v7) | — |
| Foreign keys | `<table_singular>_id` | `tenant_id`, `period_id` |
| Timestamps | `created_at`, `updated_at` (both `timestamptz`) | — |
| Soft-delete (rare; financial data has no destructive deletes — §15) | `archived_at` (timestamptz, nullable) | — |
| Boolean | `is_<adj>` or `has_<noun>` | `is_locked`, `has_attestation` |
| Money | `numeric(18, 4)`, never float | `amount_cents` (or `amount` with NUMERIC) |
| Enum | Postgres ENUM type; name `<table>_<col>_t` | `periods_state_t` |
| Indexes | `ix_<table>_<cols>` | `ix_flags_tenant_id_period_id` |
| Unique | `uq_<table>_<cols>` | `uq_users_tenant_email` |
| RLS policy | `rls_<table>_<scope>` | `rls_flags_tenant_isolation` |

### 5.3 API routes
- REST, plural resources. Examples: `/v1/firms/:firmId/clients/:clientId/periods/:periodId/flags/:flagId`.
- API version in path: `/v1/...`. Breaking changes increment.
- All routes scoped under `/v1/firms/:firmId/...` except: platform-operator routes (`/v1/platform/...`) and identity (`/v1/auth/...`).
- HTTP verbs strictly REST: GET (read), POST (create), PATCH (partial update), PUT (full replace — rare), DELETE (rare; financial data is not deleted).
- Action endpoints when not RESTful map cleanly: `POST .../periods/:id/mark-complete` (not `/markComplete`, not `PATCH` with magic flag).

### 5.4 Events (domain events)
- Past tense, dotted: `period.processed`, `flag.cleared`, `attestation.recorded`.
- Payload includes `tenantId`, `eventId` (UUID v7), `occurredAt` (ISO 8601, UTC).

---

## 6. NestJS module structure

Each domain lives in `apps/api/src/modules/<domain>/`. Domains are nouns from the spec spine (§2 of PRD): `tenants`, `firms`, `clients`, `periods`, `documents`, `flags`, `attestations`, `excel-export`, `feedback`, `signals`, `audit`, `auth`, `platform`.

Per-domain file layout (mandatory):
```
modules/flags/
├── flags.module.ts             # Nest module
├── flags.controller.ts         # HTTP layer; thin, validates DTO, calls service
├── flags.service.ts            # Business logic; transactions; invariant enforcement
├── flags.repository.ts         # Prisma access; tenant-scoped queries (§9.3 pattern)
├── flags.events.ts             # Domain event types
├── dto/                        # Request/response DTOs (Zod schemas, not class-validator)
│   ├── create-flag.dto.ts
│   └── answer-flag.dto.ts
├── flags.service.spec.ts       # Unit tests
└── flags.e2e.spec.ts           # Integration tests (Testcontainers)
```

**Rules:**
- Controllers contain NO business logic. They: parse → call service → format response.
- Services contain NO direct Prisma calls. Always go through repository.
- Repositories receive `TenantContext` (§9) and inject `tenant_id` into every query, every time.
- One transaction per state-changing service method. Use `prisma.$transaction` with `Serializable` isolation when crossing aggregates.

---

## 7. API contract

### 7.1 Response envelope
All responses use the same shape:

```ts
// Success
{
  "data": <payload>,
  "meta": { "requestId": "uuid", "version": "v1" }
}

// Error
{
  "error": {
    "code": "FLAG_ALREADY_CLEARED",   // SCREAMING_SNAKE, stable, documented
    "message": "Flag has already been cleared.",
    "details": { ... },                // optional, structured
    "requestId": "uuid"
  }
}
```

### 7.2 Status codes
| Code | When |
|---|---|
| 200 | GET success, idempotent POST returning resource |
| 201 | POST that created a resource (include `Location` header) |
| 204 | DELETE / state transition with no body |
| 400 | Validation failure (Zod error) |
| 401 | Unauthenticated |
| 403 | Authenticated but not authorized (RBAC denied) — see §10 |
| 404 | Resource not found OR cross-tenant probe (return 404, never 403, on isolation failure — §9.4) |
| 409 | Conflict (concurrent edit, illegal state transition — INV-GATE-5) |
| 410 | Resource gone (filed period locked for edit, etc.) |
| 422 | Semantically valid but rejected by business rule |
| 429 | Rate-limited |
| 500 | Server error (logged + paged) |
| 503 | Tenant suspended / dependency down |

### 7.3 Pagination
Cursor-based for any list that can exceed 200 rows. Shape:
```ts
{ data: [...], meta: { nextCursor: "opaque" | null, requestId, version } }
```
Page size capped at 100, default 25.

### 7.4 Idempotency
- All `POST` that creates state accepts an `Idempotency-Key` header (UUID).
- Backend stores `(tenant_id, idempotency_key) → response_hash` for 24h.
- Same key + same body → cached response; same key + different body → 409.

### 7.5 Versioning
- URL-versioned (`/v1/`). New version when breaking change to shape or semantics.
- Two majors in flight at most; old version deprecated 6 months before removal.

---

## 8. Database & Prisma

### 8.1 Schema location
`apps/api/prisma/schema.prisma`. Single schema file (no multi-schema).

### 8.2 Every tenant-scoped model has:
```prisma
model Flag {
  id         String   @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  tenantId   String   @map("tenant_id") @db.Uuid
  // ... domain fields
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt  DateTime @updatedAt @map("updated_at") @db.Timestamptz

  tenant     Tenant   @relation(fields: [tenantId], references: [id], onDelete: Restrict)
  // ... other relations

  @@index([tenantId, periodId])
  @@map("flags")
}
```

### 8.3 Migrations
- Prisma Migrate. One migration per logical change.
- Migration files committed; name must include intent: `20260601120000_add_attestation_attribution`.
- **Never edit a merged migration.** Add a follow-up.
- Migrations must be backward-compatible (deploy ordering: migrate → deploy → backfill → cleanup). No "stop the world" migrations on tables > 100k rows without an explicit plan.
- Large backfills run as BullMQ jobs, not in the migration.

### 8.4 Row-Level Security (RLS) — the backstop
Every tenant-scoped table has RLS enabled with policies:
```sql
ALTER TABLE flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_flags_tenant_isolation ON flags
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```
At the start of every request transaction, the NestJS middleware sets `SET LOCAL app.tenant_id = '<resolved-tenant>'`. Migrations and platform-operator queries explicitly bypass via a `service_role`.

### 8.5 Read replicas
- Routine reads can target a read replica via `prisma.$replica`.
- Reads that must be transactional with a recent write → primary.
- Reporting (firm-side scorecard) → replica.

### 8.6 Money
- `NUMERIC(18, 4)` only. Never `FLOAT`/`DOUBLE`/JS `number` for currency.
- Computations use `decimal.js`. Convert at the I/O boundary only.

### 8.7 Time
- All timestamps `timestamptz`, stored UTC.
- Period boundaries are calendar dates (`date`) in the firm's configured timezone.
- All app-layer date math goes through `packages/shared/lib/time` (Temporal API + Luxon for IANA).

---

## 9. Multi-tenancy — the enforcement pattern

This is the single most important section. **Read carefully.**

### 9.1 The hierarchy
`Tenant (Firm) → Client → Period → (Documents, Flags, ...)`. Every persisted row carries `tenant_id`; row-level data also carries `client_id` where applicable.

### 9.2 Tenant context
A `TenantContext` object is built in middleware from the authenticated session:
```ts
type TenantContext = {
  tenantId: TenantId;
  userId: UserId;
  userRole: 'platform_operator' | 'firm_admin' | 'accountant' | 'client_owner' | 'client_staff';
  clientId?: ClientId;          // present iff userRole starts with 'client_'
  permissions: ReadonlySet<Permission>;
};
```
Stored in a request-scoped `AsyncLocalStorage`. Every repository method reads from it; no service or repository accepts `tenantId` as a parameter — that creates room for bugs.

### 9.3 Repository pattern (the only way to query)
```ts
// flags.repository.ts
@Injectable()
export class FlagRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  async findByPeriod(periodId: PeriodId): Promise<Flag[]> {
    const { tenantId } = this.tenant.require();   // throws if no tenant in scope
    return this.prisma.flag.findMany({
      where: { tenantId, periodId },              // tenant_id ALWAYS in where
    });
  }
}
```

**Hard rules:**
- Every `where` clause includes `tenantId`. Lint rule enforces (custom ESLint plugin `@probooks/no-cross-tenant`).
- Repositories never accept `tenantId` as an argument — it comes from context.
- Repositories never expose Prisma client to services.
- Service methods do not call Prisma directly — only through repositories.

### 9.4 Cross-tenant probes return 404, not 403
If a client user requests `/v1/firms/<other-firm>/...`, the response is `404`, not `403`. We do not leak existence across tenant boundaries.

### 9.5 Background jobs
Every BullMQ job carries `tenantId` (and `clientId` / `periodId` where applicable) in its payload and seeds the AsyncLocalStorage context before doing any work.

### 9.6 Platform operator queries (INV-TEN-3)
Operator surfaces have a **separate** repository (`PlatformRepository`) that runs under `service_role` and is structurally restricted to tenant metadata (subscription, plan, region, user count) — never financial tables. Code review checklist (§24) verifies no operator route ever touches `flags`, `documents`, `period_summaries`, `feedback`, etc.

---

## 10. Authentication & RBAC

### 10.1 AuthN
- Identity provider: **Auth0** (or AWS Cognito if cost-sensitive — decide in ADR-0002).
- Firm users: SSO (SAML/OIDC) preferred; password + WebAuthn fallback. **MFA mandatory** for firm users.
- Client users: passwordless email magic link + optional WebAuthn.
- Sessions: short-lived JWT (15 min) + rotating refresh token (httpOnly, Secure, SameSite=Lax).
- **No password creation by the platform** (INV-AUTH-1). Invites generate one-time tokens; user sets own credentials.

### 10.2 AuthZ
Guard stack runs in order:
1. `AuthGuard` — valid session?
2. `TenantGuard` — does the requested path's tenant match the session's tenant? (404 if not — §9.4)
3. `RoleGuard` — does the user role include this action? (decorator-driven, see below)
4. `ResourceGuard` — does the specific resource belong to this user's scope? (e.g. a client_owner can only act on their own client)

```ts
@Controller('v1/firms/:firmId/clients/:clientId/periods/:periodId/flags')
@UseGuards(AuthGuard, TenantGuard)
export class FlagsController {
  @Post(':id/answer')
  @RequireRole('client_owner', 'client_staff')
  @RequireResource('flag', 'period.matches-current')
  async answer(...) { ... }
}
```

### 10.3 Permission matrix
Source of truth: §4.17 of the PRD spec. Encoded as a static map in `packages/shared/auth/permissions.ts`. Tests assert every guarded route maps to the same row.

### 10.4 Deny by default
Lint rule: every controller method must have at least one of `@RequireRole`, `@RequirePermission`, or `@Public()` (the last requires an ADR).

---

## 11. Validation — Zod everywhere

### 11.1 Pattern
```ts
// dto/answer-flag.dto.ts (in packages/shared so frontend reuses)
export const AnswerFlagSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('category'),
    categoryId: z.string().uuid().nullable(),   // null = "let my accountant choose"
  }),
  z.object({
    type: z.literal('explain'),
    text: z.string().min(1).max(2000),
  }),
  z.object({
    type: z.literal('receipt'),
    receiptDocumentId: z.string().uuid().nullable(),
    notFound: z.boolean(),
  }).refine(d => d.notFound !== (d.receiptDocumentId !== null), {
    message: 'Either upload a receipt OR mark not-found, not both.',
  }),
]);
export type AnswerFlag = z.infer<typeof AnswerFlagSchema>;
```

- Validation runs in a Nest pipe (`ZodValidationPipe`).
- Same schema imported on the frontend by React Hook Form via `@hookform/resolvers/zod`.
- Errors map to the §7.1 envelope with `code: 'VALIDATION_FAILED'` and per-field details.

### 11.2 Don't
- Don't use `class-validator`. One validation library only.
- Don't trust `req.body` shape anywhere — always parsed by the pipe before reaching the controller method.

---

## 12. Error handling

### 12.1 Typed errors
All thrown errors extend `DomainError`:
```ts
export abstract class DomainError extends Error {
  abstract readonly code: string;          // e.g. 'FLAG_ALREADY_CLEARED'
  abstract readonly httpStatus: number;
  details?: Record<string, unknown>;
}

export class FlagAlreadyClearedError extends DomainError {
  readonly code = 'FLAG_ALREADY_CLEARED';
  readonly httpStatus = 409;
  constructor(public readonly flagId: FlagId) { super(`Flag ${flagId} already cleared`); }
}
```

### 12.2 Mapping
A single `DomainExceptionFilter` translates `DomainError` → §7.1 envelope. Unknown errors → 500 + Sentry, body sanitized.

### 12.3 No throwing strings, no throwing objects, no `throw new Error('...')` for business cases.

### 12.4 At system boundaries (HTTP/queue/file), validate. Inside, trust types (per CLAUDE.md guidance).

---

## 13. Logging

- **Pino** as the logger. JSON output. Pretty-printed only in local dev.
- Logger injected via Nest's `Logger`. Don't construct loggers ad-hoc.
- Every log line has: `requestId`, `tenantId` (when known), `userId`, `route`, `latencyMs`.
- **No PII in logs.** Use `[REDACTED]` for emails, names, business numbers. A Pino redaction config enforces.
- Levels: `trace`/`debug` (dev only), `info` (request lifecycle), `warn` (handled anomaly), `error` (5xx, also pages Sentry), `fatal` (process is dying).
- No `console.*` calls in source. ESLint rule enforces.

---

## 14. Observability

- **OpenTelemetry** instrumentation for: HTTP server, HTTP client, Prisma, BullMQ, Redis.
- Trace IDs propagated via `traceparent` header to frontends; frontends include in their own spans.
- **Metrics** (Prometheus-style): RED (Rate, Errors, Duration) for every controller route; queue depth + lag for every BullMQ queue; DB pool saturation; cache hit rate.
- **SLOs** per route documented in `apps/api/src/modules/<domain>/SLO.md` — used to alert.
- Sentry for unhandled exceptions; release tagged to git SHA.

---

## 15. Background jobs (BullMQ)

### 15.1 Queues
Named per concern: `extraction`, `excel-generation`, `signals-compute`, `notifications`, `audit-replay`. Don't mix concerns in one queue.

### 15.2 Idempotency (the three-layer pattern)
```
Layer 1: Redis SETNX on job dedupe key (cheap)
Layer 2: Redlock around the critical section (cross-instance safety)
Layer 3: DB-level uniqueness constraint or atomic upsert (correctness backstop)
```
Every state-changing job uses all three. Documented in `packages/shared/jobs/idempotency.ts`.

### 15.3 Retries
- Exponential backoff: 1s, 5s, 30s, 2m, 10m.
- Max 5 attempts → dead-letter queue.
- A dead-letter triggers a Slack alert with a triage runbook link.

### 15.4 Job payloads
- Always typed via Zod.
- Always include `tenantId`. The handler seeds `TenantContext` before doing work (§9.5).
- Payloads do not contain secrets or PII beyond IDs.

### 15.5 Long-running jobs (extraction)
- Stream progress to Redis pub/sub (`tenant:<id>:period:<id>:progress`).
- Frontend subscribes via SSE.

---

## 16. Caching

- Redis. Keys namespaced: `cache:<tenantId>:<scope>:<id>`. No bare global keys.
- TTLs: aggressive (30–60s) for counters (open flag count); long (1h+) for filed-period read-models (they're immutable).
- Cache invalidation: write-through on state-changing events (period.processed → bust quarter card cache).
- Never cache cross-tenant data in a shared key.

---

## 17. Secrets

- AWS Secrets Manager for credentials, Parameter Store for config.
- App reads via IAM role at boot; no `.env` files in repo or shipped artifacts.
- **Never commit a secret.** Pre-commit hook scans for known patterns; CI re-scans (`gitleaks`).
- Rotation: DB credentials 90 days; API keys 180 days. Calendar reminder + runbook.

---

## 18. Security

### 18.1 Baseline
- TLS 1.2+ everywhere. HSTS on all web apps. `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
- Strict CSP: `default-src 'self'; script-src 'self'; ...`. No inline scripts. No `unsafe-eval`.
- CORS allowlisted per app. No wildcards.
- Rate limiting (per-IP + per-user): default 60 req/min, write endpoints 10 req/min, auth endpoints 5 req/min.
- CSRF: SameSite cookies + double-submit token on state-changing routes.
- Input validation at every boundary (§11).
- Output encoding: trust React/Next.js for HTML, but parameterize all queries (Prisma forces this).
- File uploads: virus scan on ingest (ClamAV worker), MIME sniff (not just extension), max size enforced server-side, EXIF stripped from images.
- Signed S3 URLs only (5-minute expiry); never embed object keys in URLs (INV-EXP-7).
- PIPEDA: data residency in `ca-central-1`, no cross-region replication.

### 18.2 Field-level encryption
Sensitive identifiers (business number, SIN if ever stored — try not to) encrypted at rest with AWS KMS + envelope encryption via Prisma client extension.

### 18.3 Audit (INV-AUDIT-1..6)
Append-only `audit_log` table; every state transition, every login, every permission change, every export. Filed returns and attestations: `INSERT` only, `UPDATE`/`DELETE` revoked at DB role level.

### 18.4 Untrusted content (INV-AUDIT-6)
Documents are data, never instructions. The extraction service treats Claude tool-use as untrusted by default; no extracted "instruction" can call platform tools.

### 18.5 Threat-model checklist runs each phase
- STRIDE pass on new endpoints
- Auth bypass test (`401`/`403`/`404` matrix)
- Cross-tenant probe test (must 404)
- Rate-limit test
- IDOR test
Documented per phase in `docs/security/phase-<n>-threat-model.md`.

---

## 19. Testing

### 19.1 Pyramid + targets
| Layer | Tool | Coverage target | Owner |
|---|---|---|---|
| Unit | Jest (BE), Vitest (FE) | ≥85% lines on services/domain logic | Author |
| Integration | Jest + Testcontainers (real Postgres + Redis) | Every controller route + every state transition | Author |
| Contract | Pact or generated OpenAPI tests | Every endpoint shape | Author |
| E2E | Playwright | Every happy path + every gate (§4.4 INV-GATE) | QA + Author |
| Security | OWASP ZAP baseline + custom test suite | Cross-tenant + IDOR + rate-limit + CSP | Security review |
| Performance | k6 | p95 latency budget per route | Author |
| Accessibility | axe-core in Playwright | WCAG 2.1 AA on all client surfaces | Author |

### 19.2 Conventions
- Test files siblings of source: `flags.service.ts` + `flags.service.spec.ts`.
- AAA: Arrange, Act, Assert — separated by blank lines.
- Test name: `it('rejects mark-complete when open flags > 0 [INV-GATE-7]', ...)` — cite invariant.
- Factories in `packages/test-utils/factories/` — no inline test data assembly.
- Tests don't mock the DB. Use Testcontainers. **No SQLite stand-in for Postgres** (RLS won't match).
- Tests don't mock Redis if they need queue semantics — use Testcontainers Redis.
- Snapshot tests forbidden for anything non-trivial (they encourage rubber-stamp diffs).

### 19.3 What every phase's test suite MUST include
Per `STANDARDS.md §28.3`:
1. Unit tests for every service method (happy + 1–2 error paths).
2. Integration tests for every controller route.
3. Cross-tenant isolation test for every tenant-scoped endpoint (probe with wrong tenant — must 404).
4. RBAC matrix test — for each route, every role attempts; only allowed roles succeed.
5. Invariant tests — for each INV-XXX-N referenced, a test that asserts violation is rejected.
6. E2E for the user journey shipped in the phase.
7. Accessibility test on every new screen (axe must pass).
8. Performance smoke (p95 < budget under expected load).

---

## 20. Frontend conventions

### 20.1 Next.js App Router
- Server Components by default. Add `'use client'` only when needed (interactivity, browser APIs, hooks).
- Data fetching in Server Components via direct `fetch` to internal API; type-safe via `packages/api-client`.
- Server Actions for mutations from forms when the action is co-located with the form. For everything else, REST through `api-client`.
- No `getServerSideProps` / `getStaticProps`. App Router only.

### 20.2 Component structure
```
components/
├── ui/                    # shadcn primitives (vendored from packages/ui)
├── domain/                # domain-named composite components (e.g. CurrentQuarterCard)
└── layouts/               # page-level layouts
```
- One component per file. Co-locate styles, tests, stories.
- Props typed via inferred Zod or hand-written interface; no `any`.
- No prop drilling beyond 2 levels — promote to context or compose differently.

### 20.3 State
- Server state via TanStack Query. Query keys: `[scope, ...ids]` — e.g. `['flags', tenantId, periodId]`.
- Mutations invalidate the right keys; never `queryClient.clear()` as a shortcut.
- Client state via Zustand, only when truly client-only (UI toggles, transient form state).
- Forms: React Hook Form + Zod resolver. Schema imported from `packages/shared`.

### 20.4 Styling
- Tailwind utilities. Use design tokens via CSS variables, not raw hex.
- `cn()` helper (clsx + tailwind-merge) for conditional classes.
- No CSS-in-JS. No inline `style=` except for dynamic values (e.g. progress bar width).
- Dark mode: planned but off-by-default; tokens already structured for it.

### 20.5 Accessibility (WCAG 2.1 AA — non-negotiable)
- Every interactive element keyboard-reachable + visible focus ring.
- Color contrast ≥ 4.5:1 for text, 3:1 for large text and UI components.
- Form labels associated. Error text linked via `aria-describedby`.
- Live regions for async state changes (flag count updates, etc.).
- `axe-core` runs in CI on every page.
- Tested with VoiceOver (macOS/iOS) + NVDA (Windows) on every phase's primary flows.

### 20.6 Mobile PWA specifics (App C)
- Web App Manifest with full icon set, `display: standalone`, `theme_color` matched to brand.
- Service worker via `next-pwa`. Cache strategy: stale-while-revalidate for static; network-first for API; never cache POST/PATCH responses.
- Offline UX: read filed-period archive available offline (last 12 months cached). Upload retries when connection returns.
- Touch targets ≥ 44×44pt. No hover-only affordances.
- Tested on iOS Safari 17+ and Chrome Android 120+.

---

## 21. Internationalization

- English-Canada (`en-CA`) only at v1. Strings centralized in `packages/shared/i18n/en-CA.ts`.
- No hard-coded user-facing strings in components.
- Money formatting: `Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' })`.
- Dates: `Intl.DateTimeFormat('en-CA')`; period boundaries in firm's IANA TZ.

---

## 22. Performance budgets

| Surface | Budget |
|---|---|
| API p50 | < 100ms |
| API p95 | < 300ms |
| API p99 | < 1s |
| Web first contentful paint | < 1.5s on 4G |
| Web largest contentful paint | < 2.5s on 4G |
| Mobile time-to-interactive | < 3s on 3G (cached return visit < 1s) |
| Mobile JS bundle | < 200KB gzipped per route |
| Lighthouse score | ≥ 90 on Performance, A11y, Best Practices, SEO (where applicable) |

CI fails if budgets regress.

---

## 23. Git workflow

### 23.1 Branches
- `main` — protected; deploys to staging on merge; production on tag.
- Feature: `feat/<phase>-<short-desc>` — e.g. `feat/phase3-flag-resolution-ux`.
- Fix: `fix/<short-desc>`.
- Hotfix: `hotfix/<short-desc>` — branches from production tag.

### 23.2 Commits
Conventional Commits. Examples:
- `feat(flags): add Not-Found attestation flow [INV-ATT-1..3]`
- `fix(periods): prevent mark-complete with open flags [INV-GATE-7]`
- `chore(deps): bump prisma to 5.20`
- `docs(standards): clarify §9.4 cross-tenant 404 rule`

PR title = top-line commit. PR body uses the template at §24.

### 23.3 PR rules
- Squash-merge to `main`. Linear history.
- PR cannot merge without: CI green, 1 reviewer approval, all conversations resolved, STANDARDS.md sections cited where applicable.
- No `force-push` to `main`. No `--no-verify`.
- PR must reference: the phase number, the use case IDs, the invariants enforced.

---

## 24. PR template

```markdown
## Phase / Scope
- Phase: <number + name>
- User type: <Operator | Firm Admin | Accountant | Client>
- Platform: <web | mobile | backend>
- Use cases: <UC-XX-NN, UC-XX-NN>

## What changed
<2–4 sentences>

## Invariants enforced / depended on
- INV-XXX-N: <how this PR enforces it>

## Standards citations
- §<N.M>: <which rules apply>

## Tests
- [ ] Unit (link to spec file)
- [ ] Integration (Testcontainers)
- [ ] Cross-tenant isolation test
- [ ] RBAC matrix test
- [ ] Invariant test(s)
- [ ] E2E for shipped flow
- [ ] A11y (axe)
- [ ] Performance smoke

## Security review (auto-required on auth/RBAC/payments touches)
- [ ] STRIDE pass
- [ ] No new PII in logs
- [ ] Cross-tenant probe → 404
- [ ] Rate limit applied to write routes

## Rollback
<one-liner — how to back out>

## Out of scope (and why)
<so reviewers don't flag missing things>
```

---

## 25. Code review checklist

Reviewer asserts:
1. Standards §3 (TS strict) — no `any`, no `!`, no `@ts-ignore`.
2. Standards §9 (multi-tenancy) — every query goes through a repository, every where-clause has `tenantId`.
3. Standards §10 (RBAC) — every route has explicit role/permission decorator.
4. Standards §11 (validation) — every input parsed by a Zod schema.
5. Standards §12 (errors) — no thrown strings; typed `DomainError` only.
6. Standards §13 (logging) — no `console.*`, no PII.
7. Standards §15 (jobs) — idempotency layers 1–3 present where state-changing.
8. Standards §19 (tests) — pyramid present; invariant tests cite codes.
9. Standards §24 (PR template) — completed.
10. No standards deviations without an ADR (§26.5).

---

## 26. Documentation

### 26.1 Always present
- `README.md` per package — what it is, how to run, how to test.
- `apps/api/src/modules/<domain>/README.md` — domain summary, public service API, owned tables, invariants enforced.

### 26.2 OpenAPI
- Generated from Nest decorators at build time.
- Published to internal docs site per commit.
- Frontend `api-client` regenerated from OpenAPI in CI.

### 26.3 Runbooks
- `docs/runbooks/<incident>.md` for each known failure mode (e.g. `extraction-stuck.md`, `excel-generation-failing.md`).
- Linked from PagerDuty alerts.

### 26.4 PRD + Progress
- `docs/PRD.md` is the spec source for what.
- `docs/PROGRESS.md` is the state of build.
- Both updated at every phase boundary.

### 26.5 ADRs (Architecture Decision Records)
- `docs/adr/NNNN-title.md`. Numbered sequentially.
- Format: Context · Decision · Status · Consequences · Alternatives considered.
- Required when: a standard is deviated from, a stack choice is made/changed, a major refactor is undertaken.

---

## 27. Standards changelog

| Version | Date | Change | By |
|---|---|---|---|
| 1.0 | 2026-06-01 | Initial baseline; locks stack + structure + patterns | Claude (current session) |

> Any change to §1–§22 requires user approval. Append a row here AND update the relevant section.

---

## 28. How agents must use this document

### 28.1 Pre-read requirement
Every coding workflow (any agent that writes or modifies source) MUST inject this document into the agent's prompt as system context **before** the task. Pattern:

```
SYSTEM CONTEXT (read first; non-negotiable):
<contents of STANDARDS.md>

YOUR TASK:
<the actual task>

OUTPUT RULES:
- Cite the section numbers you followed in your PR description.
- If a task seems to require deviating, STOP and produce an ADR proposal, not the deviation.
```

### 28.2 Cross-agent consistency rules
When multiple agents work in parallel:
- All read STANDARDS.md.
- All follow the same scaffolds (§6 module structure, §20.2 component structure, §19.2 test naming).
- Naming follows §5 exactly. No agent-specific renaming.
- Errors all extend `DomainError` (§12.1). No agent reinvents error types.
- Validation all uses Zod schemas from `packages/shared` (§11). No agent introduces class-validator or yup.
- Tests all use the harness from `packages/test-utils`. No agent rolls their own factory.

### 28.3 Per-phase agent kickoff checklist
Before any agent starts coding in a phase, the kickoff prompt confirms:
1. Read STANDARDS.md.
2. Read PRD.md sections for this phase.
3. Read PROGRESS.md to know what's done, what's blocking.
4. Read the §6 module layout for the domain being touched.
5. Know the invariants enforced (cited from PRD spec).
6. Know the test obligations (§19.3 — all 8 must be planned).

### 28.4 Mandatory output shape (for code-writing agents)
Every code-writing agent returns:
- Files written (paths + intent)
- Standards sections cited (e.g. "§6, §9.3, §11, §19.2")
- Invariants enforced (INV-XXX codes)
- Tests added (per §19.3)
- Open questions (must not exceed 5)
- A diff summary

---

## 29. Anti-patterns — explicit "do not"

- Do not write a service method that takes `tenantId: string` as a parameter — context only (§9.3).
- Do not catch exceptions just to log and rethrow — let the global filter handle it (§12.2).
- Do not introduce a new validation library, error library, ORM, state library, styling library, or component library (§1).
- Do not write SQL strings outside Prisma except in migrations (§8.3) and explicit reporting modules.
- Do not store money as a JS `number` or Postgres `float` (§8.6).
- Do not show confidence percentages to clients anywhere (INV-DISP-6).
- Do not allow a client to choose a date range or filing period (INV-CFG-5, INV-EXP-3).
- Do not silently drop a transaction the client said "no receipt" for — record the attestation (INV-ATT-1..3).
- Do not delete financial data on user action — audit-only, retention-governed (INV-AUDIT-3).
- Do not mix domain logic into controllers (§6).
- Do not mock Postgres with SQLite (§19.2).
- Do not commit `.env` files (§17).
- Do not log emails, business numbers, or document contents (§13).

---

*End of standards. v1.0. Locked baseline.*
