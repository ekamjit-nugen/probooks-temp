/**
 * Integration: refresh rotation + replay detection over REAL Postgres + RLS
 * (STANDARDS §10.1, §9.3, §19.2; INV-AUTH-4, INV-TEN-1).
 *
 * Boots Postgres 16 (Testcontainers), seeds two tenants + a user each via
 * service_role, then drives RefreshRotationService through PrismaService
 * (app_user, RLS-enforced) inside a seeded TenantContext — exactly as a request
 * would. Proves: rotation revokes the prior jti and persists the successor;
 * replay of a rotated token is rejected (401) AND the lineage is revoked; and
 * rotation is tenant-isolated (a jti from tenant B is invisible to tenant A).
 */
import { join } from "node:path";

import type { Permission, TenantId, UserId } from "@probooks/shared";
import {
  startPostgresHarness,
  type PostgresHarness,
} from "@probooks/test-utils";
import { Client as PgClient } from "pg";

import { AppConfigService } from "../config-env/app-config.service";
import { PrismaService } from "../prisma/prisma.service";
import type { TenantContext } from "../tenant-context/tenant-context";
import { TenantContextService } from "../tenant-context/tenant-context.service";

import { RefreshTokenReplayError } from "./auth.errors";
import { HmacTokenService } from "./hmac-token.service";
import { RefreshRotationService } from "./refresh-rotation.service";
import { RefreshTokenRepository } from "./refresh-token.repository";
import type { AccessSubject } from "./token-contract";

jest.setTimeout(180_000);

const SECRET = "integration-secret-at-least-32-chars-long!!";

interface IdRow {
  id: string;
}

function firmContext(tenantId: string, userId: string): TenantContext {
  return {
    tenantId: tenantId as TenantId,
    userId: userId as UserId,
    userRole: "firm_admin",
    permissions: new Set<Permission>(),
  };
}

describe("RefreshRotationService over RLS [STD-10.1][INV-AUTH-4][INV-TEN-1]", () => {
  let harness: PostgresHarness;
  let prisma: PrismaService;
  let tenantContext: TenantContextService;
  let tokens: HmacTokenService;
  let rotation: RefreshRotationService;
  let repo: RefreshTokenRepository;

  let tenantA = "";
  let tenantB = "";
  let userA = "";
  let userB = "";

  const clock = (): number => 1_700_000_000;

  beforeAll(async () => {
    harness = await startPostgresHarness(
      join(__dirname, "..", "..", "..", "prisma"),
    );

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
    const ua = await admin.query<IdRow>(
      `INSERT INTO users (tenant_id, role, idp_subject) VALUES ($1, 'firm_admin', 'idp-a') RETURNING id`,
      [tenantA],
    );
    const ub = await admin.query<IdRow>(
      `INSERT INTO users (tenant_id, role, idp_subject) VALUES ($1, 'firm_admin', 'idp-b') RETURNING id`,
      [tenantB],
    );
    userA = ua.rows[0]?.id ?? "";
    userB = ub.rows[0]?.id ?? "";
    await admin.end();

    const config = new AppConfigService({
      nodeEnv: "test",
      port: 3000,
      logLevel: "info",
      databaseUrl: harness.appUserUrl,
      databaseServiceRoleUrl: harness.serviceRoleUrl,
      jwtSecret: SECRET,
      jwtAccessTtlSeconds: 900,
      jwtRefreshTtlSeconds: 28_800,
    });
    tenantContext = new TenantContextService();
    prisma = new PrismaService(config, tenantContext);
    await prisma.onModuleInit();
    tokens = new HmacTokenService(config, clock);
    repo = new RefreshTokenRepository(prisma, tenantContext);
    rotation = new RefreshRotationService(tokens, tokens, repo, config, clock);
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await harness?.stop();
  });

  function subjectA(): AccessSubject {
    return { tenantId: tenantA, userId: userA, role: "firm_admin" };
  }

  /** Issue an initial (J1) refresh token AND persist it, as login would. */
  async function issueInitial(
    tenantId: string,
    userId: string,
    jti: string,
  ): Promise<{ token: string; jti: string }> {
    return tenantContext.runWithContext(
      firmContext(tenantId, userId),
      async () => {
        await repo.create({
          userId,
          jti,
          rotatedFromJti: null,
          expiresAt: new Date((clock() + 28_800) * 1000),
        });
        const token = tokens.signRefreshToken({ tenantId, userId, jti });
        return { token, jti };
      },
    );
  }

  it("rotates: issues new access + refresh, revokes the prior jti, links lineage", async () => {
    const { token: j1Token, jti: j1 } = await issueInitial(
      tenantA,
      userA,
      "00000000-0000-7000-8000-0000000000a1",
    );

    const result = await tenantContext.runWithContext(
      firmContext(tenantA, userA),
      () => rotation.rotate(j1Token, subjectA()),
    );

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.refreshJti).not.toBe(j1);

    const verified = tokens.verifyAccessToken(result.accessToken);
    expect(verified.tenantId).toBe(tenantA);
    expect(verified.userId).toBe(userA);

    await tenantContext.runWithContext(
      firmContext(tenantA, userA),
      async () => {
        const old = await repo.findByJti(j1);
        const next = await repo.findByJti(result.refreshJti);
        expect(old?.revokedAt).not.toBeNull();
        expect(next?.revokedAt).toBeNull();
        expect(next?.rotatedFromJti).toBe(j1);
      },
    );
  });

  it("[INV-AUTH-4] replaying a rotated refresh token is rejected and revokes the lineage", async () => {
    const user = "00000000-0000-7000-8000-0000000000b2";
    const { token: j1Token } = await issueInitial(
      tenantA,
      user,
      "00000000-0000-7000-8000-0000000000a2",
    );

    // First rotation succeeds (J1 → J2).
    const first = await tenantContext.runWithContext(
      firmContext(tenantA, user),
      () =>
        rotation.rotate(j1Token, {
          tenantId: tenantA,
          userId: user,
          role: "firm_admin",
        }),
    );

    // Replay J1 → rejected, and the active descendant J2 is also revoked.
    await tenantContext.runWithContext(firmContext(tenantA, user), async () => {
      await expect(
        rotation.rotate(j1Token, {
          tenantId: tenantA,
          userId: user,
          role: "firm_admin",
        }),
      ).rejects.toBeInstanceOf(RefreshTokenReplayError);

      const descendant = await repo.findByJti(first.refreshJti);
      expect(descendant?.revokedAt).not.toBeNull();
    });
  });

  it("[INV-TEN-1] a refresh jti from tenant B is invisible under tenant A (replay-treated)", async () => {
    // Seed J1 for tenant B's user under tenant B context.
    const bToken = await tenantContext.runWithContext(
      firmContext(tenantB, userB),
      async () => {
        const jti = "00000000-0000-7000-8000-0000000000c3";
        await repo.create({
          userId: userB,
          jti,
          rotatedFromJti: null,
          expiresAt: new Date((clock() + 28_800) * 1000),
        });
        return tokens.signRefreshToken({
          tenantId: tenantB,
          userId: userB,
          jti,
        });
      },
    );

    // Present tenant B's token while bound to tenant A → RLS hides the row →
    // treated as replay (unknown jti) → 401.
    await tenantContext.runWithContext(
      firmContext(tenantA, userA),
      async () => {
        await expect(
          rotation.rotate(bToken, {
            tenantId: tenantB,
            userId: userB,
            role: "firm_admin",
          }),
        ).rejects.toBeInstanceOf(RefreshTokenReplayError);
      },
    );
  });
});
