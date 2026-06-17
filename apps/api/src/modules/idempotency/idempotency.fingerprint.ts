/**
 * Request fingerprinting for HTTP idempotency (STANDARDS §7.4).
 *
 * The fingerprint is a sha256 over the canonical (method + path + body) so that
 * "same key + same body" can be detected independent of JSON key order, and
 * "same key + different body" can be rejected with 409. We hash the body rather
 * than storing it: the raw request body may contain PII (emails, business
 * numbers) which we must never persist or log beyond what is required
 * (STANDARDS §13). The hash is sufficient for equality comparison.
 */
import { createHash } from "node:crypto";

/** Inputs that identify a request for idempotency purposes. */
export interface RequestFingerprintInput {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/**
 * Canonical JSON: object keys sorted recursively so semantically-equal bodies
 * serialize identically. Arrays keep order (order is significant in a list);
 * primitives serialize as JSON. `undefined` is normalized to null so it round
 * trips deterministically.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      out[k] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/**
 * Compute the stable fingerprint for a request. Deterministic, key-order
 * independent, and collision-resistant (sha256). The method is upper-cased and
 * the path included so the same body on different routes/verbs never collides.
 */
export function computeRequestFingerprint(
  input: RequestFingerprintInput,
): string {
  const canonical = JSON.stringify({
    method: input.method.toUpperCase(),
    path: input.path,
    body: canonicalize(input.body),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Hash of a stored response body — an integrity aid alongside the replay copy. */
export function computeResponseHash(body: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(body)), "utf8")
    .digest("hex");
}
