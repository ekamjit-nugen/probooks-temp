/**
 * PII redaction configuration (STANDARDS §13, INV-AUDIT-4 spirit).
 *
 * Emails, business numbers, names and document contents must never appear in
 * logs. Pino's `redact` replaces matched paths with `[REDACTED]`. We cover both
 * top-level keys and the common nesting points (req/res/payload/context) since
 * pino redact paths are not recursive by default.
 */

/** The censor token written in place of PII (STANDARDS §13). */
export const REDACTION_CENSOR = "[REDACTED]";

/** PII field names to scrub wherever they appear. */
const PII_FIELDS = [
  "email",
  "emailAddress",
  "businessNumber",
  "name",
  "firstName",
  "lastName",
  "fullName",
  "documentContents",
  "sin",
] as const;

/** Common containers PII may be nested under in a log line. */
const CONTAINERS = [
  "req",
  "res",
  "request",
  "response",
  "payload",
  "context",
  "body",
] as const;

/**
 * Build the flat list of pino redact paths: each PII field both at top level and
 * one level under each known container (e.g. `email` and `req.email`).
 */
function buildPaths(): string[] {
  const paths: string[] = [];
  for (const field of PII_FIELDS) {
    paths.push(field);
    paths.push(`*.${field}`);
    for (const container of CONTAINERS) {
      paths.push(`${container}.${field}`);
    }
  }
  return Array.from(new Set(paths));
}

/** Frozen path list (also consumed directly by tests). */
export const REDACTION_PATHS: readonly string[] = Object.freeze(buildPaths());

/** Pino `redact` option object. */
export function buildRedaction(): { paths: string[]; censor: string } {
  return { paths: [...REDACTION_PATHS], censor: REDACTION_CENSOR };
}
