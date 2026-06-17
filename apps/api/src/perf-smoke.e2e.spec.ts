/**
 * Performance SMOKE suite — Phase 0 / Wave 8, test obligation #8
 * (STANDARDS §19.3 #8, §22 performance budgets).
 *
 * WHAT THIS IS: an in-process regression tripwire over the REAL Phase-0
 * components. It exercises HmacTokenService (issue+verify), AuditService over a
 * real Postgres 16 (Testcontainers, app_user role so RLS + the append-only
 * grants bind — STANDARDS §19.2, never SQLite), and an RLS-enforced vs
 * RLS-bypass SELECT, then asserts GENEROUS, headroom-padded ceilings.
 *
 * WHAT THIS IS NOT: a production SLO proof. There is no deployed server in
 * Phase 0, so real load testing (k6) against live infra — plus Multi-AZ
 * failover RTO<60s — is DEFERRED to account provisioning (J.2). These ceilings
 * are deliberately far above the prod SLO so the gate is non-flaky on noisy
 * CI/Testcontainers hardware; they only catch GROSS regressions. The true prod
 * SLO each maps to is in the it() name + an inline comment.
 *
 * Anti-flake discipline (per the plan): warm up before measuring, discard the
 * first (cold) iteration, report p50/p95 (never max), and pad ceilings. Measured
 * numbers are surfaced through the reporter's failure diff (full object on a
 * breach), never console (STANDARDS §13).
 */
import { join } from "node:path";

import type { Permission, TenantId, UserId } from "@probooks/shared";
import {
  startPostgresHarness,
  type PostgresHarness,
} from "@probooks/test-utils";
import { Client as PgClient } from "pg";

import { HmacTokenService } from "./core/auth/hmac-token.service";
import type { AccessSubject } from "./core/auth/token-contract";
import { AppConfigService } from "./core/config-env/app-config.service";
import { PrismaService } from "./core/prisma/prisma.service";
import type { TenantContext } from "./core/tenant-context/tenant-context";
import { TenantContextService } from "./core/tenant-context/tenant-context.service";
import { AuditRepository } from "./modules/audit/audit.repository";
import { AuditService } from "./modules/audit/audit.service";

// Container pull + migrate can be slow on a cold cache; the loops are small.
jest.setTimeout(180_000);

const TEST_SECRET = "perf-smoke-secret-at-least-32-characters!!";

// Padded, CI-safe smoke ceilings. Each comment names the prod SLO it guards.
const AUTH_P95_CEILING_MS = 50; // prod SLO: auth p95 < 200ms (§22). In-process HMAC is sub-ms.
const AUDIT_P95_CEILING_MS = 150; // prod target: audit write < 5ms on warm RDS. Cold Testcontainers is slower; NOT the prod substrate.
const RLS_P95_CEILING_MS = 50; // absolute backstop on the RLS read path (tiny dataset, in-process driver).
const RLS_MAX_MULTIPLE = 3; // prod target: RLS overhead < 10%. On micro datasets the ratio is noisy, so assert <3x + the absolute ceiling.

const AUTH_ITERS = 200;
const DB_ITERS = 50;

interface Percentiles {
  readonly p50: number;
  readonly p95: number;
}

/** Sort ascending and pick nearest-rank p50/p95. Caller discards the cold run. */
function percentiles(samplesMs: readonly number[]): Percentiles {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const at = (q: number): number => {
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(q * sorted.length) - 1),
    );
    return sorted[idx] ?? Number.POSITIVE_INFINITY;
  };
  return { p50: at(0.5), p95: at(0.95) };
}

