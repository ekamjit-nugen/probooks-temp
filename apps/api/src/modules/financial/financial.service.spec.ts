/**
 * Unit tests for FinancialService (STANDARDS §8.6). Proves money is serialised
 * as a precise STRING at the boundary, never a float. Repository is mocked.
 */
import type { PeriodSummary } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { FinancialRepository } from "./financial.repository";
import { FinancialService } from "./financial.service";

describe("FinancialService [STD-8.6]", () => {
  function make(rows: PeriodSummary[]) {
    const listForTenant = jest.fn(
      (): Promise<PeriodSummary[]> => Promise.resolve(rows),
    );
    const repo = { listForTenant } as unknown as FinancialRepository;
    return { service: new FinancialService(repo), listForTenant };
  }

  it("serialises net_tax (NUMERIC 18,4) as a precise string, not a number", async () => {
    const row: PeriodSummary = {
      id: "00000000-0000-7000-8000-000000000001",
      tenantId: "11111111-1111-7111-8111-111111111111",
      clientId: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
      periodLabel: "2026-Q1",
      netTax: new Prisma.Decimal("1234.5600"),
      createdAt: new Date("2026-06-08T12:00:00.000Z"),
    };
    const { service } = make([row]);

    const [dto] = await service.listSummaries();

    expect(typeof dto?.netTax).toBe("string");
    expect(dto?.netTax).toBe("1234.56");
    expect(dto?.periodLabel).toBe("2026-Q1");
    expect(dto?.createdAt).toBe("2026-06-08T12:00:00.000Z");
  });

  it("returns an empty list when the tenant has no summaries", async () => {
    const { service } = make([]);
    await expect(service.listSummaries()).resolves.toEqual([]);
  });
});
