/**
 * Injectable clock for the idempotency domain (STANDARDS §8.7 — app time goes
 * through a seam, never a bare `new Date()` scattered in logic). Lets tests pin
 * "now" so TTL/expiry behaviour is deterministic.
 */
export type IdempotencyClock = () => Date;

/** DI token for the clock. */
export const IDEMPOTENCY_CLOCK = Symbol("IDEMPOTENCY_CLOCK");

/** Production clock — the real wall clock. */
export const systemIdempotencyClock: IdempotencyClock = () => new Date();

/**
 * Idempotency record TTL — 24h (STANDARDS §7.4: "Backend stores … for 24h").
 * A single named constant, not a magic number sprinkled through the code.
 */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
