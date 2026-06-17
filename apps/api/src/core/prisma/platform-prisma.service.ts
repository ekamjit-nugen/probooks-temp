/**
 * PlatformPrismaService (STANDARDS §9.6; INV-TEN-3). The service_role client:
 * connects with DATABASE_SERVICE_ROLE_URL (a BYPASSRLS role) for platform /
 * operator metadata and migrations — work that legitimately spans tenants.
 *
 * It is a DISTINCT class from PrismaService so it can never be injected into a
 * tenant-scoped repository by accident: repositories depend on PrismaService;
 * only the platform module (PlatformRepository) depends on this. It exposes NO
 * runInTenantTx — there is no tenant to bind. Code review (STANDARDS §24, §9.6)
 * verifies no operator surface reaches financial tables through it.
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import { AppConfigService } from "../config-env/app-config.service";

@Injectable()
export class PlatformPrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: AppConfigService) {
    super({
      datasources: {
        db: { url: config.getRequired("databaseServiceRoleUrl") },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
