/**
 * IdempotencyService (STANDARDS §7.4, §6). Orchestrates the request lifecycle on
 * top of the tenant-scoped repository:
 *
 *   begin(key, fingerprint)
 *     → "claimed"  : caller runs the handler, then calls complete()/release()
 *     → "replay"   : caller returns the stored response (no handler run)
 *     → throws IdempotencyKeyConflictError      (409, same key + different body)
 *     → throws IdempotencyRequestInProgressError (409, duplicate still in flight)
 *
 * The service never touches Prisma directly — only the repository (STANDARDS §6).
 * "now" comes from the injected clock so TTL is deterministic in tests (§8.7).
 */
import { Inject, Injectable } from "@nestjs/common";

import {
  IDEMPOTENCY_CLOCK,
  IDEMPOTENCY_TTL_MS,
  type IdempotencyClock,
} from "./idempotency.clock";
import {
  IdempotencyKeyConflictError,
  IdempotencyRequestInProgressError,
} from "./idempotency.errors";
import { computeResponseHash } from "./idempotency.fingerprint";
import { IdempotencyRepository } from "./idempotency.repository";
import type {
  BeginInput,
  BeginOutcome,
  CompleteInput,
} from "./idempotency.types";

@Injectable()
export class IdempotencyService {
  constructor(
    private readonly repository: IdempotencyRepository,
    @Inject(IDEMPOTENCY_CLOCK) private readonly clock: IdempotencyClock,
  ) {}

  /**
   * Begin an idempotent request. See class doc for outcomes. A different body on
   * a known key is ALWAYS a conflict (regardless of in-progress/completed) — the
   * key is bound to its first request.
   */
  async begin(input: BeginInput): Promise<BeginOutcome> {
    const expiresAt = new Date(this.clock().getTime() + IDEMPOTENCY_TTL_MS);
    const result = await this.repository.claim(
      input.key,
      input.fingerprint,
      expiresAt,
    );

    if (result.kind === "claimed") {
      return { outcome: "claimed" };
    }

    // A live row exists. Different body for the same key → 409 (STANDARDS §7.4).
    if (result.requestFingerprint !== input.fingerprint) {
      throw new IdempotencyKeyConflictError();
    }

    // Same body. If the first request already completed, replay its response.
    if (result.state === "completed" && result.responseStatus !== null) {
      return {
        outcome: "replay",
        response: {
          status: result.responseStatus,
          body: result.responseBody,
        },
      };
    }

    // Same body, still in flight → refuse a concurrent second execution (409).
    throw new IdempotencyRequestInProgressError();
  }

  /** Store the successful response so a repeat request replays it. */
  async complete(input: CompleteInput): Promise<void> {
    const expiresAt = new Date(this.clock().getTime() + IDEMPOTENCY_TTL_MS);
    await this.repository.complete(
      input.key,
      input.fingerprint,
      input.response,
      computeResponseHash(input.response.body),
      expiresAt,
    );
  }

  /** Drop a claimed key after a handler failure so a retry can re-claim it. */
  async release(key: string, fingerprint: string): Promise<void> {
    await this.repository.release(key, fingerprint);
  }
}
