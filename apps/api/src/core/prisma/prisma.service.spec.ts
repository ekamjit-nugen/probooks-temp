import { AppConfigService } from "../config-env/app-config.service";
import { NoTenantContextError } from "../tenant-context/tenant-context.errors";
import { TenantContextService } from "../tenant-context/tenant-context.service";

import { PrismaService } from "./prisma.service";

/** Build a PrismaService without connecting (constructor only resolves the URL). */
function makePrisma(tenantContext: TenantContextService): PrismaService {
  const config = new AppConfigService({
    nodeEnv: "test",
    port: 3000,
    logLevel: "info",
    databaseUrl: "postgresql://app_user:pw@localhost:5432/probooks",
    databaseServiceRoleUrl:
      "postgresql://service_role:pw@localhost:5432/probooks",
    jwtSecret: undefined,
    jwtAccessTtlSeconds: 900,
    jwtRefreshTtlSeconds: 28_800,
  });
  return new PrismaService(config, tenantContext);
}

describe("PrismaService.runInTenantTx [STD-8.4][STD-9.3][INV-TEN-1]", () => {
  it("fails closed (NoTenantContextError) before opening any transaction", async () => {
    const tenantContext = new TenantContextService();
    const prisma = makePrisma(tenantContext);

    // No context seeded → require() throws before $transaction is ever called.
    const txSpy = jest
      .spyOn(prisma, "$transaction")
      .mockResolvedValue(undefined as never);

    await expect(
      prisma.runInTenantTx(() => Promise.resolve("unreachable")),
    ).rejects.toBeInstanceOf(NoTenantContextError);
    expect(txSpy).not.toHaveBeenCalled();
  });
});
