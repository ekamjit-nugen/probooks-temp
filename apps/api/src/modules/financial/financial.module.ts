/**
 * FinancialModule (STANDARDS §6; INV-TEN-3). Wires the tenant-scoped financial
 * read surface (repository + service + guarded controller). Depends on the
 * global PrismaModule + TenantContextModule; the guard stack is applied per
 * controller. This is the ONLY path to financial data — operator surfaces use
 * PlatformModule, which never reaches it.
 */
import { Module } from "@nestjs/common";

import { FinancialController } from "./financial.controller";
import { FinancialRepository } from "./financial.repository";
import { FinancialService } from "./financial.service";

@Module({
  controllers: [FinancialController],
  providers: [FinancialRepository, FinancialService],
  exports: [FinancialService],
})
export class FinancialModule {}
