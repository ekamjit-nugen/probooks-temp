/**
 * RedMetricsInterceptor (STANDARDS §14 — RED per controller route). Records
 * Rate/Errors/Duration for every request into the MetricsRecorder seam.
 *
 * It hooks the response `finish` event rather than the RxJS stream so it captures
 * the TRUE final status code (Nest/Express set it after the interceptor chain)
 * for both success and error paths, and measures wall-clock duration with a
 * monotonic timer. The route is the matched TEMPLATE (`req.route.path`, e.g.
 * `/v1/firms/:firmId`), never the raw URL, to keep metric cardinality bounded.
 */
import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";

import { METRICS_RECORDER, type MetricsRecorder } from "./metrics.recorder";

interface RoutedRequest {
  method: string;
  route?: { path?: string };
  path?: string;
}

interface FinishableResponse {
  statusCode: number;
  once(event: "finish", listener: () => void): void;
}

@Injectable()
export class RedMetricsInterceptor implements NestInterceptor {
  constructor(
    @Inject(METRICS_RECORDER) private readonly recorder: MetricsRecorder,
  ) {}

  intercept(
    executionContext: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const http = executionContext.switchToHttp();
    const req = http.getRequest<RoutedRequest>();
    const res = http.getResponse<FinishableResponse>();
    const start = process.hrtime.bigint();

    res.once("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const route = req.route?.path ?? req.path ?? "unknown";
      this.recorder.recordRequest({
        method: req.method,
        route,
        statusCode: res.statusCode,
        durationMs,
      });
    });

    return next.handle();
  }
}
