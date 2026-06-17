/**
 * Background-job idempotency — the three-layer pattern (STANDARDS §15.2; SPEC §5).
 *
 * Every state-changing BullMQ job must be safe under at-least-once delivery and
 * retries (never double-process a period / double-count a document). The defence
 * is three composed layers:
 *
 *   Layer 1 — Redis SETNX on a job dedupe key      (cheap, fast reject of dups)
 *   Layer 2 — Redlock around the critical section  (cross-instance exclusion)
 *   Layer 3 — DB uniqueness / atomic upsert         (correctness backstop)
 *
 * Redis 7 + BullMQ 5 are part of the locked stack (STANDARDS §1.1) but are NOT
 * wired in Phase 0 — no queues run yet. This module therefore ships the parts
 * that are real and testable today:
 *   - `buildJobDedupeKey` — deterministic, order-independent, namespaced key
 *     derivation (Layers 1 & 2 both key off this);
 *   - `JobIdempotencyContextSchema` — the Zod contract for a job's identity;
 *   - typed SEAMS (`DedupeStore`, `DistributedLock`) where Redis/Redlock plug in;
 *   - `runIdempotentJob` — the orchestration contract that composes L1→L2→L3.
 *
 * The HTTP-request analogue (Idempotency-Key header → idempotency_keys table) is
 * a SEPARATE concern implemented in apps/api (STANDARDS §7.4). This file is the
 * job-side pattern only. Zero runtime deps beyond Zod (STANDARDS §2).
 */
import { z } from "zod";

/** Namespace prefix for every job dedupe key — never a bare global key (§16). */
export const JOB_DEDUPE_NAMESPACE = "job";

/**
 * The identity of a unit of job work. Two deliveries that share this identity
 * are the SAME logical operation and must collapse to a single execution.
 *
 * - `queue`     — the BullMQ queue name (§15.1); part of the namespace.
 * - `tenantId`  — always present (§9.5, §15.4); jobs never run tenant-blind.
 * - `entity`    — the kind of thing acted on (e.g. "period", "document").
 * - `entityId`  — its id.
 * - `operation` — what is being done (e.g. "process", "extract", "compute").
 */
export const JobIdempotencyContextSchema = z
  .object({
    queue: z.string().min(1),
    tenantId: z.string().uuid(),
    entity: z.string().min(1),
    entityId: z.string().min(1),
    operation: z.string().min(1),
  })
  .strict();

export type JobIdempotencyContext = z.infer<typeof JobIdempotencyContextSchema>;

/**
 * Derive the deterministic dedupe key for a job context. The key is:
 *   - **namespaced** by queue + tenant so two tenants (or two queues) never
 *     collide on a shared key (STANDARDS §16 — no bare global keys);
 *   - **order-independent** — the same field values always yield the same key
 *     regardless of object construction order;
 *   - **stable** — pure function of the context, safe to recompute on every
 *     delivery for SETNX (L1) and Redlock (L2).
 *
 * Shape: `job:<queue>:<tenantId>:<entity>:<entityId>:<operation>`.
 * Validates the context first (throws ZodError on a malformed context) so a job
 * can never be enqueued without a tenant or identity.
 */
export function buildJobDedupeKey(context: JobIdempotencyContext): string {
  const parsed = JobIdempotencyContextSchema.parse(context);
  return [
    JOB_DEDUPE_NAMESPACE,
    parsed.queue,
    parsed.tenantId,
    parsed.entity,
    parsed.entityId,
    parsed.operation,
  ].join(":");
}

/**
 * Layer 1 seam — Redis SETNX. `setIfAbsent` atomically sets `key` with a TTL iff
 * it is absent, returning true when THIS caller set it (i.e. the work is fresh)
 * and false when the key already existed (a duplicate delivery). Backed by Redis
 * `SET key val NX PX <ttl>` when queues land; a no-op/in-memory impl is fine for
 * tests.
 */
export interface DedupeStore {
  setIfAbsent(key: string, ttlMs: number): Promise<boolean>;
}

/** A held lock lease (Layer 2). Released exactly once in a finally block. */
export interface LockLease {
  release(): Promise<void>;
}

/**
 * Layer 2 seam — Redlock. `acquire` returns a lease when the lock was granted,
 * or null when another instance currently holds it. Backed by Redlock over the
 * Redis cluster when queues land.
 */
export interface DistributedLock {
  acquire(key: string, ttlMs: number): Promise<LockLease | null>;
}

/** Tunables for the three-layer run. Defaults are conservative; override per queue. */
export interface JobIdempotencyOptions {
  /** L1 dedupe-key TTL. Default 24h — matches the HTTP idempotency window (§7.4). */
  readonly dedupeTtlMs?: number;
  /** L2 lock lease TTL. Default 30s — long enough for a critical section, auto-expiring. */
  readonly lockTtlMs?: number;
}

/** L1 dedupe window default — 24h, aligned with STANDARDS §7.4. */
export const DEFAULT_JOB_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
/** L2 lock lease default — 30s; the critical section must out-pace this. */
export const DEFAULT_JOB_LOCK_TTL_MS = 30 * 1000;

/** The outcome of an idempotent job run. */
export type JobRunOutcome =
  /** L1/L2 collapsed a duplicate; the critical section did not run. */
  | { readonly status: "deduplicated" }
  /** The critical section ran to completion; its value is returned. */
  | { readonly status: "executed"; readonly value: unknown }
  /** L2 lock was held by another instance; caller should retry/backoff. */
  | { readonly status: "contended" };

/**
 * The orchestration contract — compose Layers 1→2→3 for one job delivery.
 *
 * Flow:
 *   1. L1 SETNX the dedupe key. If the key already existed → `deduplicated`
 *      (a prior delivery already owns this work). Cheapest possible reject.
 *   2. L2 acquire the Redlock. If not granted → `contended` (a sibling instance
 *      is mid-flight); the caller backs off and the queue redelivers.
 *   3. Run `criticalSection`, whose final act is the L3 DB atomic upsert /
 *      unique-constraint write that makes double-processing impossible even if
 *      L1+L2 were both somehow bypassed. Release the lock in `finally`.
 *
 * `criticalSection` MUST itself perform the Layer-3 write (see apps/api
 * repositories: `INSERT ... ON CONFLICT` / unique `(tenant_id, …)`); this
 * function guarantees the surrounding L1/L2 discipline, not the DB write.
 */
export async function runIdempotentJob(
  context: JobIdempotencyContext,
  layers: { readonly dedupe: DedupeStore; readonly lock: DistributedLock },
  criticalSection: () => Promise<unknown>,
  options: JobIdempotencyOptions = {},
): Promise<JobRunOutcome> {
  const key = buildJobDedupeKey(context);
  const dedupeTtlMs = options.dedupeTtlMs ?? DEFAULT_JOB_DEDUPE_TTL_MS;
  const lockTtlMs = options.lockTtlMs ?? DEFAULT_JOB_LOCK_TTL_MS;

  // Layer 1 — cheap dedupe. A pre-existing key means a sibling already owns it.
  const fresh = await layers.dedupe.setIfAbsent(key, dedupeTtlMs);
  if (!fresh) {
    return { status: "deduplicated" };
  }

  // Layer 2 — cross-instance mutual exclusion around the critical section.
  const lease = await layers.lock.acquire(key, lockTtlMs);
  if (lease === null) {
    return { status: "contended" };
  }

  try {
    // Layer 3 lives INSIDE the critical section (DB atomic upsert / unique key).
    const value = await criticalSection();
    return { status: "executed", value };
  } finally {
    await lease.release();
  }
}
