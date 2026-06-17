/**
 * Phase 0 / Wave 8 — THE COMPOSED FULL SPINE (STANDARDS §6, §9.3, §9.4, §10.2,
 * §12, §19.2/§19.3; INV-AUTH-4, INV-TEN-1/2/3, INV-AUDIT-1/2, §7.4).
 *
 * Every prior wave proved one primitive in isolation. This suite proves they
 * COMPOSE end to end the way production runs them:
 *
 *   real signed HS256 token  (HmacTokenService, Wave 3)
 *     -> GUARD_STACK: Auth -> Tenant -> Role -> Resource  (Wave 3)
 *       -> TenantContextInterceptor seeds ALS from the VERIFIED claim  (Wave 2)
 *         -> @Idempotent IdempotencyInterceptor  (Wave 5)
 *           -> ONE tenant-scoped tx (PrismaService.runInTenantTx, app_user/RLS):
 *                ClientRepository.create(tx)          tenant-scoped write (Wave 2)
 *                + AuditService.record(input, tx)     atomic audit append (Wave 4)
 *
 * It boots a REAL Postgres 16 (Testcontainers — never SQLite, §19.2), applies
 * the committed migrations, connects as the NON-superuser app_user so RLS +
 * grants bind, and drives the app with supertest. The test controller/module are
 * defined INLINE (test-only) and reuse the real services/repos/guards/
 * interceptors — no new files under src/modules.
 */
import { join } from "node:path";

import {
  Body,
  Controller,
  Injectable,
  Post,
  UseGuards,
  UseInterceptors,
  type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { TenantId, UserId, UserRole } from "@probooks/shared";
import {
  startPostgresHarness,
  type PostgresHarness,
} from "@probooks/test-utils";
import { Client as PgClient } from "pg";
import request from "supertest";
import type { App } from "supertest/types";

import { AuthModule } from "./core/auth/auth.module";
import { HmacTokenService } from "./core/auth/hmac-token.service";
import type { AccessSubject } from "./core/auth/token-contract";
import { AppConfigService } from "./core/config-env/app-config.service";
import { ConfigEnvModule } from "./core/config-env/config-env.module";
import type { AppConfig } from "./core/config-env/env.schema";
import { ErrorsModule } from "./core/errors/errors.module";
import { PlatformPrismaService } from "./core/prisma/platform-prisma.service";
import { PrismaService } from "./core/prisma/prisma.service";
import { RequirePermission } from "./core/rbac/rbac.decorators";
import { RbacModule } from "./core/rbac/rbac.module";
import { GUARD_STACK } from "./core/tenancy-guard/guard-stack";
import { TenancyGuardModule } from "./core/tenancy-guard/tenancy-guard.module";
import type { TenantContext } from "./core/tenant-context/tenant-context";
import { TenantContextInterceptor } from "./core/tenant-context/tenant-context.interceptor";
import { TenantContextModule } from "./core/tenant-context/tenant-context.module";
import { TenantContextService } from "./core/tenant-context/tenant-context.service";
import { AuditChainTamperError } from "./modules/audit/audit.errors";
import { AuditModule } from "./modules/audit/audit.module";
import { AuditService } from "./modules/audit/audit.service";
import { ClientRepository } from "./modules/clients/clients.repository";
import { FinancialController } from "./modules/financial/financial.controller";
import { FinancialRepository } from "./modules/financial/financial.repository";
import { FinancialService } from "./modules/financial/financial.service";
import { Idempotent } from "./modules/idempotency/idempotency.decorator";
import { IdempotencyInterceptor } from "./modules/idempotency/idempotency.interceptor";
import { IdempotencyModule } from "./modules/idempotency/idempotency.module";

jest.setTimeout(180_000);

const SECRET = "spine-e2e-integration-secret-at-least-32!!";

interface IdRow {
  id: string;
}

/** Counts how many times the real handler body executed (idempotency proof). */
@Injectable()
class CallRecorder {
  count = 0;
  reset(): void {
    this.count = 0;
  }
}

/**
 * Test-only controller: the composed write surface. Scoped under
 * /v1/firms/:firmId so the TenantGuard binds (cross-tenant path -> 404). The
 * handler performs, in ONE tenant-scoped transaction:
 *   - a real tenant-scoped write through ClientRepository.create(tx), AND
 *   - an atomic AuditService.record(input, tx),
 * so both commit or roll back together (INV-AUDIT-1). @Idempotent + the
 * IdempotencyInterceptor front it so a replay never re-runs the body.
 *
 * Guarded by `client:create_configure` (SPEC §4.17): firm_admin + accountant
 * hold it; platform_operator / client_owner / client_staff do not.
 */
@Controller("v1/firms/:firmId/clients")
@UseGuards(...GUARD_STACK)
class SpineClientsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientRepository,
    private readonly audit: AuditService,
    private readonly recorder: CallRecorder,
  ) {}

  @Post()
  @RequirePermission("client:create_configure")
  @UseInterceptors(IdempotencyInterceptor)
  @Idempotent()
  async create(@Body() body: { name?: string }): Promise<{ id: string }> {
    this.recorder.count += 1;
    const name = body.name ?? "Unnamed Co";
    return this.prisma.runInTenantTx(async (tx) => {
      const created = await this.clients.create({ name }, tx);
      await this.audit.record(
        {
          action: "client.created",
          entityType: "client",
          entityId: created.id,
          beforeState: null,
          afterState: { name },
        },
        tx,
      );
      return { id: created.id };
    });
  }
}

