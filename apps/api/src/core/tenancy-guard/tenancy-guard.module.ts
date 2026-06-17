/**
 * TenancyGuardModule (STANDARDS §9.4, §10.2). Provides TenantGuard (cross-tenant
 * path → 404, INV-TEN-2) and ResourceGuard (resource scope, e.g. own-client).
 * Global so the guards can be applied on any tenant-scoped controller.
 */
import { Global, Module } from "@nestjs/common";

import { ResourceGuard } from "./resource.guard";
import { TenantGuard } from "./tenant.guard";

@Global()
@Module({
  providers: [TenantGuard, ResourceGuard],
  exports: [TenantGuard, ResourceGuard],
})
export class TenancyGuardModule {}
