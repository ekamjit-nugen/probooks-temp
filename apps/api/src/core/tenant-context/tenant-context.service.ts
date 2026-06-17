/**
 * TenantContextService (STANDARDS §9.2/§9.3). Backs the request-scoped
 * TenantContext with Node AsyncLocalStorage so every repository can read the
 * tenant without it being threaded through method parameters. Repositories call
 * `require()`; it throws NoTenantContextError when unseeded (fail-closed,
 * INV-TEN-1). The seeding seam (interceptor / job runner) calls `runWithContext`.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { Injectable } from "@nestjs/common";

import type { TenantContext } from "./tenant-context";
import { NoTenantContextError } from "./tenant-context.errors";

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantContext>();

  /**
   * Run `fn` with `context` bound for the duration of the async call tree.
   * Used by the request interceptor and by background-job runners (§9.5).
   */
  runWithContext<T>(context: TenantContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  /**
   * The current context, or undefined if none is in scope. Prefer `require()`
   * at the point of use — `get()` exists for code that legitimately tolerates
   * the unseeded case (e.g. logging enrichment).
   */
  get(): TenantContext | undefined {
    return this.storage.getStore();
  }

  /**
   * The current context or throw (STANDARDS §9.3). The only sanctioned accessor
   * inside repositories: a missing context is a programming/auth error, never a
   * silent "all tenants" query.
   */
  require(): TenantContext {
    const context = this.storage.getStore();
    if (context === undefined) {
      throw new NoTenantContextError();
    }
    return context;
  }
}
