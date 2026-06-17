/**
 * Tests for the background-job three-layer idempotency contract (STANDARDS
 * §15.2; SPEC §5). Derived one-to-one from jobs/idempotency.feature. Pure +
 * seam-level — no Redis (queues are not wired in Phase 0).
 */
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  buildJobDedupeKey,
  DEFAULT_JOB_DEDUPE_TTL_MS,
  DEFAULT_JOB_LOCK_TTL_MS,
  JobIdempotencyContextSchema,
  JOB_DEDUPE_NAMESPACE,
  runIdempotentJob,
  type DedupeStore,
  type DistributedLock,
  type JobIdempotencyContext,
  type LockLease,
} from "./idempotency.js";

const TENANT = "11111111-1111-7111-8111-111111111111";

function ctx(over: Partial<JobIdempotencyContext> = {}): JobIdempotencyContext {
  return {
    queue: "extraction",
    tenantId: TENANT,
    entity: "period",
    entityId: "P-1",
    operation: "process",
    ...over,
  };
}

describe("buildJobDedupeKey [STD-15.2]", () => {
  it("derives the same key twice from the same context (deterministic)", () => {
    expect(buildJobDedupeKey(ctx())).toBe(buildJobDedupeKey(ctx()));
  });

  it("is independent of context property insertion order", () => {
    const a: JobIdempotencyContext = {
      queue: "extraction",
      tenantId: TENANT,
      entity: "period",
      entityId: "P-1",
      operation: "process",
    };
    const b: JobIdempotencyContext = {
      operation: "process",
      entityId: "P-1",
      entity: "period",
      tenantId: TENANT,
      queue: "extraction",
    };
    expect(buildJobDedupeKey(a)).toBe(buildJobDedupeKey(b));
  });

  it("yields a different key when entity id differs", () => {
    expect(buildJobDedupeKey(ctx({ entityId: "P-1" }))).not.toBe(
      buildJobDedupeKey(ctx({ entityId: "P-2" })),
    );
  });

  it("namespaces by queue + tenant (no bare global keys, §16)", () => {
    const key = buildJobDedupeKey(ctx());
    expect(key.startsWith(`${JOB_DEDUPE_NAMESPACE}:`)).toBe(true);
    expect(key).toContain("extraction");
    expect(key).toContain(TENANT);
    expect(key).toBe(`job:extraction:${TENANT}:period:P-1:process`);
  });

  it("rejects a malformed context (missing tenantId) via the schema", () => {
    const bad = {
      queue: "extraction",
      entity: "period",
      entityId: "P-1",
      operation: "process",
    };
    expect(() => JobIdempotencyContextSchema.parse(bad)).toThrow(ZodError);
    expect(() =>
      buildJobDedupeKey(bad as unknown as JobIdempotencyContext),
    ).toThrow(ZodError);
  });

  it("rejects a non-uuid tenantId", () => {
    expect(() => buildJobDedupeKey(ctx({ tenantId: "not-a-uuid" }))).toThrow(
      ZodError,
    );
  });
});

describe("runIdempotentJob orchestration [STD-15.2]", () => {
  function lease(): { lease: LockLease; release: ReturnType<typeof vi.fn> } {
    const release = vi.fn(() => Promise.resolve());
    return { lease: { release }, release };
  }

  function dedupeStore(fresh: boolean) {
    const setIfAbsent = vi.fn(() => Promise.resolve(fresh));
    return { store: { setIfAbsent } as DedupeStore, setIfAbsent };
  }

  function distLock(result: LockLease | null) {
    const acquire = vi.fn(() => Promise.resolve(result));
    return { lock: { acquire } as DistributedLock, acquire };
  }

  it("does NOT execute the critical section when L1 reports the key was seen", async () => {
    const { store } = dedupeStore(false);
    const { lock, acquire } = distLock(null);
    const critical = vi.fn(() => Promise.resolve("work"));

    const outcome = await runIdempotentJob(
      ctx(),
      { dedupe: store, lock },
      critical,
    );

    expect(outcome).toEqual({ status: "deduplicated" });
    expect(critical).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
  });

  it("returns contended (and does not run) when L2 cannot grant the lock", async () => {
    const { store } = dedupeStore(true);
    const { lock } = distLock(null);
    const critical = vi.fn(() => Promise.resolve("work"));

    const outcome = await runIdempotentJob(
      ctx(),
      { dedupe: store, lock },
      critical,
    );

    expect(outcome).toEqual({ status: "contended" });
    expect(critical).not.toHaveBeenCalled();
  });

  it("runs the critical section exactly once and releases the lock on first delivery", async () => {
    const { store } = dedupeStore(true);
    const l = lease();
    const { lock } = distLock(l.lease);
    const critical = vi.fn(() => Promise.resolve("did-work"));

    const outcome = await runIdempotentJob(
      ctx(),
      { dedupe: store, lock },
      critical,
    );

    expect(outcome).toEqual({ status: "executed", value: "did-work" });
    expect(critical).toHaveBeenCalledTimes(1);
    expect(l.release).toHaveBeenCalledTimes(1);
  });

  it("releases the lock even when the critical section throws", async () => {
    const { store } = dedupeStore(true);
    const l = lease();
    const { lock } = distLock(l.lease);
    const boom = new Error("L3 write failed");
    const critical = vi.fn(() => Promise.reject(boom));

    await expect(
      runIdempotentJob(ctx(), { dedupe: store, lock }, critical),
    ).rejects.toBe(boom);
    expect(l.release).toHaveBeenCalledTimes(1);
  });

  it("passes the configured TTLs to L1 and L2 (defaults aligned to §7.4 / 30s)", async () => {
    const { store, setIfAbsent } = dedupeStore(true);
    const l = lease();
    const { lock, acquire } = distLock(l.lease);

    await runIdempotentJob(ctx(), { dedupe: store, lock }, () =>
      Promise.resolve(undefined),
    );

    expect(setIfAbsent).toHaveBeenCalledWith(
      expect.any(String),
      DEFAULT_JOB_DEDUPE_TTL_MS,
    );
    expect(acquire).toHaveBeenCalledWith(
      expect.any(String),
      DEFAULT_JOB_LOCK_TTL_MS,
    );
  });
});
