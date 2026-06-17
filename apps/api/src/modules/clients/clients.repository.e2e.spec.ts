/**
 * Cross-module integration: ClientRepository → PrismaService.runInTenantTx →
 * SET LOCAL app.tenant_id → RLS (STANDARDS §9.3, §8.4; INV-TEN-1/2).
 *
 * Proves the §9.3 repository pattern end to end against a REAL Postgres: the
 * repository reads the tenant from TenantContext (never a param), PrismaService
 * binds it for the transaction, and RLS guarantees a repository running under
 * tenant A cannot see tenant B's rows — even though both rows exist.
 */
import { join } from "node:path";

import type { Permission, TenantId, UserId } from "@probooks/shared";
import {
  startPostgresHarness,
  type PostgresHarness,
} from "@probooks/test-utils";
import { Client as PgClient } from "pg";

interface IdRow {
  id: string;
}

import { AppConfigService } from "../../core/config-env/app-config.service";
import { PrismaService } from "../../core/prisma/prisma.service";
import type { TenantContext } from "../../core/tenant-context/tenant-context";
import { NoTenantContextError } from "../../core/tenant-context/tenant-context.errors";
import { TenantContextService } from "../../core/tenant-context/tenant-context.service";

import { ClientRepository } from "./clients.repository";

jest.setTimeout(180_000);

function firmContext(tenantId: string): TenantContext {
  return {
    tenantId: tenantId as TenantId,
    userId: "00000000-0000-7000-8000-000000000001" as UserId,
    userRole: "firm_admin",
    permissions: new Set<Permission>(),
  };
}

describe("ClientRepository over RLS [STD-9.3][INV-TEN-1][INV-TEN-2]", () => {
  let harness: PostgresHarness;
  let prisma: PrismaService;
  let tenantContext: TenantContextService;
  let repo: ClientRepository;
  let tenantA = "";
  let tenantB = "";
  let clientB = "";

  beforeAll(async () => {
    harness = await startPostgresHarness(
      join(__dirname, "..", "..", "..", "prisma"),
    );

    // Seed two tenants + a client each via service_role (BYPASSRLS).
    const admin = new PgClient({ connectionString: harness.serviceRoleUrl });
    await admin.connect();
    const a = await admin.query<IdRow>(
      `INSERT INTO tenants (status) VALUES ('active') RETURNING id`,
    );
    const b = await admin.query<IdRow>(
      `INSERT INTO tenants (status) VALUES ('active') RETURNING id`,
    );
    tenantA = a.rows[0]?.id ?? "";
    tenantB = b.rows[0]?.id ?? "";
    await admin.query(
      `INSERT INTO clients (tenant_id, name) VALUES ($1, 'Alpha Co')`,
      [tenantA],
    );
    const cb = await admin.query<IdRow>(
      `INSERT INTO clients (tenant_id, name) VALUES ($1, 'Bravo Co') RETURNING id`,
      [tenantB],
    );
    clientB = cb.rows[0]?.id ?? "";
    await admin.end();

    // Wire PrismaService (app_user — RLS-enforced) + context + repository.
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
    tenantContext = new TenantContextService();
    prisma = new PrismaService(config, tenantContext);
    await prisma.onModuleInit();
    repo = new ClientRepository(prisma, tenantContext);
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await harness?.stop();
  });

  it("listForTenant returns only the current tenant's clients", async () => {
    const aClients = await tenantContext.runWithContext(
      firmContext(tenantA),
      () => repo.listForTenant(),
    );
    const bClients = await tenantContext.runWithContext(
      firmContext(tenantB),
      () => repo.listForTenant(),
    );

    expect(aClients).toHaveLength(1);
    expect(aClients[0]?.name).toBe("Alpha Co");
    expect(bClients).toHaveLength(1);
    expect(bClients[0]?.name).toBe("Bravo Co");
  });

  it("[INV-TEN-2] cannot fetch another tenant's client by id (RLS → null)", async () => {
    const result = await tenantContext.runWithContext(
      firmContext(tenantA),
      () => repo.findByIdForTenant(clientB),
    );

    expect(result).toBeNull();
  });

  it("[INV-TEN-1] fails closed when no tenant context is in scope", async () => {
    await expect(repo.listForTenant()).rejects.toBeInstanceOf(
      NoTenantContextError,
    );
  });
});
