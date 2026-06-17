/**
 * W3C Trace Context propagation (STANDARDS §14 — trace IDs propagated via the
 * `traceparent` header). Pure parsing + generation; the OpenTelemetry SDK that
 * will create real spans is deferred (no OTel collector in Phase 0), but the
 * header contract is honoured NOW so traces are continuous once the SDK lands
 * and so frontends can correlate (§14).
 *
 * traceparent = `<version>-<trace-id>-<parent-id>-<flags>`
 *   version   2 hex   (we emit "00")
 *   trace-id 32 hex   (not all zeroes)
 *   parent-id 16 hex  (not all zeroes)
 *   flags     2 hex
 */
import { randomBytes } from "node:crypto";

export interface TraceContext {
  readonly version: string;
  readonly traceId: string;
  readonly parentId: string;
  readonly flags: string;
}

const TRACEPARENT_RE =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

const ALL_ZERO_TRACE = "0".repeat(32);
const ALL_ZERO_PARENT = "0".repeat(16);

/** Parse + validate a traceparent header. Returns null when absent/malformed. */
export function parseTraceparent(
  header: string | undefined,
): TraceContext | null {
  if (header === undefined) {
    return null;
  }
  const match = TRACEPARENT_RE.exec(header.trim());
  if (match === null) {
    return null;
  }
  const [, version, traceId, parentId, flags] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  // A trace-id / parent-id of all zeroes is invalid per the spec.
  if (traceId === ALL_ZERO_TRACE || parentId === ALL_ZERO_PARENT) {
    return null;
  }
  return { version, traceId, parentId, flags };
}

/** Serialize a TraceContext back to a traceparent header value. */
export function formatTraceparent(ctx: TraceContext): string {
  return `${ctx.version}-${ctx.traceId}-${ctx.parentId}-${ctx.flags}`;
}

/** Hex string of `bytes` random bytes (2 hex chars per byte). */
function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * Derive the trace context for a request: continue the incoming trace (new child
 * span id) when a valid traceparent arrived, else start a fresh root trace.
 */
export function deriveTraceContext(incoming: string | undefined): TraceContext {
  const parsed = parseTraceparent(incoming);
  if (parsed !== null) {
    // Continue the trace; this hop is a new span (new parent-id for children).
    return { ...parsed, parentId: randomHex(8) };
  }
  return {
    version: "00",
    traceId: randomHex(16),
    parentId: randomHex(8),
    flags: "01", // sampled
  };
}
