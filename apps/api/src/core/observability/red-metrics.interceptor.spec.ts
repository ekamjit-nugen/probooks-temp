/**
 * Unit tests for RedMetricsInterceptor (STANDARDS §14). Derived from
 * observability.feature. Uses a real EventEmitter response so the `finish` hook
 * fires exactly as Express would.
 */
import { EventEmitter } from "node:events";

import { lastValueFrom, of } from "rxjs";

import { InMemoryMetricsRecorder } from "./metrics.recorder";
import { RedMetricsInterceptor } from "./red-metrics.interceptor";

interface FakeRes extends EventEmitter {
  statusCode: number;
}

function contextFor(
  req: { method: string; route?: { path?: string }; path?: string },
  res: FakeRes,
) {
  return {
    switchToHttp: () => ({
      getRequest: <T>() => req as T,
      getResponse: <T>() => res as T,
    }),
  };
}

function fakeRes(statusCode: number): FakeRes {
  const res = new EventEmitter() as FakeRes;
  res.statusCode = statusCode;
  return res;
}

describe("RedMetricsInterceptor [STD-14]", () => {
  it("records rate + duration for the route template on finish", async () => {
    const recorder = new InMemoryMetricsRecorder();
    const interceptor = new RedMetricsInterceptor(recorder);
    const res = fakeRes(200);
    const ctx = contextFor(
      { method: "GET", route: { path: "/health/live" } },
      res,
    );
    const next = { handle: () => of("body") };

    await lastValueFrom(interceptor.intercept(ctx as never, next as never));
    res.emit("finish");

    const stats = recorder.get("GET /health/live");
    expect(stats?.count).toBe(1);
    expect(stats?.errors).toBe(0);
    expect(stats?.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("counts a 5xx response as an error (RED's E)", async () => {
    const recorder = new InMemoryMetricsRecorder();
    const interceptor = new RedMetricsInterceptor(recorder);
    const res = fakeRes(503);
    const ctx = contextFor(
      { method: "GET", route: { path: "/health/ready" } },
      res,
    );
    const next = { handle: () => of("body") };

    await lastValueFrom(interceptor.intercept(ctx as never, next as never));
    res.emit("finish");

    expect(recorder.get("GET /health/ready")?.errors).toBe(1);
  });

  it("falls back to req.path when no route template is matched", async () => {
    const recorder = new InMemoryMetricsRecorder();
    const interceptor = new RedMetricsInterceptor(recorder);
    const res = fakeRes(404);
    const ctx = contextFor({ method: "GET", path: "/unmatched" }, res);
    const next = { handle: () => of("body") };

    await lastValueFrom(interceptor.intercept(ctx as never, next as never));
    res.emit("finish");

    expect(recorder.get("GET /unmatched")?.count).toBe(1);
  });
});
