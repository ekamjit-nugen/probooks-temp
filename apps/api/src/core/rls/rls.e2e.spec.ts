/**
 * RLS defense-in-depth integration suite (STANDARDS §8.4, §19.2; INV-TEN-1/2/3).
 *
 * Boots a REAL Postgres 16 (Testcontainers — never SQLite), applies the
 * committed migrations, and proves tenant isolation the way production runs it:
 * connected as the NON-superuser, non-owner `app_user` role with FORCE RLS.
 *
 * The load-bearing assertion: with app.tenant_id bound to tenant A, a query for
 * tenant B's rows returns ZERO rows EVEN WHEN the application `where` filter is
 * removed. RLS is the backstop, not the app code.
 */
import { join } from "node:path";

import {
  startPostgresHarness,
  type PostgresHarness,
} from "@probooks/test-utils";
import { Client } from "pg";

import {
  TENANT_SCOPED_TABLES,
  verifyRlsEnabled,
  type RlsQueryClient,
} from "./rls.verifier";

const PRISMA_DIR = join(__dirname, "..", "..", "..", "prisma");

// Container pull + migrate can be slow on a cold cache.
jest.setTimeout(180_000);

interface IdRow {
  id: string;
}
interface TenantRow {
  tenant_id: string;
}
interface RoleFlagsRow {
  rolsuper: boolean;
  rolbypassrls: boolean;
}

/** Adapt a pg.Client to the RlsQueryClient surface the verifier expects. */
function asRlsClient(client: Client): RlsQueryClient {
  return {
    $queryRawUnsafe: async <T>(
      query: string,
      ...values: unknown[]
    ): Promise<T> => {
      const res = await client.query(query, values);
      return res.rows as unknown as T;
    },
  };
}

