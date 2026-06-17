/**
 * AuditRepository — tenant-scoped, INSERT-only access to audit_log (STANDARDS
 * §9.3, §18.3; INV-AUDIT-1/2/3). There is intentionally NO update or delete
 * method on this class, and the DB role (app_user) lacks UPDATE/DELETE on the
 * table (20260604120200) — append-only at both layers.
 *
 * The repository reads the tenant from TenantContext (never a parameter), runs
 * everything through the tenant-bound transaction (so RLS binds), and exposes:
 *   - `append`  — serialize per tenant, read the chain head, INSERT the next row;
 *   - `listInOrder` — the ordered rows the verifier walks.
 *
 * Concurrency: `append` MUST be called inside a transaction that already holds a
 * per-tenant advisory lock. We take `pg_advisory_xact_lock` keyed by the tenant
 * so two concurrent appends for the same tenant serialize — they cannot read the
 * same chain head and fork. The lock auto-releases at COMMIT/ROLLBACK. The
 * UNIQUE (tenant_id, position) constraint is the layer-3 correctness backstop
 * (STANDARDS §15.2) if anything ever raced past the lock.
 */
import { Injectable } from "@nestjs/common";

import {
  PrismaService,
  type TenantTxClient,
} from "../../core/prisma/prisma.service";
import { TenantContextService } from "../../core/tenant-context/tenant-context.service";

import {
  GENESIS_PREV_HASH,
  computeEntryHash,
  type HashableEntry,
} from "./hash-chain/hash-chain";
import type { StoredAuditRow } from "./hash-chain/hash-chain.verifier";

/** Fields the service computes per entry; the repository fills who/when/chain. */
export interface AppendAuditRow {
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly actorUserId: string | null;
  readonly actorRole: string | null;
  readonly beforeState: unknown;
  readonly afterState: unknown;
  readonly occurredAt: Date;
}

/** What `append` returns: identifiers + chain linkage of the persisted row. */
export interface AppendedAuditRow {
  readonly id: string;
  readonly position: number;
  readonly prevHash: string;
  readonly entryHash: string;
}

interface ChainHeadRow {
  position: bigint;
  entry_hash: string;
}

interface InsertedRow {
  id: string;
}

@Injectable()
export class AuditRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Append one entry to the current tenant's chain, atomically with the caller's
   * work. Pass the same `tx` the parent state change uses so the audit row
   * commits or rolls back WITH it (INV-AUDIT-1). If no `tx` is supplied, a new
   * tenant-bound transaction is opened for the append alone.
   */
  async append(
    row: AppendAuditRow,
    tx?: TenantTxClient,
  ): Promise<AppendedAuditRow> {
    if (tx !== undefined) {
      return this.appendWithin(tx, row);
    }
    return this.prisma.runInTenantTx((ownTx) => this.appendWithin(ownTx, row));
  }

  /** The tenant's chain in ascending position order — the verifier's input. */
  async listInOrder(): Promise<StoredAuditRow[]> {
    const { tenantId } = this.tenantContext.require();
    return this.prisma.runInTenantTx(async (tx) => {
      const rows = await tx.auditLog.findMany({
        where: { tenantId },
        orderBy: { position: "asc" },
      });
      return rows.map(
        (r): StoredAuditRow => ({
          position: Number(r.position),
          prevHash: r.prevHash,
          entryHash: r.entryHash,
          tenantId: r.tenantId,
          actorUserId: r.actorUserId,
          actorRole: r.actorRole as StoredAuditRow["actorRole"],
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          beforeState: r.beforeState,
          afterState: r.afterState,
          occurredAt: r.occurredAt.toISOString(),
        }),
      );
    });
  }

  private async appendWithin(
    tx: TenantTxClient,
    row: AppendAuditRow,
  ): Promise<AppendedAuditRow> {
    const { tenantId } = this.tenantContext.require();

    // (1) Serialize appends for this tenant. The advisory lock is keyed by the
    //     tenant UUID (hashed to a bigint) and is transaction-scoped, so two
    //     concurrent appenders queue here and cannot read the same chain head.
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
      tenantId,
    );

    // (2) Read the chain head (highest position) for this tenant.
    const head = await tx.$queryRawUnsafe<ChainHeadRow[]>(
      `SELECT position, entry_hash
         FROM audit_log
        WHERE tenant_id = $1::uuid
        ORDER BY position DESC
        LIMIT 1`,
      tenantId,
    );

    const headRow = head[0];
    const position = headRow ? Number(headRow.position) + 1 : 1;
    const prevHash = headRow ? headRow.entry_hash : GENESIS_PREV_HASH;

    // (3) Compute this entry's hash over its canonical fields.
    const hashable: HashableEntry = {
      position,
      prevHash,
      tenantId,
      actorUserId: row.actorUserId,
      actorRole: row.actorRole as HashableEntry["actorRole"],
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      beforeState: row.beforeState,
      afterState: row.afterState,
      occurredAt: row.occurredAt.toISOString(),
    };
    const entryHash = computeEntryHash(hashable);

    // (4) INSERT. Raw INSERT keeps JSON snapshots explicit and avoids any
    //     accidental update path. RLS WITH CHECK still binds tenant_id; the
    //     UNIQUE (tenant_id, position) constraint is the fork backstop.
    const inserted = await tx.$queryRawUnsafe<InsertedRow[]>(
      `INSERT INTO audit_log
         (tenant_id, position, prev_hash, entry_hash, actor_user_id, actor_role,
          action, entity_type, entity_id, before_state, after_state, occurred_at)
       VALUES ($1::uuid, $2::bigint, $3, $4, $5::uuid, $6, $7, $8, $9::uuid,
               $10::jsonb, $11::jsonb, $12::timestamptz)
       RETURNING id`,
      tenantId,
      position,
      prevHash,
      entryHash,
      row.actorUserId,
      row.actorRole,
      row.action,
      row.entityType,
      row.entityId,
      row.beforeState === null ? null : JSON.stringify(row.beforeState),
      row.afterState === null ? null : JSON.stringify(row.afterState),
      row.occurredAt,
    );

    const id = inserted[0]?.id ?? "";
    return { id, position, prevHash, entryHash };
  }
}
