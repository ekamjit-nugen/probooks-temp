/**
 * RequestIdMiddleware (STANDARDS §13/§14). Establishes the correlation context
 * at the very edge of every request:
 *   - requestId — accepted from a trusted `x-request-id` header (sanitised) or
 *     generated; attached to `req.requestId` (the DomainExceptionFilter reads it
 *     into the §7.1 envelope — this CLOSES the Wave-2 seam) and echoed on the
 *     response so callers can correlate.
 *   - traceparent — continued or started per W3C Trace Context (§14) and echoed,
 *     so a trace is unbroken across services and into the frontends.
 *
 * Runs before guards/interceptors (middleware is the outermost layer), so the id
 * is present for the entire lifecycle including error handling.
 */
import { randomUUID } from "node:crypto";

import { Injectable, type NestMiddleware } from "@nestjs/common";

import {
  deriveTraceContext,
  formatTraceparent,
  type TraceContext,
} from "./trace-context";

/** Accept a caller-supplied id only if it is safe + bounded (no injection). */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,200}$/;

export interface CorrelatedRequest {
  headers: Record<string, string | string[] | undefined>;
  requestId?: string;
  traceContext?: TraceContext;
}

export interface CorrelatedResponse {
  setHeader(name: string, value: string): void;
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: CorrelatedRequest, res: CorrelatedResponse, next: () => void): void {
    const incomingId = headerValue(req.headers, "x-request-id");
    const requestId =
      incomingId !== undefined && SAFE_REQUEST_ID.test(incomingId)
        ? incomingId
        : randomUUID();

    const traceContext = deriveTraceContext(
      headerValue(req.headers, "traceparent"),
    );

    req.requestId = requestId;
    req.traceContext = traceContext;
    res.setHeader("x-request-id", requestId);
    res.setHeader("traceparent", formatTraceparent(traceContext));

    next();
  }
}
