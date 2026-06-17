/**
 * TenantContextModule (STANDARDS §9.2). Global so any repository can inject
 * TenantContextService without re-importing. The interceptor is exported for
 * the HTTP layer to register (per-controller or globally in main.ts) once auth
 * populates the principal claim (Wave 3).
 */
import { Global, Module } from "@nestjs/common";

import { TenantContextInterceptor } from "./tenant-context.interceptor";
import { TenantContextService } from "./tenant-context.service";

@Global()
@Module({
  providers: [TenantContextService, TenantContextInterceptor],
  exports: [TenantContextService, TenantContextInterceptor],
})
export class TenantContextModule {}
