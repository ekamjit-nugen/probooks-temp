/**
 * PrismaModule (STANDARDS §8, §9.6). Global so repositories can inject
 * PrismaService without re-importing. Both clients are provided:
 *   - PrismaService        → app_user (RLS-enforced), for tenant-scoped repos.
 *   - PlatformPrismaService → service_role (BYPASSRLS), for the platform module.
 * Depends on TenantContextModule (PrismaService reads the tenant from context).
 */
import { Global, Module } from "@nestjs/common";

import { PlatformPrismaService } from "./platform-prisma.service";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  providers: [PrismaService, PlatformPrismaService],
  exports: [PrismaService, PlatformPrismaService],
})
export class PrismaModule {}
