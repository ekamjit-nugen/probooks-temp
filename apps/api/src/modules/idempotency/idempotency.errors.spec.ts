/**
 * Unit tests for idempotency DomainErrors (STANDARDS §7.4, §12.1). They must
 * extend DomainError (so the filter maps them to the §7.1 envelope) and carry
 * the documented codes + statuses.
 */
import { DomainError } from "../../core/errors/domain-error";

import {
  IdempotencyKeyConflictError,
  IdempotencyKeyMalformedError,
  IdempotencyRequestInProgressError,
} from "./idempotency.errors";

describe("idempotency errors [STD-7.4][STD-12.1]", () => {
  it("IdempotencyKeyConflictError is a 409 with a stable code", () => {
    const err = new IdempotencyKeyConflictError();
    expect(err).toBeInstanceOf(DomainError);
    expect(err.httpStatus).toBe(409);
    expect(err.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
  });

  it("IdempotencyRequestInProgressError is a 409 with a stable code", () => {
    const err = new IdempotencyRequestInProgressError();
    expect(err).toBeInstanceOf(DomainError);
    expect(err.httpStatus).toBe(409);
    expect(err.code).toBe("IDEMPOTENCY_REQUEST_IN_PROGRESS");
  });

  it("IdempotencyKeyMalformedError is a 400 with a stable code", () => {
    const err = new IdempotencyKeyMalformedError();
    expect(err).toBeInstanceOf(DomainError);
    expect(err.httpStatus).toBe(400);
    expect(err.code).toBe("IDEMPOTENCY_KEY_MALFORMED");
  });
});
