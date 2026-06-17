# Idempotency module (Wave 5)

HTTP idempotency for state-creating POSTs — **STANDARDS §7.4**. Plus the
background-job three-layer pattern contract lives in `packages/shared`
(`jobs/idempotency.ts`, **STANDARDS §15.2**); Redis/BullMQ are not wired in
Phase 0 so that side ships as typed, tested scaffolding only.

## What it does

A POST route opts in with `@Idempotent()` and `@UseInterceptors(IdempotencyInterceptor)`.
The interceptor then, for requests carrying an `Idempotency-Key` header (a UUID):

| Situation                             | Result                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------- |
| No header                             | Pass through — header is **optional** (§7.4).                               |
| Malformed key (not a UUID)            | `400 IDEMPOTENCY_KEY_MALFORMED`.                                            |
| Fresh key                             | Run the handler **once**, store `(status, body)`, return it.                |
| Same key + **same** body, completed   | Replay the stored response — handler does **not** run again.                |
| Same key + **different** body         | `409 IDEMPOTENCY_KEY_CONFLICT` (§7.4).                                      |
| Same key + same body, still in flight | `409 IDEMPOTENCY_REQUEST_IN_PROGRESS`.                                      |
| Row past `expires_at` (24h, §7.4)     | Treated as absent → re-claimed.                                             |
| Handler throws                        | Key is **released** (deleted) — failures are not cached; a retry re-claims. |

## How it is correct under concurrency

`IdempotencyRepository.claim` is a single atomic
`INSERT ... ON CONFLICT (tenant_id, key) DO UPDATE ... WHERE expires_at < now()`.
This is **Layer 3** of the three-layer pattern (§15.2) — the DB uniqueness
constraint is the correctness backstop. Two concurrent requests with the same
key serialise on the unique index: exactly one wins the claim and runs the
handler; the other observes the live row and either replays or is told the first
is in progress. Proven against real Postgres 16 in `idempotency.e2e.spec.ts`
(`two concurrent same-key requests run the handler AT MOST once`).

## Tenancy & privacy

- The repository reads the tenant from `TenantContext` (never a parameter,
  §9.3) and runs through `PrismaService.runInTenantTx`, so **RLS** isolates keys
  per firm — the _same key string_ in two tenants is independent (INV-TEN-1,
  proven in the e2e suite).
- We store a **fingerprint** (sha256 of method+path+body), not the raw request
  body — the body may carry PII (§13). The stored _response_ body is kept for
  replay; it is tenant-scoped and RLS-protected, and is never logged.

## Schema

`idempotency_keys` was a stub (`response_hash` only). Migration
`20260608120000_idempotency_request_response` adds `request_fingerprint`,
`state` (`in_progress`→`completed`, CHECK-constrained), `response_status`,
`response_body`, and relaxes `response_hash` to nullable. Backward-compatible:
the table is empty in every environment, new columns are nullable/defaulted, and
the existing `UNIQUE (tenant_id, key)` (the Layer-3 backstop) is retained. RLS +
grants from `20260604120200_rls_and_roles` already cover the new columns.

## Files

| File                         | Role                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `idempotency.feature`        | Gherkin use cases (all modules).                                                             |
| `idempotency.fingerprint.ts` | Pure: canonical sha256 request fingerprint + response hash.                                  |
| `idempotency.errors.ts`      | `DomainError`s: conflict / in-progress (409), malformed (400).                               |
| `idempotency.clock.ts`       | Injectable clock + `IDEMPOTENCY_TTL_MS` (24h).                                               |
| `idempotency.types.ts`       | Shared vocabulary (claim result, outcomes).                                                  |
| `idempotency.repository.ts`  | Tenant-scoped atomic claim / complete / release over RLS.                                    |
| `idempotency.service.ts`     | Lifecycle + replay/conflict/in-progress decisions.                                           |
| `idempotency.decorator.ts`   | `@Idempotent()` + header constant.                                                           |
| `idempotency.interceptor.ts` | HTTP wiring; ALS re-binding across the RxJS boundary.                                        |
| `idempotency.module.ts`      | DI wiring; exports service + interceptor.                                                    |
| `idempotency.e2e.spec.ts`    | Real-Postgres integration: service↔repo over RLS **and** the full HTTP stack via supertest. |

The module is exported but not yet imported into `AppModule` — like the audit
domain, it lands ahead of the Phase-1 controllers that will apply it.
