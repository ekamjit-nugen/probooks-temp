/**
 * Platform + financial separation over real Postgres (STANDARDS §9.3/§9.6,
 * §19.2; INV-TEN-1, INV-TEN-3). Boots a REAL Postgres 16 (Testcontainers),
 * applies the committed migrations, and proves the operator/financial split the
 * way production enforces it — as the NON-superuser app_user (RLS) and the
 * service_role (BYPASSRLS) roles:
 *
 *   - FinancialRepository (app_user): a tenant reads ONLY its own period
 *     summaries; with no tenant in context it fails closed (require throws);
 *     a raw app_user query with no app.tenant_id sees zero rows (RLS).
 *   - PlatformRepository (service_role): reads tenant METADATA across tenants
 *     (status/region/userCount) — and has no financial accessor.
 *   - INV-TEN-3 at the DB grant layer: service_role SELECT on period_summaries
 *     is denied outright (no grant) — the operator cannot read financial data.
 */
import { join } from "node:path";

import type { Permission, TenantId, UserId } from "@probooks/shared";
import {
  startPostgresHarness,
  type PostgresHarness,
} from "@probooks/test-utils";
import { Client as PgClient } from "pg";

import { AppConfigService } from "../../core/config-env/app-config.service";
import { PlatformPrismaService } from "../../core/prisma/platform-prisma.service";
import { PrismaService } from "../../core/prisma/prisma.service";
import type { TenantContext } from "../../core/tenant-context/tenant-context";
import { TenantContextService } from "../../core/tenant-context/tenant-context.service";
import { FinancialRepository } from "../financial/financial.repository";

import { PlatformRepository } from "./platform.repository";

jest.setTimeout(180_000);

interface IdRow {
  id: string;
}

function firmContext(tenantId: string): TenantContext {
  return {
    tenantId: tenantId as TenantId,
    userId: "00000000-0000-7000-8000-0000000000aa" as UserId,
    userRole: "firm_admin",
    permissions: new Set<Permission>(),
  };
}

