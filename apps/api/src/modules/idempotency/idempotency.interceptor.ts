/**
 * IdempotencyInterceptor (STANDARDS §7.4). Wraps state-creating POSTs marked
 * with @Idempotent: reads the Idempotency-Key header, fingerprints the request,
 * and either replays a stored response or runs the handler once and stores it.
 *
 * Activation gates (all must hold, else pass straight through):
 *   1. the route carries @Idempotent metadata;
 *   2. the method is POST (idempotency guards state CREATION, §7.4);
 *   3. an Idempotency-Key header is present (the header is OPTIONAL, §7.4).
 * A malformed (non-UUID) key is a 400 — validate before any business logic.
 *
 * ALS note: this interceptor is INNER to the global TenantContextInterceptor, so
 * its synchronous body runs inside the seeded tenant context. But the post-
 * handler RxJS callbacks (complete/release) run on SUBSCRIPTION, outside that
 * scope — so we snapshot the TenantContext and re-bind it with runWithContext
 * around every async repository call. This keeps require() inside the repository
 * fail-closed-correct regardless of subscription timing.
 */
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { firstValueFrom, from, of, throwError, type Observable } from "rxjs";
import { catchError, map, mergeMap } from "rxjs/operators";

import type { TenantContext } from "../../core/tenant-context/tenant-context";
import { TenantContextService } from "../../core/tenant-context/tenant-context.service";

import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_METADATA_KEY,
} from "./idempotency.decorator";
import { IdempotencyKeyMalformedError } from "./idempotency.errors";
import { computeRequestFingerprint } from "./idempotency.fingerprint";
import { IdempotencyService } from "./idempotency.service";

/** Nest's internal @HttpCode metadata key (stable across Nest 10). */
const HTTP_CODE_METADATA = "__httpCode__";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface HttpRequestLike {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  url?: string;
  originalUrl?: string;
}

interface HttpResponseLike {
  statusCode: number;
  status(code: number): unknown;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly service: IdempotencyService,
    private readonly tenant: TenantContextService,
  ) {}

  intercept(
    executionContext: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const isIdempotent = this.reflector.getAllAndOverride<boolean>(
      IDEMPOTENT_METADATA_KEY,
      [executionContext.getHandler(), executionContext.getClass()],
    );
    if (isIdempotent !== true) {
      return next.handle();
    }

    const http = executionContext.switchToHttp();
    const request = http.getRequest<HttpRequestLike>();
    if (request.method.toUpperCase() !== "POST") {
      return next.handle();
    }

    const key = this.readKey(request);
    if (key === undefined) {
      // Header is optional (§7.4): no key → ordinary, non-idempotent handling.
      return next.handle();
    }
    if (!UUID_RE.test(key)) {
      throw new IdempotencyKeyMalformedError();
    }

    // Snapshot tenant context now (we are inside the seeded ALS scope) so we can
    // re-bind it around the post-handler completion callbacks.
    const tenantCtx = this.tenant.require();
    const fingerprint = computeRequestFingerprint({
      method: request.method,
      path: request.originalUrl ?? request.url ?? "",
      body: request.body,
    });
    const response = http.getResponse<HttpResponseLike>();
    const statusCode = this.resolveStatus(executionContext, request.method);

    return from(
      this.withTenant(tenantCtx, () =>
        this.service.begin({ key, fingerprint }),
      ),
    ).pipe(
      mergeMap((begin) => {
        if (begin.outcome === "replay") {
          response.status(begin.response.status);
          return of(begin.response.body);
        }
        // Claimed: run the handler exactly once, then persist its response.
        // The handler is subscribed INSIDE the snapshotted tenant context so a
        // tenant-scoped handler (e.g. one calling runInTenantTx) sees the ALS —
        // mergeMap's callback runs after the async begin() resolved, by which
        // point the original request ALS scope has unwound. AsyncLocalStorage
        // propagates across the awaited handler work from this re-binding.
        return from(
          this.withTenant(tenantCtx, () => firstValueFrom(next.handle())),
        ).pipe(
          mergeMap((body: unknown) =>
            from(
              this.withTenant(tenantCtx, () =>
                this.service.complete({
                  key,
                  fingerprint,
                  response: { status: statusCode, body },
                }),
              ),
            ).pipe(map(() => body)),
          ),
          catchError((err: unknown) =>
            from(
              this.withTenant(tenantCtx, () =>
                this.service.release(key, fingerprint),
              ),
            ).pipe(mergeMap(() => throwError(() => err))),
          ),
        );
      }),
    );
  }

  private readKey(request: HttpRequestLike): string | undefined {
    const raw = request.headers[IDEMPOTENCY_KEY_HEADER];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined) {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }

  /**
   * The status Nest WILL use for this handler — @HttpCode metadata if present,
   * else the method default (POST → 201). Resolved (not read off the response,
   * which Nest sets only after interceptors) so the stored status matches the
   * first response exactly and replays identically.
   */
  private resolveStatus(
    executionContext: ExecutionContext,
    method: string,
  ): number {
    const explicit = this.reflector.get<number | undefined>(
      HTTP_CODE_METADATA,
      executionContext.getHandler(),
    );
    if (typeof explicit === "number") {
      return explicit;
    }
    return method.toUpperCase() === "POST" ? 201 : 200;
  }

  /** Run `fn` with the snapshotted tenant context bound (ALS re-entry). */
  private withTenant<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
    return this.tenant.runWithContext(ctx, fn);
  }
}
