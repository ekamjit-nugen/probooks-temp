/**
 * MetricsRecorder (STANDARDS §14 — RED: Rate, Errors, Duration per route).
 *
 * An injectable seam: the in-memory default counts requests + durations so the
 * RED interceptor and tests work today; the Prometheus/OTel exporter that scrapes
 * these is wired when the metrics backend lands (deferred in Phase 0). Routes are
 * identified by method + path TEMPLATE (e.g. "GET /v1/firms/:id"), never the raw
 * URL, so high-cardinality ids don't explode the metric space.
 */

/** One RED observation for a completed request. */
export interface RequestMetric {
  readonly method: string;
  readonly route: string;
  readonly statusCode: number;
  readonly durationMs: number;
}

/** The seam the interceptor records into. */
export interface MetricsRecorder {
  recordRequest(metric: RequestMetric): void;
}

/** DI token for the recorder. */
export const METRICS_RECORDER = Symbol("METRICS_RECORDER");

/** A per-route RED snapshot. */
export interface RouteStats {
  count: number;
  errors: number;
  totalDurationMs: number;
}

/**
 * In-memory RED recorder (default). Aggregates per `METHOD route` key. Good
 * enough for tests + a /metrics scrape seam; not a time-series database.
 */
export class InMemoryMetricsRecorder implements MetricsRecorder {
  private readonly stats = new Map<string, RouteStats>();

  recordRequest(metric: RequestMetric): void {
    const key = `${metric.method.toUpperCase()} ${metric.route}`;
    const current = this.stats.get(key) ?? {
      count: 0,
      errors: 0,
      totalDurationMs: 0,
    };
    current.count += 1;
    current.totalDurationMs += metric.durationMs;
    // Errors = 5xx (server faults) for RED's "E"; 4xx are client outcomes.
    if (metric.statusCode >= 500) {
      current.errors += 1;
    }
    this.stats.set(key, current);
  }

  /** Snapshot for a route key (`"GET /health/live"`), or undefined if unseen. */
  get(key: string): RouteStats | undefined {
    const s = this.stats.get(key);
    return s === undefined ? undefined : { ...s };
  }

  /** All recorded route keys. */
  keys(): string[] {
    return [...this.stats.keys()];
  }

  /** Reset — test convenience. */
  reset(): void {
    this.stats.clear();
  }
}
