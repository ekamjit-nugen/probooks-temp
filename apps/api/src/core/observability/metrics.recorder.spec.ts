/**
 * Unit tests for InMemoryMetricsRecorder (STANDARDS §14 RED). Derived from
 * observability.feature.
 */
import { InMemoryMetricsRecorder } from "./metrics.recorder";

describe("InMemoryMetricsRecorder [STD-14]", () => {
  it("aggregates count + duration per METHOD route key", () => {
    const r = new InMemoryMetricsRecorder();
    r.recordRequest({
      method: "GET",
      route: "/health/live",
      statusCode: 200,
      durationMs: 4,
    });
    r.recordRequest({
      method: "GET",
      route: "/health/live",
      statusCode: 200,
      durationMs: 6,
    });

    expect(r.get("GET /health/live")).toEqual({
      count: 2,
      errors: 0,
      totalDurationMs: 10,
    });
  });

  it("counts 5xx as errors but not 4xx", () => {
    const r = new InMemoryMetricsRecorder();
    r.recordRequest({
      method: "POST",
      route: "/v1/things",
      statusCode: 500,
      durationMs: 1,
    });
    r.recordRequest({
      method: "POST",
      route: "/v1/things",
      statusCode: 409,
      durationMs: 1,
    });

    const stats = r.get("POST /v1/things");
    expect(stats?.count).toBe(2);
    expect(stats?.errors).toBe(1); // only the 500
  });

  it("normalizes the method to upper-case in the key", () => {
    const r = new InMemoryMetricsRecorder();
    r.recordRequest({
      method: "get",
      route: "/x",
      statusCode: 200,
      durationMs: 1,
    });
    expect(r.keys()).toEqual(["GET /x"]);
  });

  it("returns undefined for an unseen key and supports reset", () => {
    const r = new InMemoryMetricsRecorder();
    r.recordRequest({
      method: "GET",
      route: "/x",
      statusCode: 200,
      durationMs: 1,
    });
    expect(r.get("GET /unseen")).toBeUndefined();
    r.reset();
    expect(r.get("GET /x")).toBeUndefined();
  });
});
