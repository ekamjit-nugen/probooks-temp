/**
 * RefreshTokenRepository (STANDARDS §9.3, §10.1). Tenant-scoped persistence for
 * refresh-token rotation lineage + replay detection. Reads tenantId from
 * TenantContext (never a parameter) and puts it in EVERY where clause
 * (INV-TEN-1); runs inside runInTenantTx so RLS also binds.
 *
 * The rotation service owns the policy (rotate/revoke/replay-detect); this
 * repository owns only persistence.
 */
import { Injectable } from "@nestjs/common";
import type { RefreshToken } from "@prisma/client";

import { PrismaService, type TenantTxClient } from "../prisma/prisma.service";
import { TenantContextService } from "../tenant-context/tenant-context.service";

/** Fields needed to persist a freshly issued refresh token. */
export interface NewRefreshTokenRecord {
  readonly userId: string;
  readonly jti: string;
  readonly rotatedFromJti: string | null;
  readonly expiresAt: Date;
}

@Injectable()
export class RefreshTokenRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** Persist a newly issued refresh token for the current tenant. */
  async create(record: NewRefreshTokenRecord): Promise<RefreshToken> {
    const { tenantId } = this.tenantContext.require();
    return this.prisma.runInTenantTx((tx: TenantTxClient) =>
      tx.refreshToken.create({
        data: {
          tenantId,
          userId: record.userId,
          jti: record.jti,
          rotatedFromJti: record.rotatedFromJti,
          expiresAt: record.expiresAt,
        },
      }),
    );
  }

  /** Find a token by jti within the current tenant (RLS-scoped). */
  async findByJti(jti: string): Promise<RefreshToken | null> {
    const { tenantId } = this.tenantContext.require();
    return this.prisma.runInTenantTx((tx: TenantTxClient) =>
      tx.refreshToken.findFirst({
        where: { tenantId, jti },
      }),
    );
  }

  /** Mark a single jti revoked (idempotent: only if not already revoked). */
  async revokeByJti(jti: string, at: Date): Promise<void> {
    const { tenantId } = this.tenantContext.require();
    await this.prisma.runInTenantTx((tx: TenantTxClient) =>
      tx.refreshToken.updateMany({
        where: { tenantId, jti, revokedAt: null },
        data: { revokedAt: at },
      }),
    );
  }

  /**
   * Revoke every still-active token for a user (lineage kill-switch on replay).
   * Tenant-scoped; only this user's rows.
   */
  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    const { tenantId } = this.tenantContext.require();
    await this.prisma.runInTenantTx((tx: TenantTxClient) =>
      tx.refreshToken.updateMany({
        where: { tenantId, userId, revokedAt: null },
        data: { revokedAt: at },
      }),
    );
  }
}
