import { DomainError } from "./domain-error";
import {
  FlagAlreadyClearedError,
  ValidationFailedError,
} from "./example-errors";

describe("DomainError [STD-12]", () => {
  it("FlagAlreadyClearedError carries code, httpStatus and message", () => {
    const err = new FlagAlreadyClearedError("flag-123");

    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe("FLAG_ALREADY_CLEARED");
    expect(err.httpStatus).toBe(409);
    expect(err.message).toContain("flag-123");
  });

  it("ValidationFailedError carries per-field details and 400 status", () => {
    const err = new ValidationFailedError({ age: "must be >= 0" });

    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.httpStatus).toBe(400);
    expect(err.details).toEqual({ age: "must be >= 0" });
  });
});
