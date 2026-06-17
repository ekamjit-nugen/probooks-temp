/**
 * TenantContextInterceptor (STANDARDS §9.2). Seeds the AsyncLocalStorage context
 * for each request, then runs the handler inside it so repositories can call
 * require(). The principal comes from a request-attached claim
 * (`req.principalClaim`) that REAL auth will populate in Wave 3 — this is the
 * clean seam. We deliberately do NOT implement JWT here (out of Phase-0 scope).
 *
 * A request with no principal claim simply runs WITHOUT a seeded context;
 * downstream require() then fails closed with NoTenantContextError. We never
 * fabricate a tenant.
 */
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";

import type { TenantContext } from "./tenant-context";
import { TenantContextService } from "./tenant-context.service";

/**
 * The claim shape REAL auth (Wave 3) attaches to the request after verifying a
 * session. Kept structurally identical to TenantContext so the interceptor is a
 * pass-through today and a verification point later.
 */
export type PrincipalClaim = TenantContext;

interface RequestWithPrincipal {
  principalClaim?: PrincipalClaim;
}

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContextService) {}

  intercept(
    executionContext: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const request = executionContext
      .switchToHttp()
      .getRequest<RequestWithPrincipal>();
    const claim = request.principalClaim;

    if (claim === undefined) {
      // No authenticated principal — run unseeded; require() will fail closed.
      return next.handle();
    }

    return this.tenantContext.runWithContext(claim, () => next.handle());
  }
}
