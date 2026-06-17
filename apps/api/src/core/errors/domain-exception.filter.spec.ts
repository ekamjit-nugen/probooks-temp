import type { ArgumentsHost } from "@nestjs/common";
import type { ErrorEnvelope } from "@probooks/shared";

import { DomainExceptionFilter } from "./domain-exception.filter";
import type { ErrorReporter } from "./error-reporter";
import { FlagAlreadyClearedError } from "./example-errors";

interface CapturedResponse {
  statusCode: number;
  body: ErrorEnvelope | undefined;
}

function makeHost(requestId: string | undefined): {
  host: ArgumentsHost;
  captured: CapturedResponse;
} {
  const captured: CapturedResponse = { statusCode: 0, body: undefined };
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(body: ErrorEnvelope) {
      captured.body = body;
      return this;
    },
  };
  const req = { requestId, url: "/test" };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => req,
    }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

/** A reporter whose calls we can count without tripping unbound-method lint. */
function makeReporter(): { reporter: ErrorReporter; calls: () => unknown[] } {
  const received: unknown[] = [];
  const reporter: ErrorReporter = {
    report: (error: unknown): void => {
      received.push(error);
    },
  };
  return { reporter, calls: () => received };
}

describe("DomainExceptionFilter [STD-12.2][STD-7.1]", () => {
  it("maps a DomainError to the §7.1 envelope with its status and code", () => {
    const { reporter, calls } = makeReporter();
    const filter = new DomainExceptionFilter(reporter);
    const { host, captured } = makeHost("req-1");

    filter.catch(new FlagAlreadyClearedError("flag-9"), host);

    expect(captured.statusCode).toBe(409);
    expect(captured.body?.error.code).toBe("FLAG_ALREADY_CLEARED");
    expect(captured.body?.error.message).toContain("flag-9");
    expect(captured.body?.error.requestId).toBe("req-1");
    expect(calls()).toHaveLength(0);
  });

  it("sanitizes an unknown error to a 500 with no stack or path leak", () => {
    const { reporter, calls } = makeReporter();
    const filter = new DomainExceptionFilter(reporter);
    const { host, captured } = makeHost("req-2");
    const native = new Error("/var/secret/path blew up");

    filter.catch(native, host);

    expect(captured.statusCode).toBe(500);
    const serialized = JSON.stringify(captured.body);
    expect(serialized).toContain("INTERNAL_ERROR");
    expect(serialized).not.toContain("/var/secret/path");
    expect(serialized).not.toContain("stack");
    expect(calls()).toEqual([native]);
  });

  it("falls back to a generated requestId when the request carries none", () => {
    const { reporter } = makeReporter();
    const filter = new DomainExceptionFilter(reporter);
    const { host, captured } = makeHost(undefined);

    filter.catch(new FlagAlreadyClearedError("flag-1"), host);

    expect(typeof captured.body?.error.requestId).toBe("string");
    expect(captured.body?.error.requestId.length).toBeGreaterThan(0);
  });
});
