/**
 * FinancialService (STANDARDS §6, §8.6). Maps persisted period summaries to a
 * transport DTO, serialising the NUMERIC(18,4) money column to a STRING at the
 * I/O boundary (§8.6 — money never crosses the wire as a JS number, which would
 * lose precision). Services never touch Prisma directly — only the repository.
 */
import { Injectable } from "@nestjs/common";

import { FinancialRepository } from "./financial.repository";

/** Operator-invisible (INV-TEN-3) financial figure, money as a precise string. */
export interface PeriodSummaryDto {
  readonly id: string;
  readonly clientId: string;
  readonly periodLabel: string;
  readonly netTax: string;
  readonly createdAt: string;
}

@Injectable()
export class FinancialService {
  constructor(private readonly repository: FinancialRepository) {}

  async listSummaries(): Promise<PeriodSummaryDto[]> {
    const rows = await this.repository.listForTenant();
    return rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      periodLabel: r.periodLabel,
      netTax: r.netTax.toString(),
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
