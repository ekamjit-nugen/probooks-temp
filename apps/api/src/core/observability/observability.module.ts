/**
 * ObservabilityModule (STANDARDS §13/§14). Wires request correlation + RED
 * metrics:
 *   - RequestIdMiddleware applied to ALL routes (requestId + traceparent at the
 *     edge) via NestModule.configure.
 *   - RedMetricsInterceptor registered globally (APP_INTERCEPTOR) so every route
 *     emits Rate/Errors/Duration.
 *   - MetricsRecorder bound to the in-memory default (the Prometheus/OTel
 *     exporter that scrapes it is deferred — no metrics backend in Phase 0).
 *
 * Global so correlation + metrics apply uniformly without per-controller wiring.
 */
import {
  Global,
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";

import { InMemoryMetricsRecorder, METRICS_RECORDER } from "./metrics.recorder";
import { RedMetricsInterceptor } from "./red-metrics.interceptor";
import { RequestIdMiddleware } from "./request-id.middleware";

@Global()
@Module({
  providers: [
    { provide: METRICS_RECORDER, useClass: InMemoryMetricsRecorder },
    RedMetricsInterceptor,
    { provide: APP_INTERCEPTOR, useExisting: RedMetricsInterceptor },
  ],
  exports: [METRICS_RECORDER, RedMetricsInterceptor],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
