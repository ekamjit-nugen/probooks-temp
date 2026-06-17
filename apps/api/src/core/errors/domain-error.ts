/**
 * Abstract base for every business error (STANDARDS §12.1).
 *
 * Rules: NEVER `throw new Error(...)` for business cases — extend this. The
 * DomainExceptionFilter maps any DomainError to the §7.1 envelope.
 */
export abstract class DomainError extends Error {
  /** Stable, SCREAMING_SNAKE, documented (STANDARDS §7.1). */
  abstract readonly code: string;

  /** HTTP status to surface (STANDARDS §7.2). */
  abstract readonly httpStatus: number;

  /** Optional structured detail safe to return to the caller. */
  readonly details?: Record<string, unknown>;

  protected constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    if (details !== undefined) {
      this.details = details;
    }
    // Preserve prototype chain across transpilation target downleveling.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
