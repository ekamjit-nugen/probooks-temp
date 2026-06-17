/**
 * Unit tests for W3C trace-context (STANDARDS §14). Derived from
 * observability.feature.
 */
import {
  deriveTraceContext,
  formatTraceparent,
  parseTraceparent,
} from "./trace-context";

const VALID = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

describe("parseTraceparent [STD-14]", () => {
  it("parses a well-formed traceparent", () => {
    expect(parseTraceparent(VALID)).toEqual({
      version: "00",
      traceId: "0af7651916cd43dd8448eb211c80319c",
      parentId: "b7ad6b7169203331",
      flags: "01",
    });
  });

  it("returns null for undefined / malformed", () => {
    expect(parseTraceparent(undefined)).toBeNull();
    expect(parseTraceparent("not-a-traceparent")).toBeNull();
    expect(parseTraceparent("00-tooshort-tooshort-01")).toBeNull();
  });

  it("rejects an all-zero trace id or parent id", () => {
    expect(
      parseTraceparent(
        "00-00000000000000000000000000000000-b7ad6b7169203331-01",
      ),
    ).toBeNull();
    expect(
      parseTraceparent(
        "00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01",
      ),
    ).toBeNull();
  });

  it("round-trips through format", () => {
    const ctx = parseTraceparent(VALID);
    expect(ctx).not.toBeNull();
    if (ctx !== null) {
      expect(formatTraceparent(ctx)).toBe(VALID);
    }
  });
});

describe("deriveTraceContext [STD-14]", () => {
  it("continues a valid incoming trace with a new span id", () => {
    const ctx = deriveTraceContext(VALID);
    expect(ctx.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(ctx.parentId).not.toBe("b7ad6b7169203331"); // fresh span
    expect(ctx.parentId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("starts a fresh, sampled root trace when none/invalid is supplied", () => {
    const ctx = deriveTraceContext(undefined);
    expect(ctx.version).toBe("00");
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(ctx.traceId).not.toBe("0".repeat(32));
    expect(ctx.parentId).toMatch(/^[0-9a-f]{16}$/);
    expect(ctx.flags).toBe("01");
  });

  it("generates distinct trace ids across calls", () => {
    expect(deriveTraceContext(undefined).traceId).not.toBe(
      deriveTraceContext(undefined).traceId,
    );
  });
});
