/**
 * Unit tests for RequestIdMiddleware (STANDARDS §13/§14). Derived from
 * observability.feature.
 */
import {
  RequestIdMiddleware,
  type CorrelatedRequest,
} from "./request-id.middleware";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function run(headers: Record<string, string | string[] | undefined>) {
  const mw = new RequestIdMiddleware();
  const req: CorrelatedRequest = { headers };
  const setHeaders: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string) => {
      setHeaders[name] = value;
    },
  };
  let nextCalled = false;
  mw.use(req, res, () => {
    nextCalled = true;
  });
  return { req, setHeaders, nextCalled };
}

describe("RequestIdMiddleware [STD-13][STD-14]", () => {
  it("adopts a safe incoming x-request-id and echoes it", () => {
    const { req, setHeaders, nextCalled } = run({
      "x-request-id": "req-abc.123",
    });
    expect(req.requestId).toBe("req-abc.123");
    expect(setHeaders["x-request-id"]).toBe("req-abc.123");
    expect(nextCalled).toBe(true);
  });

  it("generates a UUID when x-request-id is absent", () => {
    const { req, setHeaders } = run({});
    expect(req.requestId).toMatch(UUID_RE);
    expect(setHeaders["x-request-id"]).toBe(req.requestId);
  });

  it("replaces an UNSAFE x-request-id (injection chars) with a UUID", () => {
    const { req } = run({ "x-request-id": "bad id with spaces & <script>" });
    expect(req.requestId).toMatch(UUID_RE);
  });

  it("sets and echoes a traceparent (continuing a valid incoming trace)", () => {
    const incoming = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    const { req, setHeaders } = run({ traceparent: incoming });
    expect(req.traceContext?.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(setHeaders["traceparent"]).toMatch(
      /^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-01$/,
    );
  });

  it("starts a fresh traceparent when none is supplied", () => {
    const { setHeaders } = run({});
    expect(setHeaders["traceparent"]).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/,
    );
  });
});
