import { Writable } from "node:stream";

import pino from "pino";

import type { NodeEnv } from "../config-env/env.schema";

import { buildPinoOptions } from "./logger.factory";

/** Collect pino output lines written to an in-memory stream. */
function captureLogger(nodeEnv: NodeEnv): {
  logger: pino.Logger;
  lines: () => string;
} {
  let buffer = "";
  const sink = new Writable({
    write(chunk: Buffer | string, _enc, cb): void {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      cb();
    },
  });
  const logger = pino(buildPinoOptions({ nodeEnv, logLevel: "info" }), sink);
  return { logger, lines: () => buffer };
}

describe("pino logger redaction [STD-13]", () => {
  it("redacts an email in a logged payload", () => {
    const { logger, lines } = captureLogger("test");

    logger.info({ email: "client@example.com" }, "user action");

    const out = lines();
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("client@example.com");
  });

  it("redacts a business number", () => {
    const { logger, lines } = captureLogger("test");

    logger.info({ businessNumber: "123456789RT0001" }, "filing");

    expect(lines()).not.toContain("123456789RT0001");
  });

  it("redacts a name nested under req", () => {
    const { logger, lines } = captureLogger("test");

    logger.info({ req: { name: "Ada Lovelace" } }, "request");

    expect(lines()).not.toContain("Ada Lovelace");
  });

  it("redacts document contents", () => {
    const { logger, lines } = captureLogger("test");

    logger.info({ documentContents: "SECRET INVOICE BODY" }, "extraction");

    expect(lines()).not.toContain("SECRET INVOICE BODY");
  });

  it("emits JSON (no pretty transport) outside local dev", () => {
    const opts = buildPinoOptions({ nodeEnv: "production", logLevel: "info" });
    expect(opts.transport).toBeUndefined();
  });

  it("uses the configured log level", () => {
    const opts = buildPinoOptions({ nodeEnv: "test", logLevel: "warn" });
    expect(opts.level).toBe("warn");
  });
});
