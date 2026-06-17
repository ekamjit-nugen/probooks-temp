/**
 * Audit hash-chain integration suite (STANDARDS §19.2; INV-AUDIT-1/2/3).
 *
 * Boots a REAL Postgres 16 (Testcontainers — never SQLite), applies the
 * committed migrations, and exercises the audit domain the way production runs
 * it: AuditService → AuditRepository → PrismaService.runInTenantTx (SET LOCAL
 * app.tenant_id) connected as the NON-superuser app_user role, so RLS + the
 * append-only grants bind.
 *
 * Tampering is performed as the DB owner (superuser) to MODEL a privileged,
 * out-of-band attacker — note even service_role has only SELECT,INSERT on
 * audit_log (the append-only grant covers it too). The verifier, running as the
 * normal app, must still catch it. app_user itself is proven unable to
 * UPDATE/DELETE audit_log at all.
 */
import { join } from "node:path";

import type { Permission, TenantId, UserId } from "@probooks/shared";
import {
  startPostgresHarness,
  type PostgresHarness,
} from "@probooks/test-utils";
import { Client as PgClient } from "pg";

import { AppConfigService } from "../../core/config-env/app-config.service";
import { PrismaService } from "../../core/prisma/prisma.service";
import type { TenantContext } from "../../core/tenant-context/tenant-context";
import { TenantContextService } from "../../core/tenant-context/tenant-context.service";

import { AuditChainTamperError } from "./audit.errors";
import { AuditRepository } from "./audit.repository";
import { AuditService } from "./audit.service";

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

