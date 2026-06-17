/**
 * Error-reporting seam (STANDARDS §12.2, §14). Unknown 500s are reported here;
 * the Sentry-backed implementation lands with observability (Wave 6). Interface
 * only for now so the filter has a clean dependency.
 */
import { Injectable } from "@nestjs/common";

export interface ErrorReporter {
  /** Report an unexpected error to the monitoring backend (Sentry, Wave 6). */
  report(error: unknown): void;
}

/** DI token for the active ErrorReporter. */
export const ERROR_REPORTER = Symbol("ERROR_REPORTER");

/**
 * No-op reporter for Phase 0. Replaced by a Sentry-backed reporter in Wave 6.
 * Deliberately silent (no console — STANDARDS §13); structured logging of 5xx
 * happens in the logging layer.
 */
@Injectable()
export class NoopErrorReporter implements ErrorReporter {
  report(error: unknown): void {
    // Intentionally a no-op until the Sentry reporter lands (Wave 6). The param
    // is referenced to satisfy strict unused-var lint without suppression.
    void error;
  }
}