describe("RLS tenant isolation as app_user [INV-TEN-1][INV-TEN-2][INV-TEN-3]", () => {
  let harness: PostgresHarness;
  let serviceRole: Client; // BYPASSRLS — seeds fixtures across tenants
  let appUser: Client; // RLS-enforced — the realistic application connection
  let tenantA = "";
  let tenantB = "";
  let clientA = "";
  let clientB = "";

  beforeAll(async () => {
    harness = await startPostgresHarness(PRISMA_DIR);

    serviceRole = new Client({ connectionString: harness.serviceRoleUrl });
    await serviceRole.connect();

    // Seed two tenants + a client each, via service_role (BYPASSRLS) — models
    // platform/migration seeding (STANDARDS §9.6).
    const a = await serviceRole.query<IdRow>(
      `INSERT INTO tenants (status) VALUES ('active') RETURNING id`,
    );
    const b = await serviceRole.query<IdRow>(
      `INSERT INTO tenants (status) VALUES ('active') RETURNING id`,
    );
    tenantA = a.rows[0]?.id ?? "";
    tenantB = b.rows[0]?.id ?? "";

    const ca = await serviceRole.query<IdRow>(
      `INSERT INTO clients (tenant_id, name) VALUES ($1, 'Client A') RETURNING id`,
      [tenantA],
    );
    const cb = await serviceRole.query<IdRow>(
      `INSERT INTO clients (tenant_id, name) VALUES ($1, 'Client B') RETURNING id`,
      [tenantB],
    );
    clientA = ca.rows[0]?.id ?? "";
    clientB = cb.rows[0]?.id ?? "";

    appUser = new Client({ connectionString: harness.appUserUrl });
    await appUser.connect();
  });

  afterAll(async () => {
    await appUser?.end();
    await serviceRole?.end();
    await harness?.stop();
  });

  it("every tenant-scoped table is RLS enabled AND forced", async () => {
    await expect(
      verifyRlsEnabled(asRlsClient(serviceRole), TENANT_SCOPED_TABLES),
    ).resolves.toBeUndefined();
  });

  it("app_user is NOT a superuser and does NOT bypass RLS (test validity)", async () => {
    const res = await appUser.query<RoleFlagsRow>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(res.rows[0]?.rolsuper).toBe(false);
    expect(res.rows[0]?.rolbypassrls).toBe(false);
  });

  it("with tenant A bound, sees ONLY tenant A's clients", async () => {
    await appUser.query("BEGIN");
    await appUser.query(`SET LOCAL app.tenant_id = '${tenantA}'`);
    const res = await appUser.query<IdRow & TenantRow>(
      `SELECT id, tenant_id FROM clients`,
    );
    await appUser.query("COMMIT");

    expect(res.rowCount).toBe(1);
    expect(res.rows[0]?.tenant_id).toBe(tenantA);
    expect(res.rows[0]?.id).toBe(clientA);
  });

  it("[INV-TEN-1] returns ZERO of tenant B's rows EVEN WITHOUT a where filter", async () => {
    // The whole point: bind tenant A, then query tenant B's client BY ID with no
    // tenant_id in the WHERE. RLS — not the app — returns zero rows.
    await appUser.query("BEGIN");
    await appUser.query(`SET LOCAL app.tenant_id = '${tenantA}'`);
    const res = await appUser.query(`SELECT id FROM clients WHERE id = $1`, [
      clientB,
    ]);
    await appUser.query("COMMIT");

    expect(res.rowCount).toBe(0);
  });

  it("[INV-TEN-1] RLS also blocks INSERTing a row for another tenant (WITH CHECK)", async () => {
    await appUser.query("BEGIN");
    await appUser.query(`SET LOCAL app.tenant_id = '${tenantA}'`);
    await expect(
      appUser.query(
        `INSERT INTO clients (tenant_id, name) VALUES ($1, 'cross-tenant')`,
        [tenantB],
      ),
    ).rejects.toThrow(/row-level security/i);
    await appUser.query("ROLLBACK");
  });

  it("SET LOCAL is per-transaction: the binding does not leak afterwards", async () => {
    await appUser.query("BEGIN");
    await appUser.query(`SET LOCAL app.tenant_id = '${tenantA}'`);
    await appUser.query("COMMIT");

    // Outside the transaction the setting is reset; current_setting(..., true)
    // returns '' so the policy matches nothing → zero rows (fail-closed).
    const res = await appUser.query(`SELECT id FROM clients`);
    expect(res.rowCount).toBe(0);
  });

  it("unseeded app_user (no app.tenant_id) sees zero rows (fail-closed)", async () => {
    const res = await appUser.query(`SELECT id FROM clients`);
    expect(res.rowCount).toBe(0);
  });

  it("[INV-TEN-3] service_role bypasses RLS and reads across tenants", async () => {
    const res = await serviceRole.query<TenantRow>(
      `SELECT tenant_id FROM clients ORDER BY name`,
    );
    const tenantIds = res.rows.map((r) => r.tenant_id);
    expect(tenantIds).toContain(tenantA);
    expect(tenantIds).toContain(tenantB);
    expect(res.rowCount).toBeGreaterThanOrEqual(2);
  });

  it("[INV-AUDIT-2/3] app_user can INSERT audit_log but cannot UPDATE/DELETE it", async () => {
    await appUser.query("BEGIN");
    await appUser.query(`SET LOCAL app.tenant_id = '${tenantA}'`);
    // Wave 4 (20260605120000) added the hash-chain columns as NOT NULL, so this
    // raw INSERT must now supply position/prev_hash/entry_hash/occurred_at. The
    // append-only grant proof (INSERT ok, UPDATE/DELETE denied) is unchanged.
    await appUser.query(
      `INSERT INTO audit_log
         (tenant_id, position, prev_hash, entry_hash, action, entity_type, occurred_at)
       VALUES ($1, 1, 'genesis', $2, 'period.processed', 'period', now())`,
      [tenantA, "a".repeat(64)],
    );
    await appUser.query("COMMIT");

    await appUser.query("BEGIN");
    await appUser.query(`SET LOCAL app.tenant_id = '${tenantA}'`);
    await expect(
      appUser.query(`UPDATE audit_log SET action = 'tampered'`),
    ).rejects.toThrow(/permission denied/i);
    await appUser.query("ROLLBACK");

    await appUser.query("BEGIN");
    await appUser.query(`SET LOCAL app.tenant_id = '${tenantA}'`);
    await expect(appUser.query(`DELETE FROM audit_log`)).rejects.toThrow(
      /permission denied/i,
    );
    await appUser.query("ROLLBACK");
  });
});
