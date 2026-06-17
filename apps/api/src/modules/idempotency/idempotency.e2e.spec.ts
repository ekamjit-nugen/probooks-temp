/**
 * Idempotency integration suite (STANDARDS §7.4, §19.2/§19.3; SPEC §5; INV-TEN-1).
 *
 * Boots a REAL Postgres 16 (Testcontainers — never SQLite), applies the
 * committed migrations, and exercises the idempotency domain the way production
 * runs it: through PrismaService.runInTenantTx (SET LOCAL app.tenant_id)
 * connected as the NON-superuser app_user role, so RLS binds.
 *
 * Two layers, one harness:
 *   A. Service ↔ repository over RLS — claim / replay / conflict / in-progress /
 *      expiry re-claim / release, plus cross-tenant isolation (INV-TEN-1).
 *   B. Full HTTP stack via supertest — a real Nest app with the
 *      TenantContextInterceptor (seeds ALS) + IdempotencyInterceptor on an
 *      @Idempotent POST route: first call executes + persists; a retry replays
 *      WITHOUT re-running the handler; different body → 409; missing header →
 *      pass-through; two concurrent same-key calls run the handler at most once;
 *      same key in two tenants stays isolated.
 */
import { join } from "node:path";

import {
  Body,
  Controller,
  Injectable,
  Post,
  UseInterceptors,
  type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Permission, TenantId, UserId } from "@probooks/shared";
import {
  startPostgresHarness,
  type PostgresHarness,
} from "@probooks/test-utils";
import { Client as PgClient } from "pg";
import request from "supertest";
import type { App } from "supertest/types";

import { AppConfigService } from "../../core/config-env/app-config.service";
import { ErrorsModule } from "../../core/errors/errors.module";
import { PrismaService } from "../../core/prisma/prisma.service";
import type { TenantContext } from "../../core/tenant-context/tenant-context";
import { TenantContextInterceptor } from "../../core/tenant-context/tenant-context.interceptor";
import { TenantContextService } from "../../core/tenant-context/tenant-context.service";

import { IDEMPOTENCY_CLOCK, systemIdempotencyClock } from "./idempotency.clock";
import { Idempotent } from "./idempotency.decorator";
import {
  IdempotencyKeyConflictError,
  IdempotencyRequestInProgressError,
} from "./idempotency.errors";
import { computeRequestFingerprint } from "./idempotency.fingerprint";
import { IdempotencyInterceptor } from "./idempotency.interceptor";
import { IdempotencyRepository } from "./idempotency.repository";
import { IdempotencyService } from "./idempotency.service";

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

/** Records how many times the guarded handler actually executed. */
@Injectable()
class CallRecorder {
  count = 0;
  reset(): void {
    this.count = 0;
  }
}

/**
 * Test-only Express middleware: seed req.principalClaim from an x-test-tenant
 * header, exactly as REAL auth (Wave 3) attaches it after verifying a session.
 * Lets each request pick its tenant so cross-tenant isolation is drivable.
 */
interface RequestWithPrincipal {
  headers: Record<string, string | string[] | undefined>;
  principalClaim?: TenantContext;
}

function seedPrincipal(
  req: RequestWithPrincipal,
  _res: unknown,
  next: () => void,
): void {
  const raw = req.headers["x-test-tenant"];
  const tenantId = Array.isArray(raw) ? raw[0] : raw;
  if (typeof tenantId === "string" && tenantId.length > 0) {
    req.principalClaim = firmContext(tenantId);
  }
  next();
}

@Controller("v1/things")
class ThingsController {
  constructor(private readonly recorder: CallRecorder) {}

  /** A state-creating POST opted into idempotency. */
  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  @Idempotent()
  create(@Body() body: { name?: string }): { id: string; name: string } {
    this.recorder.count += 1;
    return {
      id: `thing-${String(this.recorder.count)}`,
      name: body.name ?? "",
    };
  }
}

