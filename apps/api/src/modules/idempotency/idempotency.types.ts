/**
 * Shared types for the idempotency domain (STANDARDS §7.4). Kept in their own
 * module so the repository, service and interceptor share one vocabulary.
 */

/** A stored response that gets replayed verbatim on a repeat request. */
export interface StoredResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * The raw result of the repository's atomic claim: either THIS caller won the
 * claim (may run the handler), or a row already exists and we report its state.
 */
export type ClaimResult =
  | { readonly kind: "claimed" }
  | {
      readonly kind: "existing";
      readonly state: "in_progress" | "completed";
      readonly requestFingerprint: string;
      readonly responseStatus: number | null;
      readonly responseBody: unknown;
    };

/**
 * The service's decision for the interceptor: run the handler, replay a stored
 * response, or (via a thrown DomainError) reject as conflict / in-progress.
 */
export type BeginOutcome =
  | { readonly outcome: "claimed" }
  | { readonly outcome: "replay"; readonly response: StoredResponse };

/** Inputs to begin an idempotent request. */
export interface BeginInput {
  readonly key: string;
  readonly fingerprint: string;
}

/** Inputs to complete a claimed request with its response. */
export interface CompleteInput {
  readonly key: string;
  readonly fingerprint: string;
  readonly response: StoredResponse;
}
