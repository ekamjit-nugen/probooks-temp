# ProBooks

Multi-firm SaaS bookkeeping/HST portal for Canadian accounting firms (CRA, HST, T2).
Three apps on one shared backend — see [`CLAUDE.md`](CLAUDE.md) for the full map.

## Prerequisites

- **Node 22 LTS** (`.nvmrc`) — `nvm use`
- **pnpm 9+** — `corepack enable`
- Docker (for Testcontainers: real Postgres + Redis in integration tests)

## Layout (STANDARDS §2)

```
apps/api            NestJS backend (Phase 0+)
packages/shared     Zod schemas, INV codes, branded types, period/HST math
packages/config     tsconfig base, ESLint (incl. @probooks/no-cross-tenant), Prettier
packages/test-utils Testcontainers helpers, factories, fixtures
infra               AWS CDK (ca-central-1) — Wave 7
docs                PRD, SPEC, STANDARDS, PROGRESS, ADRs, runbooks, security
```

Frontend apps (`platform-admin`, `firm-workspace`, `client-portal`) and
`packages/ui` / `api-client` arrive in Phase 1+.

## Commands

```bash
pnpm install         # install workspace
pnpm typecheck       # tsc --noEmit across packages
pnpm lint            # ESLint (multi-tenancy backstop enforced)
pnpm test            # Jest (api) + Vitest (shared)
pnpm build           # turbo build
```

## Working agreements

- Read order before any code: STANDARDS → PROGRESS → PRD (your phase) → SPEC.
- Phases ship one at a time; never advance silently (CLAUDE.md §4).
- Current state lives in [`PROGRESS.md`](PROGRESS.md). Current phase: **Phase 0 — Backend Spine**.