describe("Full spine composition over RLS as app_user [STD-9.3][STD-10.2][INV-AUTH-4][INV-TEN-1][INV-TEN-2][INV-TEN-3][INV-AUDIT-1][INV-AUDIT-2][STD-7.4]", () => {
  let harness: PostgresHarness;
  let app: INestApplication;
  let signer: HmacTokenService;
  let serviceRole: PgClient;
  let owner: PgClient;
  let tenantA = "";
  let tenantB = "";

  beforeAll(async () => {
    harness = await startPostgresHarness(join(__dirname, "..", "prisma"));

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

    // Real config: app_user URL (RLS) + service_role URL + a real JWT secret so
    // HmacTokenService genuinely signs/verifies. We OVERRIDE AppConfigService so
    // PrismaService connects to THIS container (not process.env).
    const config: AppConfig = {
      nodeEnv: "test",
      port: 3000,
      logLevel: "info",
      databaseUrl: harness.appUserUrl,
      databaseServiceRoleUrl: harness.serviceRoleUrl,
      jwtSecret: SECRET,
      jwtAccessTtlSeconds: 900,
      jwtRefreshTtlSeconds: 28_800,
    };
    // PlatformPrismaService would open a second (service_role) pool we never use
    // on this path; stub it so boot needs only the one app_user connection.
    const platformStub = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigEnvModule,
        ErrorsModule,
        TenantContextModule,
        AuthModule,
        RbacModule,
        TenancyGuardModule,
        AuditModule,
        IdempotencyModule,
      ],
      controllers: [SpineClientsController, FinancialController],
      providers: [
        ClientRepository,
        FinancialRepository,
        FinancialService,
        CallRecorder,
      ],
    })
      .overrideProvider(AppConfigService)
      .useValue(new AppConfigService(config))
      .overrideProvider(PlatformPrismaService)
      .useValue(platformStub)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(app.get(TenantContextInterceptor));
    await app.init();
    signer = app.get(HmacTokenService);
  });

  afterAll(async () => {
    await app?.close();
    await owner?.end();
    await serviceRole?.end();
    await harness?.stop();
  });

  // --- helpers ------------------------------------------------------------

  const CLIENT_ID = "cccccccc-cccc-7ccc-8ccc-cccccccccccc";

  function tokenFor(role: UserRole, tenantId: string): string {
    const base: AccessSubject = {
      tenantId,
      userId: "22222222-2222-7222-8222-222222222222",
      role,
    };
    const subject =
      role === "client_owner" || role === "client_staff"
        ? { ...base, clientId: CLIENT_ID }
        : base;
    return signer.signAccessToken(subject);
  }

  function auth(role: UserRole, tenantId: string): string {
    return `Bearer ${tokenFor(role, tenantId)}`;
  }

  function http(): ReturnType<typeof request> {
    return request(app.getHttpServer() as App);
  }

  /** A firm_admin TenantContext for driving the AuditService verifier in-band. */
  function firmContext(tenantId: string): TenantContext {
    return {
      tenantId: tenantId as TenantId,
      userId: "22222222-2222-7222-8222-222222222222" as UserId,
      userRole: "firm_admin",
      permissions: new Set(),
    };
  }

  /** Run the real AuditService chain verifier under the given tenant's ALS. */
  function verifyChainFor(tenantId: string): Promise<void> {
    return app
      .get(TenantContextService)
      .runWithContext(firmContext(tenantId), () =>
        app.get(AuditService).verify(),
      );
  }

  async function countClients(tenantId: string): Promise<number> {
    const r = await serviceRole.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM clients WHERE tenant_id = $1`,
      [tenantId],
    );
    return r.rows[0]?.n ?? -1;
  }

  async function countAudit(tenantId: string): Promise<number> {
    const r = await serviceRole.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1`,
      [tenantId],
    );
    return r.rows[0]?.n ?? -1;
  }

  // --- 1. Happy path -------------------------------------------------------

  it("[INV-AUTH-4][INV-TEN-1][INV-AUDIT-1][§9.3][§10.2] firm_admin + Idempotency-Key → 201, writes the client AND audit atomically, chain verifies", async () => {
    // Arrange: a fresh tenant so counts are unambiguous.
    const t =
      (
        await serviceRole.query<IdRow>(
          `INSERT INTO tenants (status) VALUES ('active') RETURNING id`,
        )
      ).rows[0]?.id ?? "";
    const key = "10000000-0000-7000-8000-000000000001";

    // Act: the full spine — verified token → guards → ALS → idempotency → tx.
    const res = await http()
      .post(`/v1/firms/${t}/clients`)
      .set("authorization", auth("firm_admin", t))
      .set("idempotency-key", key)
      .send({ name: "Acme Bookkeeping" })
      .expect(201);

    // Assert: HTTP shape + BOTH side effects landed in the SAME transaction.
    expect((res.body as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await countClients(t)).toBe(1);
    expect(await countAudit(t)).toBe(1);

    // The appended audit entry points at the row that was written.
    const link = await serviceRole.query<{ entity_id: string; action: string }>(
      `SELECT entity_id, action FROM audit_log WHERE tenant_id = $1`,
      [t],
    );
    expect(link.rows[0]?.action).toBe("client.created");
    expect(link.rows[0]?.entity_id).toBe((res.body as { id: string }).id);

    // The tenant's hash chain verifies clean through the real AuditService.
    await expect(verifyChainFor(t)).resolves.toBeUndefined();
  });

  // --- 2. Idempotent replay ----------------------------------------------

  it("[§7.4] same key + same body replays the response with the side effect EXACTLY once", async () => {
    const t =
      (
        await serviceRole.query<IdRow>(
          `INSERT INTO tenants (status) VALUES ('active') RETURNING id`,
        )
      ).rows[0]?.id ?? "";
    const recorder = app.get(CallRecorder);
    recorder.reset();
    const key = "20000000-0000-7000-8000-000000000002";

    const first = await http()
      .post(`/v1/firms/${t}/clients`)
      .set("authorization", auth("firm_admin", t))
      .set("idempotency-key", key)
      .send({ name: "Replay Co" })
      .expect(201);

    const second = await http()
      .post(`/v1/firms/${t}/clients`)
      .set("authorization", auth("firm_admin", t))
      .set("idempotency-key", key)
      .send({ name: "Replay Co" })
      .expect(201);

    // Handler ran ONCE; replayed body is byte-identical; ONE row, ONE audit row.
    expect(recorder.count).toBe(1);
    expect(second.body).toEqual(first.body);
    expect(await countClients(t)).toBe(1);
    expect(await countAudit(t)).toBe(1);
  });

  // --- 3. Idempotency conflict -------------------------------------------

  it("[§7.4] same key + DIFFERENT body → 409, no second write", async () => {
    const t =
      (
        await serviceRole.query<IdRow>(
          `INSERT INTO tenants (status) VALUES ('active') RETURNING id`,
        )
      ).rows[0]?.id ?? "";
    const key = "30000000-0000-7000-8000-000000000003";

    await http()
      .post(`/v1/firms/${t}/clients`)
      .set("authorization", auth("firm_admin", t))
      .set("idempotency-key", key)
      .send({ name: "Original Co" })
      .expect(201);

    const conflict = await http()
      .post(`/v1/firms/${t}/clients`)
      .set("authorization", auth("firm_admin", t))
      .set("idempotency-key", key)
      .send({ name: "DIFFERENT Co" })
      .expect(409);

    expect((conflict.body as { error: { code: string } }).error.code).toBe(
      "IDEMPOTENCY_KEY_CONFLICT",
    );
    // The conflict was rejected before the handler — still exactly one of each.
    expect(await countClients(t)).toBe(1);
    expect(await countAudit(t)).toBe(1);
  });

  // --- 4. Cross-tenant isolation -----------------------------------------

  describe("[INV-TEN-1][INV-TEN-2][§9.4] cross-tenant isolation", () => {
    it("a tenant-A token probing tenant B's path → 404 (not 403)", async () => {
      await http()
        .post(`/v1/firms/${tenantB}/clients`)
        .set("authorization", auth("firm_admin", tenantA))
        .set("idempotency-key", "40000000-0000-7000-8000-000000000004")
        .send({ name: "Probe Co" })
        .expect(404);
    });

    it("[RLS backstop] as app_user a cross-tenant read returns 0 rows even if the app-layer tenant filter were removed", async () => {
      // Seed a client for tenant B via service_role (BYPASSRLS).
      await serviceRole.query(
        `INSERT INTO clients (tenant_id, name) VALUES ($1, 'Bravo Only')`,
        [tenantB],
      );

      // Connect as the NON-superuser app_user, bind tenant A, then run a SELECT
      // with NO tenant_id predicate at all (simulating an app-layer filter bug).
      // RLS alone must still hide tenant B's row — defense in depth (§9.4).
      const appUser = new PgClient({ connectionString: harness.appUserUrl });
      await appUser.connect();
      try {
        await appUser.query("BEGIN");
        await appUser.query(`SET LOCAL app.tenant_id = '${tenantA}'`);
        const all = await appUser.query<{ tenant_id: string }>(
          `SELECT tenant_id FROM clients`, // NB: no WHERE — RLS is the only guard
        );
        await appUser.query("COMMIT");
        expect(all.rows.every((r) => r.tenant_id === tenantA)).toBe(true);
        expect(all.rows.some((r) => r.tenant_id === tenantB)).toBe(false);
      } finally {
        await appUser.end();
      }
    });
  });

  // --- 5. Operator dual-block --------------------------------------------

  describe("[INV-TEN-3] operator dual-block: guard 403 AND no DB grant", () => {
    it("platform_operator on the financial read route → 403 at the guard", async () => {
      await http()
        .get("/v1/financial/summaries")
        .set("authorization", auth("platform_operator", tenantA))
        .expect(403);
    });

    it("service_role has NO grant to read period_summaries (DB-layer block)", async () => {
      const grant = await serviceRole.query<{ has: boolean }>(
        `SELECT has_table_privilege('service_role', 'period_summaries', 'SELECT') AS has`,
      );
      expect(grant.rows[0]?.has).toBe(false);
    });

    it("a firm_admin holding financial:read reaches the handler (200) — separation is operator-only", async () => {
      const res = await http()
        .get("/v1/financial/summaries")
        .set("authorization", auth("firm_admin", tenantA))
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // --- 7. Audit tamper ----------------------------------------------------

  it("[INV-AUDIT-2] mutating a committed audit row makes the chain verifier fail at that position", async () => {
    // Build a real 2-entry chain via the spine for a fresh tenant.
    const t =
      (
        await serviceRole.query<IdRow>(
          `INSERT INTO tenants (status) VALUES ('active') RETURNING id`,
        )
      ).rows[0]?.id ?? "";
    for (const [i, name] of ["First Co", "Second Co"].entries()) {
      await http()
        .post(`/v1/firms/${t}/clients`)
        .set("authorization", auth("firm_admin", t))
        .set(
          "idempotency-key",
          `7000000${String(i)}-0000-7000-8000-000000000007`,
        )
        .send({ name })
        .expect(201);
    }

    // Tamper position 1 out of band as the DB owner (models a privileged
    // attacker; app_user + service_role both lack UPDATE on audit_log).
    await owner.query(
      `UPDATE audit_log SET action = 'client.HACKED' WHERE tenant_id = $1 AND position = 1`,
      [t],
    );

    const verify = verifyChainFor(t);
    await expect(verify).rejects.toBeInstanceOf(AuditChainTamperError);
    await expect(verify).rejects.toMatchObject({
      position: 1,
      reason: "entry-hash-mismatch",
    });
  });
});
