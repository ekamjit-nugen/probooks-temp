/**
 * Pino logger options factory (STANDARDS §13). JSON output everywhere; pretty
 * transport only in local development. PII redaction always on. Correlation
 * fields (requestId, route, latencyMs, and tenantId/userId seams) are attached
 * by the HTTP layer / TenantContext (Wave 2) — base fields are seeded here.
 */
import type { LoggerOptions } from "pino";

import type { LogLevel, NodeEnv } from "../config-env/env.schema";

import { buildRedaction } from "./redaction.config";

export interface LoggerFactoryInput {
  readonly nodeEnv: NodeEnv;
  readonly logLevel: LogLevel;
}

/**
 * Base correlation fields present on every line (STANDARDS §13). tenantId and
 * userId are null seams until TenantContext lands in Wave 2.
 */
export const BASE_LOG_BINDINGS = Object.freeze({
  tenantId: null as string | null,
  userId: null as string | null,
});

/** Build pino options: redaction always; pretty transport only in local dev. */
export function buildPinoOptions(input: LoggerFactoryInput): LoggerOptions {
  const options: LoggerOptions = {
    level: input.logLevel,
    redact: buildRedaction(),
    base: { ...BASE_LOG_BINDINGS },
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (input.nodeEnv === "development") {
    options.transport = {
      target: "pino-pretty",
      options: { colorize: true, singleLine: true },
    };
  }

  return options;
}