/** Time one synchronous op in milliseconds (sub-ms resolution via hrtime). */
function timeSync(op: () => void): number {
  const start = process.hrtime.bigint();
  op();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

/** Time one async op in milliseconds. */
async function timeAsync(op: () => Promise<void>): Promise<number> {
  const start = process.hrtime.bigint();
  await op();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * A measured smoke result. Asserted (see expectWithinBudget) by comparing the
 * whole object against a copy with `withinBudget: true`, so Jest prints the FULL
 * object — measured p50/p95 + ceiling — in the reporter diff on a breach. No
 * console (STANDARDS §13); plain Jest 29 has no second `expect` message arg.
 */
interface BudgetReport {
  readonly label: string;
  readonly p50ms: number;
  readonly p95ms: number;
  readonly ceilingMs: number;
  readonly prodSlo: string;
  readonly withinBudget: boolean;
}

function budgetReport(
  label: string,
  p: Percentiles,
  ceilingMs: number,
  prodSlo: string,
): BudgetReport {
  return {
    label,
    p50ms: round3(p.p50),
    p95ms: round3(p.p95),
    ceilingMs,
    prodSlo,
    withinBudget: p.p95 < ceilingMs,
  };
}

/**
 * Assert a smoke report passed its budget. Compares the measured report against
 * an expected copy with `withinBudget: true` — so a budget breach renders the
 * FULL measured object (p50/p95/ceiling) in the reporter diff. No `expect.any`
 * (keeps the strict no-unsafe-assignment lint happy) and no console (§13).
 */
function expectWithinBudget(report: BudgetReport): void {
  expect(report).toEqual<BudgetReport>({ ...report, withinBudget: true });
}

function firmContext(tenantId: string): TenantContext {
  return {
    tenantId: tenantId as TenantId,
    userId: "00000000-0000-7000-8000-0000000000aa" as UserId,
    userRole: "firm_admin",
    permissions: new Set<Permission>(),
  };
}

interface IdRow {
  id: string;
}

describe("Performance smoke — Phase-0 components within padded budgets [§19.3 #8][§22]", () => {
  let harness: PostgresHarness;
  let prisma: PrismaService;
  let context: TenantContextService;
  let auditService: AuditService;
  let serviceRole: PgClient; // BYPASSRLS — seeds fixtures + the bypass read path
  let appUser: PgClient; // RLS-enforced — the realistic read path
  let tenantId = "";

  beforeAll(async () => {
    harness = await startPostgresHarness(join(__dirname, "..", "prisma"));

    serviceRole = new PgClient({ connectionString: harness.serviceRoleUrl });
    await serviceRole.connect();
    appUser = new PgClient({ connectionString: harness.appUserUrl });
    await appUser.connect();

    const t = await serviceRole.query<IdRow>(
      `INSERT INTO tenants (status) VALUES ('active') RETURNING id`,
    );
    tenantId = t.rows[0]?.id ?? "";
    // A handful of client rows so the RLS-filtered SELECT has rows to filter.
    for (let i = 0; i < 5; i += 1) {
      await serviceRole.query(
        `INSERT INTO clients (tenant_id, name) VALUES ($1, $2)`,
        [tenantId, `Perf Client ${String(i)}`],
      );
    }

    const config = new AppConfigService({
      nodeEnv: "test",
      port: 3000,
      logLevel: "info",
      databaseUrl: harness.appUserUrl,
      databaseServiceRoleUrl: harness.serviceRoleUrl,
      jwtSecret: TEST_SECRET,
      jwtAccessTtlSeconds: 900,
      jwtRefreshTtlSeconds: 28_800,
    });
    context = new TenantContextService();
    prisma = new PrismaService(config, context);
    await prisma.onModuleInit();
    const repo = new AuditRepository(prisma, context);
    auditService = new AuditService(repo, context, () => new Date());
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await appUser?.end();
    await serviceRole?.end();
    await harness?.stop();
  });

  it("auth issue+verify p95 within smoke budget [§22 SLO auth p95<200ms]", () => {
    const service = new HmacTokenService(
      new AppConfigService({
        nodeEnv: "test",
        port: 3000,
        logLevel: "info",
        databaseUrl: undefined,
        databaseServiceRoleUrl: undefined,
        jwtSecret: TEST_SECRET,
        jwtAccessTtlSeconds: 900,
        jwtRefreshTtlSeconds: 28_800,
      }),
    );
    const subject: AccessSubject = {
      tenantId: "11111111-1111-7111-8111-111111111111",
      userId: "22222222-2222-7222-8222-222222222222",
      role: "firm_admin",
    };
    const roundTrip = (): void => {
      const token = service.signAccessToken(subject);
      service.verifyAccessToken(token);
    };

    // Warm up (JIT + crypto init), then measure; discard nothing extra since the
    // warm-up loop already absorbs the cold path.
    for (let i = 0; i < 50; i += 1) roundTrip();

    const samples: number[] = [];
    for (let i = 0; i < AUTH_ITERS; i += 1) samples.push(timeSync(roundTrip));
    const p = percentiles(samples);

    expectWithinBudget(
      budgetReport(
        "auth issue+verify",
        p,
        AUTH_P95_CEILING_MS,
        "auth p95<200ms",
      ),
    );
  });

  it("audit write p95 within smoke budget [INV-AUDIT-1; SLO audit write <5ms warm RDS]", async () => {
    let n = 0;
    const writeOne = (): Promise<void> =>
      context.runWithContext(firmContext(tenantId), async () => {
        n += 1;
        await auditService.record({
          action: `perf.audit.${String(n)}`,
          entityType: "perf",
          entityId: null,
          beforeState: null,
          afterState: { n },
        });
      });

    // Warm up the connection pool + advisory-lock path; discard these.
    for (let i = 0; i < 5; i += 1) await writeOne();

    const samples: number[] = [];
    for (let i = 0; i < DB_ITERS; i += 1)
      samples.push(await timeAsync(writeOne));
    const p = percentiles(samples);

    expectWithinBudget(
      budgetReport(
        "audit write",
        p,
        AUDIT_P95_CEILING_MS,
        "audit write <5ms warm RDS (cold Testcontainers here, not prod substrate)",
      ),
    );
  });

  it("RLS read overhead within smoke budget [INV-TEN-1; prod target <10% overhead]", async () => {
    // RLS-enforced path: SET LOCAL app.tenant_id then SELECT as app_user.
    const rlsRead = async (): Promise<void> => {
      await appUser.query("BEGIN");
      await appUser.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
      await appUser.query(`SELECT id, tenant_id FROM clients`);
      await appUser.query("COMMIT");
    };
    // Bypass path: same query shape as service_role (BYPASSRLS), filtered in SQL
    // to read the SAME logical rows (apples-to-apples on row count).
    const bypassRead = async (): Promise<void> => {
      await serviceRole.query("BEGIN");
      await serviceRole.query(
        `SELECT id, tenant_id FROM clients WHERE tenant_id = $1`,
        [tenantId],
      );
      await serviceRole.query("COMMIT");
    };

    // Warm both paths; discard.
    for (let i = 0; i < 5; i += 1) {
      await rlsRead();
      await bypassRead();
    }

    const rlsSamples: number[] = [];
    const bypassSamples: number[] = [];
    for (let i = 0; i < DB_ITERS; i += 1) {
      rlsSamples.push(await timeAsync(rlsRead));
      bypassSamples.push(await timeAsync(bypassRead));
    }
    const rls = percentiles(rlsSamples);
    const bypass = percentiles(bypassSamples);

    // Absolute backstop: the RLS read path itself must stay snappy. This is the
    // load-bearing, non-flaky assertion (a single SELECT over a few rows). The
    // report object surfaces both paths' p50/p95 in the failure diff.
    const multiple = bypass.p95 >= 1 ? round3(rls.p95 / bypass.p95) : null;

    // Absolute backstop (load-bearing, non-flaky): the RLS read path must stay
    // snappy. Ratio is enforced only when the bypass baseline is a meaningful
    // denominator (>=1ms); on sub-ms baselines it is OMITTED as scheduler/driver
    // jitter (multiple === null) — the absolute ceiling still guards the path.
    // (prod target: RLS overhead <10%.) Comparing against a copy with the booleans
    // forced true surfaces the full measured object on any breach (no console §13).
    const rlsReport = {
      label: "rls read overhead",
      rlsP50ms: round3(rls.p50),
      rlsP95ms: round3(rls.p95),
      bypassP50ms: round3(bypass.p50),
      bypassP95ms: round3(bypass.p95),
      rlsCeilingMs: RLS_P95_CEILING_MS,
      multipleVsBypass: multiple,
      maxMultiple: RLS_MAX_MULTIPLE,
      prodTarget: "RLS overhead <10%",
      rlsWithinAbsoluteCeiling: rls.p95 < RLS_P95_CEILING_MS,
      withinMultiple: multiple === null || multiple < RLS_MAX_MULTIPLE,
    };
    expect(rlsReport).toEqual({
      ...rlsReport,
      rlsWithinAbsoluteCeiling: true,
      withinMultiple: true,
    });
  });
});
