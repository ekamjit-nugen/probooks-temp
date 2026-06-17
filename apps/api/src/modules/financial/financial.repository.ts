/**
 * FinancialRepository (STANDARDS §9.3; INV-TEN-1/INV-TEN-3). The tenant-scoped
 * reader for the financial stub (period_summaries). It is the COUNTERPART to
 * PlatformRepository: financial data is reachable ONLY here, only through the
 * app_user (RLS-enforced) connection, only for the tenant bound in context.
 *
 * Follows the §9.3 pattern exactly: tenant from context (never a param),
 * tenantId in the where (lint-enforced), run inside runInTenantTx so RLS binds.
 * The operator/service_role connection has no DB grant on this table at all, so
 * financial data is unreachable from the operator path (INV-TEN-3).
 */
import { Injectable } from "@nestjs/common";
import type { PeriodSummary } from "@prisma/client";

import {
  PrismaService,
  type TenantTxClient,
} from "../../core/prisma/prisma.service";
import { TenantContextService } from "../../core/tenant-context/tenant-context.service";

@Injectable()
export class FinancialRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** All period summaries for the current tenant (financial data). */
  async listForTenant(): Promise<PeriodSummary[]> {
    const { tenantId } = this.tenantContext.require();
    return this.prisma.runInTenantTx((tx: TenantTxClient) =>
      tx.periodSummary.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      }),
    );
  }
}