describe("Idempotency over RLS as app_user [STD-7.4][INV-TEN-1]", () => {
  let harness: PostgresHarness;
  let prisma: PrismaService;
  let context: TenantContextService;
  let repo: IdempotencyRepository;
  let service: IdempotencyService;
  let serviceRole: PgClient;
  let tenantA = "";
  let tenantB = "";

  const FUTURE = (): Date => new Date(Date.now() + 60_000);
  const PAST = (): Date => new Date(Date.now() - 60_000);

  beforeAll(async () => {
    harness = await startPostgresHarness(
      join(__dirname, "..", "..", "..", "prisma"),
    );
    serviceRole = new PgClient({ connectionString: harness.serviceRoleUrl });
    await serviceRole.connect();
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
    repo = new IdempotencyRepository(prisma, context);
    service = new IdempotencyService(repo, systemIdempotencyClock);
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await serviceRole?.end();
    await harness?.stop();
  });

  const fp = (body: unknown): string =>
    computeRequestFingerprint({ method: "POST", path: "/v1/things", body });

  // --- Layer A: service ↔ repository over RLS -----------------------------

  describe("service ↔ repository over RLS", () => {
    it("[§7.4] claims a fresh key", async () => {
      const key = "a0000000-0000-7000-8000-000000000001";
      await context.runWithContext(firmContext(tenantA), async () => {
        const outcome = await service.begin({ key, fingerprint: fp({ n: 1 }) });
        expect(outcome).toEqual({ outcome: "claimed" });
      });
    });

    it("[§7.4] replays the stored response for the same key + same body", async () => {
      const key = "a0000000-0000-7000-8000-000000000002";
      await context.runWithContext(firmContext(tenantA), async () => {
        await service.begin({ key, fingerprint: fp({ n: 2 }) });
        await service.complete({
          key,
          fingerprint: fp({ n: 2 }),
          response: { status: 201, body: { id: "x", n: 2 } },
        });
        const again = await service.begin({ key, fingerprint: fp({ n: 2 }) });
        expect(again).toEqual({
          outcome: "replay",
          response: { status: 201, body: { id: "x", n: 2 } },
        });
      });
    });

    it("[§7.4] 409 conflict when the same key carries a different body", async () => {
      const key = "a0000000-0000-7000-8000-000000000003";
      await context.runWithContext(firmContext(tenantA), async () => {
        await service.begin({ key, fingerprint: fp({ n: 3 }) });
        await service.complete({
          key,
          fingerprint: fp({ n: 3 }),
          response: { status: 201, body: { id: "y" } },
        });
        await expect(
          service.begin({ key, fingerprint: fp({ n: "DIFFERENT" }) }),
        ).rejects.toBeInstanceOf(IdempotencyKeyConflictError);
      });
    });

    it("409 in-progress when the same key + body is still in flight", async () => {
      const key = "a0000000-0000-7000-8000-000000000004";
      await context.runWithContext(firmContext(tenantA), async () => {
        await service.begin({ key, fingerprint: fp({ n: 4 }) });
        await expect(
          service.begin({ key, fingerprint: fp({ n: 4 }) }),
        ).rejects.toBeInstanceOf(IdempotencyRequestInProgressError);
      });
    });

    it("treats an expired row as absent and re-claims it", async () => {
      const key = "a0000000-0000-7000-8000-000000000005";
      await context.runWithContext(firmContext(tenantA), async () => {
        // Claim with an already-past expiry, then claim again: the live-row
        // guard (expires_at < now) lets the second claim win.
        const first = await repo.claim(key, fp({ n: 5 }), PAST());
        expect(first).toEqual({ kind: "claimed" });
        const second = await repo.claim(key, fp({ n: 5 }), FUTURE());
        expect(second).toEqual({ kind: "claimed" });
      });
    });

    it("release() lets a later retry re-claim (failures are not cached)", async () => {
      const key = "a0000000-0000-7000-8000-000000000006";
      await context.runWithContext(firmContext(tenantA), async () => {
        const claimed = await repo.claim(key, fp({ n: 6 }), FUTURE());
        expect(claimed).toEqual({ kind: "claimed" });
        await service.release(key, fp({ n: 6 }));
        const again = await repo.claim(key, fp({ n: 6 }), FUTURE());
        expect(again).toEqual({ kind: "claimed" });
      });
    });

    it("[INV-TEN-1] the same key string is isolated per tenant", async () => {
      const key = "a0000000-0000-7000-8000-00000000000a";
      await context.runWithContext(firmContext(tenantA), async () => {
        await service.begin({ key, fingerprint: fp({ owner: "A" }) });
        await service.complete({
          key,
          fingerprint: fp({ owner: "A" }),
          response: { status: 201, body: { tenant: "A" } },
        });
      });
      // Tenant B uses the SAME key string with a DIFFERENT body — under RLS,
      // A's row is invisible, so B simply claims (no conflict, no replay).
      await context.runWithContext(firmContext(tenantB), async () => {
        const outcome = await service.begin({
          key,
          fingerprint: fp({ owner: "B" }),
        });
        expect(outcome).toEqual({ outcome: "claimed" });
      });
      // And A's row is untouched + still scoped to A.
      const rows = await serviceRole.query(
        `SELECT tenant_id, response_body FROM idempotency_keys WHERE key = $1 ORDER BY tenant_id`,
        [key],
      );
      expect(rows.rows).toHaveLength(2);
    });
  });

  // --- Layer B: full HTTP stack via supertest -----------------------------

  describe("HTTP interceptor stack", () => {
    let app: INestApplication;
    let recorder: CallRecorder;

    beforeAll(async () => {
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

      const moduleRef = await Test.createTestingModule({
        imports: [ErrorsModule],
        controllers: [ThingsController],
        providers: [
          { provide: AppConfigService, useValue: config },
          TenantContextService,
          PrismaService,
          TenantContextInterceptor,
          IdempotencyRepository,
          IdempotencyService,
          IdempotencyInterceptor,
          CallRecorder,
          { provide: IDEMPOTENCY_CLOCK, useValue: systemIdempotencyClock },
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      app.use(seedPrincipal);
      app.useGlobalInterceptors(app.get(TenantContextInterceptor));
      await app.init();
      recorder = app.get(CallRecorder);
    });

    afterAll(async () => {
      await app?.close();
    });

    beforeEach(() => {
      recorder.reset();
    });

    function http(): ReturnType<typeof request> {
      return request(app.getHttpServer() as App);
    }

    it("a POST without an Idempotency-Key passes straight through (nothing persisted)", async () => {
      const c = await serviceRole.query<IdRow>(
        `INSERT INTO tenants (status) VALUES ('active') RETURNING id`,
      );
      const tenant = c.rows[0]?.id ?? "";
      const res = await http()
        .post("/v1/things")
        .set("x-test-tenant", tenant)
        .send({ name: "no-key" })
        .expect(201);
      expect((res.body as { name: string }).name).toBe("no-key");
      expect(recorder.count).toBe(1);

      const rows = await serviceRole.query(
        `SELECT count(*)::int AS n FROM idempotency_keys WHERE tenant_id = $1`,
        [tenant],
      );
      expect((rows.rows[0] as { n: number }).n).toBe(0);
    });

    it("rejects a malformed (non-UUID) Idempotency-Key with 400", async () => {
      await http()
        .post("/v1/things")
        .set("x-test-tenant", tenantA)
        .set("idempotency-key", "not-a-uuid")
        .send({ name: "bad" })
        .expect(400);
      expect(recorder.count).toBe(0);
    });

    it("[§7.4] first call runs the handler once and persists the response", async () => {
      const key = "b0000000-0000-7000-8000-000000000001";
      const res = await http()
        .post("/v1/things")
        .set("x-test-tenant", tenantA)
        .set("idempotency-key", key)
        .send({ name: "alpha" })
        .expect(201);
      expect((res.body as { name: string }).name).toBe("alpha");
      expect(recorder.count).toBe(1);

      const rows = await serviceRole.query(
        `SELECT state, response_status FROM idempotency_keys WHERE tenant_id = $1 AND key = $2`,
        [tenantA, key],
      );
      expect(rows.rows).toHaveLength(1);
      expect((rows.rows[0] as { state: string }).state).toBe("completed");
      expect(
        (rows.rows[0] as { response_status: number }).response_status,
      ).toBe(201);
    });

    it("[§7.4] a retry with the same key + body replays WITHOUT re-running the handler", async () => {
      const key = "b0000000-0000-7000-8000-000000000002";
      const first = await http()
        .post("/v1/things")
        .set("x-test-tenant", tenantA)
        .set("idempotency-key", key)
        .send({ name: "beta" })
        .expect(201);
      expect(recorder.count).toBe(1);

      const second = await http()
        .post("/v1/things")
        .set("x-test-tenant", tenantA)
        .set("idempotency-key", key)
        .send({ name: "beta" })
        .expect(201);

      // Handler ran ONCE; the replayed body is byte-identical to the first.
      expect(recorder.count).toBe(1);
      expect(second.body).toEqual(first.body);
    });

    it("[§7.4] same key + DIFFERENT body → 409 conflict", async () => {
      const key = "b0000000-0000-7000-8000-000000000003";
      await http()
        .post("/v1/things")
        .set("x-test-tenant", tenantA)
        .set("idempotency-key", key)
        .send({ name: "gamma" })
        .expect(201);
      recorder.reset();

      const conflict = await http()
        .post("/v1/things")
        .set("x-test-tenant", tenantA)
        .set("idempotency-key", key)
        .send({ name: "DIFFERENT" })
        .expect(409);
      expect((conflict.body as { error: { code: string } }).error.code).toBe(
        "IDEMPOTENCY_KEY_CONFLICT",
      );
      expect(recorder.count).toBe(0);
    });

    it("two concurrent same-key requests run the handler AT MOST once", async () => {
      const key = "b0000000-0000-7000-8000-000000000004";
      const fire = () =>
        http()
          .post("/v1/things")
          .set("x-test-tenant", tenantA)
          .set("idempotency-key", key)
          .send({ name: "race" });

      const [r1, r2] = await Promise.all([fire(), fire()]);

      // The atomic claim (Layer 3) guarantees the handler executes once.
      expect(recorder.count).toBe(1);
      // One request executed (201); the other either replayed (201) or was told
      // the first is still in-flight (409). Never a 5xx, never a second run.
      for (const r of [r1, r2]) {
        expect([201, 409]).toContain(r.status);
      }
      expect(r1.status === 201 || r2.status === 201).toBe(true);
    });

    it("[INV-TEN-1] the same key in two tenants is isolated (both execute)", async () => {
      const key = "b0000000-0000-7000-8000-00000000000f";
      const resA = await http()
        .post("/v1/things")
        .set("x-test-tenant", tenantA)
        .set("idempotency-key", key)
        .send({ name: "tenantA" })
        .expect(201);
      const resB = await http()
        .post("/v1/things")
        .set("x-test-tenant", tenantB)
        .set("idempotency-key", key)
        .send({ name: "tenantB" })
        .expect(201);

      expect((resA.body as { name: string }).name).toBe("tenantA");
      expect((resB.body as { name: string }).name).toBe("tenantB");
      expect(recorder.count).toBe(2); // both handlers ran — keys did not collide
    });
  });
});
