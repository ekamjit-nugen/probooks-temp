/**
 * PlatformModule (STANDARDS §9.6; INV-TEN-3). Wires the operator-facing
 * PlatformRepository (service_role, tenant metadata only). Depends on the global
 * PrismaModule for PlatformPrismaService. Exported so operator controllers
 * (Phase 1) can read tenant metadata without ever reaching financial data.
 */
import { Module } from "@nestjs/common";

import { PlatformRepository } from "./platform.repository";

@Module({
  providers: [PlatformRepository],
  exports: [PlatformRepository],
})
export class PlatformModule {}
