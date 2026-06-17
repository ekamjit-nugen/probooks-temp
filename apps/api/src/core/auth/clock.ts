/**
 * Clock seam (STANDARDS §8.7 spirit; testability). The token service reads "now"
 * through this so expiry is deterministic in tests. Default binding is the
 * system clock; tests inject a controllable function.
 */
export type Clock = () => number;

/** Current time in epoch SECONDS (JWT iat/exp unit). */
export const systemClockSeconds: Clock = () => Math.floor(Date.now() / 1000);

/** DI token for the injectable clock. */
export const CLOCK = Symbol("CLOCK");
