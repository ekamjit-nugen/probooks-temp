/**
 * IdempotencyRepository — tenant-scoped access to idempotency_keys (STANDARDS
 * §7.4, §9.3). Reads the tenant from TenantContext (never a parameter) and runs
 * every statement through PrismaService.runInTenantTx, so RLS binds and a key is
 * only ever visible within its own firm (INV-TEN-1).
 *
 * `claim` is the Layer-3 correctness backstop (STANDARDS §15.2): a single atomic
 * `INSERT ... ON CONFLICT (tenant_id, key)` decides who owns the execution. An
 * expired row is re-claimed (treated as absent); a live row surfaces its state
 * so the service can replay / conflict / report-in-progress. Two concurrent
 * claims for the same key serialise on the unique index — exactly one wins.
 */
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../core/prisma/prisma.service";
import { TenantContextService } from "../../core/tenant-context/tenant-context.service";

import type { ClaimResult, StoredResponse } from "./idempotency.types";

interface ClaimRow {
  claimed: boolean;
}

interface ExistingRow {
  state: string;
  request_fingerprint: string;
  response_status: number | null;
  response_body: unknown;
}

@Injectable()
export class IdempotencyRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Atomically claim `key` for the current tenant. Inserts an `in_progress` row
   * iff none exists (or the existing one has expired). Returns:
   *  - { kind: 'claimed' }  — this caller owns the execution;
   *  - { kind: 'existing' } — a live row already exists; its state/fingerprint/
   *                           response are returned for the service to act on.
   */
  async claim(
    key: string,
    fingerprint: string,
    expiresAt: Date,
  ): Promise<ClaimResult> {
    const { tenantId } = this.tenant.require();

    return this.prisma.runInTenantTx(async (tx) => {
      // ON CONFLICT DO UPDATE only fires when the existing row is EXPIRED, so an
      // expired key is re-claimed. `xmax = 0` ⇒ a fresh INSERT; for the expiry
      // re-claim path the UPDATE still returns a row — either way a returned row
      // means we won the claim. No returned row ⇒ a live row blocks us.
      const claimed = await tx.$queryRawUnsafe<ClaimRow[]>(
        `INSERT INTO idempotency_keys
           (tenant_id, key, request_fingerprint, state, expires_at)
         VALUES ($1::uuid, $2, $3, 'in_progress', $4::timestamptz)
         ON CONFLICT (tenant_id, key) DO UPDATE
           SET request_fingerprint = EXCLUDED.request_fingerprint,
               state = 'in_progress',
               response_status = NULL,
               response_body = NULL,
               response_hash = NULL,
               created_at = now(),
               expires_at = EXCLUDED.expires_at
           WHERE idempotency_keys.expires_at < now()
         RETURNING (xmax = 0) AS claimed`,
        tenantId,
        key,
        fingerprint,
        expiresAt,
      );

      if (claimed.length > 0) {
        return { kind: "claimed" };
      }

      // A live (non-expired) row blocked the upsert — read it to decide replay /
      // conflict / in-progress. Tenant-scoped: RLS + explicit tenant_id.
      const rows = await tx.$queryRawUnsafe<ExistingRow[]>(
        `SELECT state, request_fingerprint, response_status, response_body
           FROM idempotency_keys
          WHERE tenant_id = $1::uuid AND key = $2`,
        tenantId,
        key,
      );
      const row = rows[0];
      if (row === undefined) {
        // Extremely narrow race: the blocking row expired+vanished between the
        // upsert and this select. Treat as absent and retry the claim once.
        return this.claim(key, fingerprint, expiresAt);
      }
      return {
        kind: "existing",
        state: row.state === "completed" ? "completed" : "in_progress",
        requestFingerprint: row.request_fingerprint,
        responseStatus: row.response_status,
        responseBody: row.response_body,
      };
    });
  }

  /**
   * Mark a claimed key completed and store its response for replay. Guarded to
   * the row this caller owns: only an `in_progress` row with the SAME
   * fingerprint is advanced (a no-op otherwise — defensive, never overwrites a
   * divergent claim).
   */
  async complete(
    key: string,
    fingerprint: string,
    response: StoredResponse,
    responseHash: string,
    expiresAt: Date,
  ): Promise<void> {
    const { tenantId } = this.tenant.require();
    await this.prisma.runInTenantTx(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE idempotency_keys
            SET state = 'completed',
                response_status = $3::int,
                response_body = $4::jsonb,
                response_hash = $5,
                expires_at = $6::timestamptz
          WHERE tenant_id = $1::uuid AND key = $2
            AND state = 'in_progress' AND request_fingerprint = $7`,
        tenantId,
        key,
        response.status,
        JSON.stringify(response.body ?? null),
        responseHash,
        expiresAt,
        fingerprint,
      );
    });
  }

  /**
   * Release a claimed-but-failed key so a later retry can re-claim it — we do
   * NOT cache failures (STANDARDS §7.4 caches the successful response only).
   * Deletes only the in_progress row this caller owns.
   */
  async release(key: string, fingerprint: string): Promise<void> {
    const { tenantId } = this.tenant.require();
    await this.prisma.runInTenantTx(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM idempotency_keys
          WHERE tenant_id = $1::uuid AND key = $2
            AND state = 'in_progress' AND request_fingerprint = $3`,
        tenantId,
        key,
        fingerprint,
      );
    });
  }
}
