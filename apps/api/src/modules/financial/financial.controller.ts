/**
 * FinancialController (STANDARDS §10.2; INV-TEN-3). A representative financial
 * read surface guarded by `financial:read` (SPEC §4.17). The Platform Operator
 * is DENIED that capability, so the RoleGuard returns 403 BEFORE any handler /
 * DB access — the guard layer of INV-TEN-3. Firm + client roles that legitimately
 * hold the capability reach the handler, which reads ONLY their own tenant's data
 * (RLS, via FinancialRepository).
 */
import { Controller, Get, UseGuards } from "@nestjs/common";

import { RequirePermission } from "../../core/rbac/rbac.decorators";
import { GUARD_STACK } from "../../core/tenancy-guard/guard-stack";

import { FinancialService, type PeriodSummaryDto } from "./financial.service";

@Controller("v1/financial")
@UseGuards(...GUARD_STACK)
export class FinancialController {
  constructor(private readonly financial: FinancialService) {}

  /** List this tenant's period summaries (financial data). Operator → 403. */
  @Get("summaries")
  @RequirePermission("financial:read")
  summaries(): Promise<PeriodSummaryDto[]> {
    return this.financial.listSummaries();
  }
}
