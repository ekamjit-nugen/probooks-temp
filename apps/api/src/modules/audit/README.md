# audit — append-only audit log with hash chaining

> Domain summary, public service API, owned tables, invariants enforced
> (STANDARDS §26.1). Phase 0, Wave 4.

## What it is

The tamper-evident system of record for every state transition. Each entry
captures **who** (actor user id + role, from `TenantContext`), **what** (a dotted
action + entity type + entity id), **when** (`occurredAt`), and **before → after**
JSON snapshots. Entries are append-only at two layers: there is no update/delete
method on the repository, and the `app_user` (and `service_role`) DB roles lack
`UPDATE`/`DELETE` on `audit_log` (grant set in migration `20260604120200`).

## Public service API

```ts
// Record one transition. Pass the parent `tx` to make the audit write atomic
// with the parent state change (INV-AUDIT-1); omit it for a standalone write.
auditService.record(input: RecordAuditInput, tx?: TenantTxClient): Promise<RecordedAuditEntry>

// Walk the current tenant's chain; throws AuditChainTamperError at the first
// broken position (INV-AUDIT-2), resolves when intact.
auditService.verify(): Promise<void>

// Helper: open a tenant-bound tx so a caller can do its own writes + record(..., tx)
// atomically without importing PrismaService.
auditTransactionRunner.run(work: (tx) => Promise<T>): Promise<T>
```

`who` is always read from `TenantContext`, never accepted from the caller, so an
action cannot be misattributed.

## The hash chain

Each entry stores `entry_hash = sha256(canonical(fields))` where `fields`
includes the per-tenant monotonic `position`, the predecessor's `prev_hash`, and
all of who/what/when/before→after. `canonical()` sorts object keys recursively so
the hash is reproducible from inputs (INV-FIN-8 spirit). The first entry links to
a fixed non-zero `GENESIS_PREV_HASH`.

Detection (replayed by `verifyChain`, ascending `position`):

| Tamper           | How it is caught                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| Field mutation   | recomputed `entry_hash` ≠ stored `entry_hash` → `entry-hash-mismatch`                             |
| Middle deletion  | position skips a value (`position-gap`) / next `prev_hash` no longer links (`prev-hash-mismatch`) |
| Reorder / insert | `prev_hash` linkage and/or position sequence break                                                |

## Concurrency

`append` is serialized per tenant by `pg_advisory_xact_lock` keyed on the tenant
id (transaction-scoped — auto-released at COMMIT/ROLLBACK). Two concurrent
appenders cannot read the same chain head, so the chain cannot fork. The
`UNIQUE (tenant_id, position)` constraint is the layer-3 correctness backstop
(STANDARDS §15.2) if anything ever raced past the lock.

## Owned tables

- `audit_log` — append-only; columns + RLS in `20260604120100` / `20260604120200`;
  hash-chain columns (`position`, `prev_hash`, `entry_hash`, `actor_role`,
  `occurred_at`) added in `20260605120000`.

## Invariants enforced

- **INV-AUDIT-1** — every transition writes who/what/when/before→after; the write
  is atomic with the parent transaction (proven by rollback/commit e2e tests).
- **INV-AUDIT-2** — entries are write-once and tamper-evident; the verifier
  detects mutation, deletion, and reordering.
- **INV-AUDIT-3** — no destructive deletes: no update/delete path exists in code,
  and the DB roles cannot `UPDATE`/`DELETE` the table.
- Tenant isolation (INV-TEN-1) — reads run under RLS as `app_user`; one tenant's
  verifier never sees another's entries.
