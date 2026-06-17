/**
 * Idempotency DomainErrors (STANDARDS §7.4, §12.1). Extend DomainError so the
 * DomainExceptionFilter maps them to the §7.1 envelope — never throw a raw Error
 * for these business cases (STANDARDS §29).
 */
import { DomainError } from "../../core/errors/domain-error";

/**
 * 409 — the same Idempotency-Key was reused with a DIFFERENT request body
 * (STANDARDS §7.4: "same key + different body → 409"). The key is bound to its
 * first request; a divergent body is a client bug, not a safe retry.
 */
export class IdempotencyKeyConflictError extends DomainError {
  readonly code = "IDEMPOTENCY_KEY_CONFLICT";
  readonly httpStatus = 409;

  constructor() {
    super(
      "This Idempotency-Key was already used with a different request body.",
    );
  }
}

/**
 * 409 — a request with this Idempotency-Key is still in flight (claimed but not
 * yet completed). We refuse to execute the handler a second time concurrently;
 * the client should retry after a short backoff, at which point it will replay
 * the stored response. This is the in-flight outcome of the Layer-3 atomic
 * claim (STANDARDS §15.2).
 */
export class IdempotencyRequestInProgressError extends DomainError {
  readonly code = "IDEMPOTENCY_REQUEST_IN_PROGRESS";
  readonly httpStatus = 409;

  constructor() {
    super(
      "A request with this Idempotency-Key is still being processed. Retry shortly.",
    );
  }
}

/**
 * 400 — the Idempotency-Key header was present but is not a UUID (STANDARDS
 * §7.4 requires a UUID). Validate before touching business logic (input
 * validation — never trust a raw header).
 */
export class IdempotencyKeyMalformedError extends DomainError {
  readonly code = "IDEMPOTENCY_KEY_MALFORMED";
  readonly httpStatus = 400;

  constructor() {
    super("The Idempotency-Key header must be a UUID.");
  }
}
