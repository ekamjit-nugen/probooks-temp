/**
 * API response envelope (STANDARDS §7.1). Shared so backend and frontend agree
 * on one shape. Zero runtime deps beyond Zod (STANDARDS §2).
 *
 * Success: { data, meta: { requestId, version } }
 * Error:   { error: { code, message, details?, requestId } }
 */
import { z } from "zod";

/** API version string, URL-versioned (STANDARDS §7.5). */
export const API_VERSION = "v1";

/** Stable, SCREAMING_SNAKE error codes (STANDARDS §7.1). Extend as domains land. */
export const ErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/, {
  message: "Error codes are SCREAMING_SNAKE_CASE.",
});

/** The error half of the envelope (STANDARDS §7.1). */
export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string().min(1),
    details: z.record(z.unknown()).optional(),
    requestId: z.string().min(1),
  }),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

/** Meta block carried on every successful response (STANDARDS §7.1). */
export const ResponseMetaSchema = z.object({
  requestId: z.string().min(1),
  version: z.literal(API_VERSION),
});

export type ResponseMeta = z.infer<typeof ResponseMetaSchema>;

/**
 * Build the success envelope around a payload. Generic over the payload type so
 * callers keep their own typing.
 */
export function successEnvelope<T>(
  data: T,
  meta: ResponseMeta,
): { data: T; meta: ResponseMeta } {
  return { data, meta };
}

/** Build the §7.1 error envelope from its parts. */
export function errorEnvelope(input: {
  code: string;
  message: string;
  requestId: string;
  details?: Record<string, unknown>;
}): ErrorEnvelope {
  const error: ErrorEnvelope["error"] = {
    code: input.code,
    message: input.message,
    requestId: input.requestId,
  };
  if (input.details !== undefined) {
    error.details = input.details;
  }
  return { error };
}