describe("Platform/financial separation as app_user + service_role [INV-TEN-1][INV-TEN-3]", () => {
  let harness: PostgresHarness;
  let prisma: PrismaService;
  let platformPrisma: PlatformPrismaService;
  let context: TenantContextService;
  let financialRepo: FinancialRepository;
  let platformRepo: PlatformRepository;
  let serviceRole: PgClient;
  let owner: PgClient;
  let tenantA = "";
  let tenantB = "";
  let clientA = "";
  let clientB = "";

  beforeAll(async () => {
    harness = await startPostgresHarness(
      join(__dirname, "..", "..", "..", "prisma"),
    );
    serviceRole = new PgClient({ connectionString: harness.serviceRoleUrl });
    await serviceRole.connect();
    owner = new PgClient({ connectionString: harness.ownerUrl });
    await owner.connect();

    // Seed tenants + clients + users via service_role (it owns that lifecycle).
    const a = await serviceRole.query<IdRow>(
      `INSERT INTO tenants (status, region, plan_ref) VALUES ('active','ca-central-1','plan_pro') RETURNING id`,
    );
    const b = await serviceRole.query<IdRow>(
      `INSERT INTO tenants (status, region, plan_ref) VALUES ('active','ca-central-1',NULL) RETURNING id`,
    );
    tenantA = a.rows[0]?.id ?? "";
    tenantB = b.rows[0]?.id ?? "";
    const ca = await serviceRole.query<IdRow>(
      `INSERT INTO clients (tenant_id, name) VALUES ($1,'Client A') RETURNING id`,
      [tenantA],
    );
    const cb = await serviceRole.query<IdRow>(
      `INSERT INTO clients (tenant_id, name) VALUES ($1,'Client B') RETURNING id`,
      [tenantB],
    );
    clientA = ca.rows[0]?.id ?? "";
    clientB = cb.rows[0]?.id ?? "";
    await serviceRole.query(
      `INSERT INTO users (tenant_id, role, idp_subject) VALUES ($1,'firm_admin','idp-a1'), ($1,'accountant','idp-a2')`,
      [tenantA],
    );

    // Seed financial rows via the DB owner (service_role has NO grant here).
    await owner.query(
      `INSERT INTO period_summaries (tenant_id, client_id, period_label, net_tax)
       VALUES ($1,$2,'2026-Q1', 1234.5600)`,
      [tenantA, clientA],
    );
    await owner.query(
      `INSERT INTO period_summaries (tenant_id, client_id, period_label, net_tax)
       VALUES ($1,$2,'2026-Q1', 9999.0000)`,
      [tenantB, clientB],
    );

    const config = new AppConfigService({
      nodeEnv: "test",
      port: 3000,
      logLevel: "info",
      databaseUrl: harness.appUserUrl,
      databaseServiceRoleUrl: harness.serviceRoleUrl,
      jwtSecret: undefined,
      jwtAccessTtlSeconds: 900,
      jwtRefreshTtlSeconds: 28_800,
    });
    context = new TenantContextService();
    prisma = new PrismaService(config, context);
    await prisma.onModuleInit();
    platformPrisma = new PlatformPrismaService(config);
    await platformPrisma.onModuleInit();
    financialRepo = new FinancialRepository(prisma, context);
    platformRepo = new PlatformRepository(platformPrisma);
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await platformPrisma?.onModuleDestroy();
    await owner?.end();
    await serviceRole?.end();
    await harness?.stop();
  });

  describe("FinancialRepository (app_user, tenant-scoped)", () => {
    it("[INV-TEN-1] a tenant reads ONLY its own financial rows", async () => {
      const aRows = await context.runWithContext(firmContext(tenantA), () =>
        financialRepo.listForTenant(),
      );
      expect(aRows).toHaveLength(1);
      expect(aRows[0]?.clientId).toBe(clientA);
      expect(aRows[0]?.netTax.toFixed(2)).toBe("1234.56"); // §8.6 precision

      const bRows = await context.runWithContext(firmContext(tenantB), () =>
        financialRepo.listForTenant(),
      );
      expect(bRows).toHaveLength(1);
      expect(bRows[0]?.clientId).toBe(clientB);
    });

    it("fails closed when no tenant is in context (require throws)", async () => {
      await expect(financialRepo.listForTenant()).rejects.toThrow();
    });

    it("[INV-TEN-3] a raw app_user query with NO app.tenant_id sees zero rows (RLS)", async () => {
      const appUser = new PgClient({ connectionString: harness.appUserUrl });
      await appUser.connect();
      try {
        // No SET LOCAL app.tenant_id → NULLIF policy fails closed → 0 rows.
        const res = await appUser.query(
          `SELECT count(*)::int AS n FROM period_summaries`,
        );
        expect((res.rows[0] as { n: number }).n).toBe(0);
      } finally {
        await appUser.end();
      }
    });
  });

  describe("PlatformRepository (service_role, metadata only)", () => {
    it("reads a tenant's metadata across tenants", async () => {
      const meta = await platformRepo.getTenantMetadata(tenantA);
      expect(meta).not.toBeNull();
      expect(meta?.status).toBe("active");
      expect(meta?.region).toBe("ca-central-1");
      expect(meta?.planRef).toBe("plan_pro");
      expect(meta?.userCount).toBe(2);
    });

    it("lists every tenant (no RLS scoping)", async () => {
      const tenants = await platformRepo.listTenants();
      const ids = tenants.map((t) => t.id);
      expect(ids).toContain(tenantA);
      expect(ids).toContain(tenantB);
    });

    it("returns null for an unknown tenant", async () => {
      const meta = await platformRepo.getTenantMetadata(
        "00000000-0000-7000-8000-0000000000ff",
      );
      expect(meta).toBeNull();
    });
  });

  it("[INV-TEN-3] service_role is DENIED SELECT on period_summaries (no grant)", async () => {
    await expect(
      serviceRole.query(`SELECT * FROM period_summaries`),
    ).rejects.toThrow(/permission denied/i);
  });
});