describe("Audit hash chain over RLS as app_user [INV-AUDIT-1][INV-AUDIT-2][INV-AUDIT-3]", () => {
  let harness: PostgresHarness;
  let prisma: PrismaService;
  let context: TenantContextService;
  let repo: AuditRepository;
  let service: AuditService;
  let serviceRole: PgClient; // BYPASSRLS — seeds fixtures across tenants
  // Superuser/owner — models an out-of-band tamper. Note: even service_role has
  // only SELECT,INSERT on audit_log (the append-only grant covers it too), so
  // the realistic "privileged attacker who got DB-owner access" is the owner.
  let owner: PgClient;
  let tenantA = "";
  let tenantB = "";
  const fixedNow = new Date("2026-06-05T09:30:00.000Z");

  beforeAll(async () => {
    harness = await startPostgresHarness(
      join(__dirname, "..", "..", "..", "prisma"),
    );

    serviceRole = new PgClient({ connectionString: harness.serviceRoleUrl });
    await serviceRole.connect();
    owner = new PgClient({ connectionString: harness.ownerUrl });
    await owner.connect();
    const a = await serviceRole.query<IdRow>(
      `INSERT INTO tenants (status) VALUES ('active') RETURNING id`,
    );
    const b = await serviceRole.query<IdRow>(
      `INSERT INTO tenants (status) VALUES ('active') RETURNING id`,
    );
    tenantA = a.rows[0]?.id ?? "";
    tenantB = b.rows[0]?.id ?? "";

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
    repo = new AuditRepository(prisma, context);
    service = new AuditService(repo, context, () => fixedNow);
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await owner?.end();
    await serviceRole?.end();
    await harness?.stop();
  });

  it("[INV-AUDIT-1] appends who/what/when/before→after and chains from prev_hash", async () => {
    await context.runWithContext(firmContext(tenantA), async () => {
      const first = await service.record({
        action: "period.processed",
        entityType: "period",
        entityId: null,
        beforeState: { state: "open" },
        afterState: { state: "processed" },
      });
      const second = await service.record({
        action: "period.filed",
        entityType: "period",
        entityId: null,
        beforeState: { state: "processed" },
        afterState: { state: "filed" },
      });

      expect(first.position).toBe(1);
      expect(second.position).toBe(2);
      // The second entry links to the first (chain integrity).
      expect(second.prevHash).toBe(first.entryHash);
    });

    // Persisted row carries who (actor) + when (occurredAt) + before→after.
    const persisted = await serviceRole.query(
      `SELECT actor_user_id, actor_role, occurred_at, before_state, after_state
         FROM audit_log WHERE tenant_id = $1 ORDER BY position ASC LIMIT 1`,
      [tenantA],
    );
    const row = persisted.rows[0] as {
      actor_user_id: string;
      actor_role: string;
      occurred_at: Date;
      before_state: unknown;
      after_state: unknown;
    };
    expect(row.actor_user_id).toBe("00000000-0000-7000-8000-0000000000aa");
    expect(row.actor_role).toBe("firm_admin");
    expect(new Date(row.occurred_at).toISOString()).toBe(
      fixedNow.toISOString(),
    );
    expect(row.before_state).toEqual({ state: "open" });
    expect(row.after_state).toEqual({ state: "processed" });
  });

  it("verifier passes on an intact chain", async () => {
    await expect(
      context.runWithContext(firmContext(tenantA), () => service.verify()),
    ).resolves.toBeUndefined();
  });

  it("[INV-AUDIT-2] verifier FAILS at the first entry when a field is mutated (out-of-band DB owner)", async () => {
    // Mutate tenant A's position-1 action out of band as the DB owner (app_user
    // AND service_role both lack UPDATE — proven below). The stored entry_hash
    // now disagrees with a fresh recomputation.
    await owner.query(
      `UPDATE audit_log SET action = 'period.HACKED' WHERE tenant_id = $1 AND position = 1`,
      [tenantA],
    );

    const verify = context.runWithContext(firmContext(tenantA), () =>
      service.verify(),
    );
    await expect(verify).rejects.toBeInstanceOf(AuditChainTamperError);
    await expect(verify).rejects.toMatchObject({
      position: 1,
      reason: "entry-hash-mismatch",
    });

    // Restore so later tests start from a clean chain for tenant A.
    await owner.query(
      `UPDATE audit_log SET action = 'period.processed' WHERE tenant_id = $1 AND position = 1`,
      [tenantA],
    );
  });

  it("[INV-AUDIT-2] verifier FAILS when a middle entry is deleted (out-of-band DB owner)", async () => {
    // Build a fresh 3-entry chain for tenant B, then delete the middle one.
    await context.runWithContext(firmContext(tenantB), async () => {
      await service.record({
        action: "a.1",
        entityType: "x",
        entityId: null,
        beforeState: null,
        afterState: { n: 1 },
      });
      await service.record({
        action: "a.2",
        entityType: "x",
        entityId: null,
        beforeState: { n: 1 },
        afterState: { n: 2 },
      });
      await service.record({
        action: "a.3",
        entityType: "x",
        entityId: null,
        beforeState: { n: 2 },
        afterState: { n: 3 },
      });
    });
    await owner.query(
      `DELETE FROM audit_log WHERE tenant_id = $1 AND position = 2`,
      [tenantB],
    );

    const verify = context.runWithContext(firmContext(tenantB), () =>
      service.verify(),
    );
    await expect(verify).rejects.toBeInstanceOf(AuditChainTamperError);
    await expect(verify).rejects.toMatchObject({ position: 3 });
  });

  it("[INV-AUDIT-2] verifier FAILS when an entry is inserted out of order (forged INSERT)", async () => {
    // Seed a clean tenant; insert a forged row with a position that breaks the
    // sequence / prev-hash linkage.
    const c = await serviceRole.query<IdRow>(
      `INSERT INTO tenants (status) VALUES ('active') RETURNING id`,
    );
    const tenantC = c.rows[0]?.id ?? "";
    await context.runWithContext(firmContext(tenantC), async () => {
      await service.record({
        action: "c.1",
        entityType: "x",
        entityId: null,
        beforeState: null,
        afterState: { n: 1 },
      });
      await service.record({
        action: "c.2",
        entityType: "x",
        entityId: null,
        beforeState: { n: 1 },
        afterState: { n: 2 },
      });
    });
    // Forge a position-3 row whose prev_hash does NOT chain from position 2.
    await serviceRole.query(
      `INSERT INTO audit_log
         (tenant_id, position, prev_hash, entry_hash, action, entity_type, occurred_at)
       VALUES ($1, 3, 'not-the-real-prev', $2, 'c.forged', 'x', now())`,
      [tenantC, "f".repeat(64)],
    );

    const verify = context.runWithContext(firmContext(tenantC), () =>
      service.verify(),
    );
    await expect(verify).rejects.toBeInstanceOf(AuditChainTamperError);
    await expect(verify).rejects.toMatchObject({ position: 3 });
  });

  it("[INV-AUDIT-2][INV-AUDIT-3] app_user can INSERT but CANNOT UPDATE/DELETE audit_log", async () => {
    const appUser = new PgClient({ connectionString: harness.appUserUrl });
    await appUser.connect();
    try {
      await appUser.query("BEGIN");
      await appUser.query(`SET LOCAL app.tenant_id = '${tenantA}'`);
      await expect(
        appUser.query(`UPDATE audit_log SET action = 'x'`),
      ).rejects.toThrow(/permission denied/i);
      await appUser.query("ROLLBACK");

      await appUser.query("BEGIN");
      await appUser.query(`SET LOCAL app.tenant_id = '${tenantA}'`);
      await expect(appUser.query(`DELETE FROM audit_log`)).rejects.toThrow(
        /permission denied/i,
      );
      await appUser.query("ROLLBACK");
    } finally {
      await appUser.end();
    }
  });

  it("[INV-AUDIT-1] is atomic: a parent tx that throws after the audit write persists NO row", async () => {
    const d = await serviceRole.query<IdRow>(
      `INSERT INTO tenants (status) VALUES ('active') RETURNING id`,
    );
    const tenantD = d.rows[0]?.id ?? "";

    await context.runWithContext(firmContext(tenantD), async () => {
      await expect(
        prisma.runInTenantTx(async (tx) => {
          await service.record(
            {
              action: "d.rollback",
              entityType: "x",
              entityId: null,
              beforeState: null,
              afterState: { n: 1 },
            },
            tx,
          );
          throw new Error("parent failed after audit write");
        }),
      ).rejects.toThrow(/parent failed/);
    });

    const after = await serviceRole.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1`,
      [tenantD],
    );
    expect((after.rows[0] as { n: number }).n).toBe(0);
  });

  it("[INV-AUDIT-1] is atomic: a parent tx that commits persists the audit row WITH it", async () => {
    const e = await serviceRole.query<IdRow>(
      `INSERT INTO tenants (status) VALUES ('active') RETURNING id`,
    );
    const tenantE = e.rows[0]?.id ?? "";

    await context.runWithContext(firmContext(tenantE), () =>
      prisma.runInTenantTx((tx) =>
        service.record(
          {
            action: "e.commit",
            entityType: "x",
            entityId: null,
            beforeState: null,
            afterState: { n: 1 },
          },
          tx,
        ),
      ),
    );

    const after = await serviceRole.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1`,
      [tenantE],
    );
    expect((after.rows[0] as { n: number }).n).toBe(1);
  });

  it("concurrency: two concurrent appends for one tenant produce a valid, fork-free chain", async () => {
    const f = await serviceRole.query<IdRow>(
      `INSERT INTO tenants (status) VALUES ('active') RETURNING id`,
    );
    const tenantF = f.rows[0]?.id ?? "";

    const append = (n: number): Promise<unknown> =>
      context.runWithContext(firmContext(tenantF), () =>
        service.record({
          action: `f.${String(n)}`,
          entityType: "x",
          entityId: null,
          beforeState: null,
          afterState: { n },
        }),
      );

    // Fire many appends concurrently; the per-tenant advisory lock serializes
    // them so positions are a contiguous 1..N with no fork.
    await Promise.all(Array.from({ length: 10 }, (_, i) => append(i + 1)));

    await expect(
      context.runWithContext(firmContext(tenantF), () => service.verify()),
    ).resolves.toBeUndefined();

    const rows = await serviceRole.query(
      `SELECT position FROM audit_log WHERE tenant_id = $1 ORDER BY position ASC`,
      [tenantF],
    );
    const positions = rows.rows.map((r) =>
      Number((r as { position: string }).position),
    );
    expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("tenant isolation: tenant A's verifier never sees tenant B's entries (RLS)", async () => {
    // listInOrder under tenant A must return only A's rows. We assert by count:
    // A has 2 (from the first test, restored intact); B has 3 with a gap.
    const aRows = await context.runWithContext(firmContext(tenantA), () =>
      repo.listInOrder(),
    );
    expect(aRows.every((r) => r.tenantId === tenantA)).toBe(true);
    expect(aRows).toHaveLength(2);

    // A's chain (untouched / restored) still verifies despite B being tampered.
    await expect(
      context.runWithContext(firmContext(tenantA), () => service.verify()),
    ).resolves.toBeUndefined();
  });
});
