/**
 * Unit tests for IdempotencyService (STANDARDS §7.4). Derived from the
 * service/repository scenarios in idempotency.feature. The repository is mocked;
 * the real atomic-claim-over-RLS behaviour is proven in idempotency.e2e.spec.ts.
 */
import { IDEMPOTENCY_TTL_MS, type IdempotencyClock } from "./idempotency.clock";
import {
  IdempotencyKeyConflictError,
  IdempotencyRequestInProgressError,
} from "./idempotency.errors";
import { IdempotencyRepository } from "./idempotency.repository";
import { IdempotencyService } from "./idempotency.service";
import type { ClaimResult, StoredResponse } from "./idempotency.types";

describe("IdempotencyService [STD-7.4]", () => {
  const NOW = new Date("2026-06-08T12:00:00.000Z");
  const clock: IdempotencyClock = () => NOW;
  const KEY = "11111111-1111-7111-8111-111111111111";
  const FP = "fingerprint-of-body-1";

  function make(claimResult: ClaimResult) {
    const claim = jest.fn<Promise<ClaimResult>, [string, string, Date]>(() =>
      Promise.resolve(claimResult),
    );
    const complete = jest.fn<
      Promise<void>,
      [string, string, StoredResponse, string, Date]
    >(() => Promise.resolve());
    const release = jest.fn<Promise<void>, [string, string]>(() =>
      Promise.resolve(),
    );
    const repo = {
      claim,
      complete,
      release,
    } as unknown as IdempotencyRepository;
    const service = new IdempotencyService(repo, clock);
    return { claim, complete, release, service };
  }

  it("returns 'claimed' for a fresh key and passes a 24h expiry to the repo", async () => {
    const { claim, service } = make({ kind: "claimed" });

    const outcome = await service.begin({ key: KEY, fingerprint: FP });

    expect(outcome).toEqual({ outcome: "claimed" });
    const expiresAt = claim.mock.calls[0]?.[2] as Date;
    expect(expiresAt.getTime()).toBe(NOW.getTime() + IDEMPOTENCY_TTL_MS);
  });

  it("replays the stored response for a completed key with the SAME body", async () => {
    const { service } = make({
      kind: "existing",
      state: "completed",
      requestFingerprint: FP,
      responseStatus: 201,
      responseBody: { id: "x" },
    });

    const outcome = await service.begin({ key: KEY, fingerprint: FP });

    expect(outcome).toEqual({
      outcome: "replay",
      response: { status: 201, body: { id: "x" } },
    });
  });

  it("[§7.4] throws 409 conflict for a known key with a DIFFERENT body (completed)", async () => {
    const { service } = make({
      kind: "existing",
      state: "completed",
      requestFingerprint: "fingerprint-of-body-OTHER",
      responseStatus: 201,
      responseBody: { id: "x" },
    });

    await expect(
      service.begin({ key: KEY, fingerprint: FP }),
    ).rejects.toBeInstanceOf(IdempotencyKeyConflictError);
  });

  it("[§7.4] throws 409 conflict for a DIFFERENT body even while in progress", async () => {
    const { service } = make({
      kind: "existing",
      state: "in_progress",
      requestFingerprint: "fingerprint-of-body-OTHER",
      responseStatus: null,
      responseBody: null,
    });

    await expect(
      service.begin({ key: KEY, fingerprint: FP }),
    ).rejects.toBeInstanceOf(IdempotencyKeyConflictError);
  });

  it("throws 409 in-progress for the SAME body still in flight", async () => {
    const { service } = make({
      kind: "existing",
      state: "in_progress",
      requestFingerprint: FP,
      responseStatus: null,
      responseBody: null,
    });

    await expect(
      service.begin({ key: KEY, fingerprint: FP }),
    ).rejects.toBeInstanceOf(IdempotencyRequestInProgressError);
  });

  it("complete() forwards the response + a refreshed expiry to the repo", async () => {
    const { complete, service } = make({ kind: "claimed" });

    await service.complete({
      key: KEY,
      fingerprint: FP,
      response: { status: 201, body: { id: "x" } },
    });

    expect(complete).toHaveBeenCalledTimes(1);
    const [key, fp, response, , expiresAt] = complete.mock.calls[0] as [
      string,
      string,
      { status: number; body: unknown },
      string,
      Date,
    ];
    expect(key).toBe(KEY);
    expect(fp).toBe(FP);
    expect(response).toEqual({ status: 201, body: { id: "x" } });
    expect(expiresAt.getTime()).toBe(NOW.getTime() + IDEMPOTENCY_TTL_MS);
  });

  it("release() delegates to the repo (failures are not cached)", async () => {
    const { release, service } = make({ kind: "claimed" });

    await service.release(KEY, FP);

    expect(release).toHaveBeenCalledWith(KEY, FP);
  });
});
