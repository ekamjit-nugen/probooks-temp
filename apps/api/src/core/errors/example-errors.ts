/**
 * Concrete DomainError examples (STANDARDS §12.1). They exercise the filter and
 * model the two shapes domains will reuse: a simple conflict and a
 * details-bearing validation failure. Domain-specific errors live with their
 * domains (STANDARDS §6); these are foundation examples + the shared
 * VALIDATION_FAILED type the validation pipe throws.
 */
import { DomainError } from "./domain-error";

/** 409 conflict example (STANDARDS §7.2, mirrors STANDARDS §12.1 sample). */
export class FlagAlreadyClearedError extends DomainError {
  readonly code = "FLAG_ALREADY_CLEARED";
  readonly httpStatus = 409;

  constructor(public readonly flagId: string) {
    super(`Flag ${flagId} already cleared`);
  }
}

/**
 * 400 validation failure carrying per-field messages (STANDARDS §11, §7.1).
 * Thrown by the ZodValidationPipe; reused anywhere semantic validation fails.
 */
export class ValidationFailedError extends DomainError {
  readonly code = "VALIDATION_FAILED";
  readonly httpStatus = 400;

  constructor(fieldErrors: Record<string, string>) {
    super("Validation failed", { ...fieldErrors });
  }
}
