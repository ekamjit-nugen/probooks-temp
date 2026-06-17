/**
 * AuditService (STANDARDS §6, §18.3; INV-AUDIT-1/2/3). Records one state
 * transition as an append-only, hash-chained entry, and verifies a tenant's
 * chain.
 *
 * The "who" (actorUserId + actorRole) is read from TenantContext — never passed
 * by the caller — so an action cannot be misattributed (INV-AUDIT-1). The "when"
 * (occurredAt) defaults to the injected clock. The write is composable inside
 * the caller's transaction: pass the parent `tx` and the audit row commits or
 * rolls back atomically with the parent state change (INV-AUDIT-1).
 *
 * Services never touch Prisma directly — all DB access goes through
 * AuditRepository (STANDARDS §6).
 */
import { Inject, Injectable } from "@nestjs/common";

import {
  PrismaService,
  type TenantTxClient,
} from "../../core/prisma/prisma.service";
import { TenantContextService } from "../../core/tenant-context/tenant-context.service";

import { AUDIT_CLOCK, type AuditClock } from "./audit.clock";
import { AuditChainTamperError } from "./audit.errors";
import type { RecordAuditInput, RecordedAuditEntry } from "./audit.events";
import { AuditRepository } from "./audit.repository";
import { verifyChain } from "./hash-chain/hash-chain.verifier";

@Injectable()
export class AuditService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly tenantContext: TenantContextService,
    @Inject(AUDIT_CLOCK) private readonly clock: AuditClock,
  ) {}

  /**
   * Record one state transition. Supply the parent `tx` to make the audit write
   * atomic with the parent state change (INV-AUDIT-1); omit it to write the
   * entry in its own tenant-bound transaction.
   */
  async record(
    input: RecordAuditInput,
    tx?: TenantTxClient,
  ): Promise<RecordedAuditEntry> {
    const { userId, userRole } = this.tenantContext.require();
    const appended = await this.repository.append(
      {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        actorUserId: userId,
        actorRole: userRole,
        beforeState: input.beforeState,
        afterState: input.afterState,
        occurredAt: input.occurredAt ?? this.clock(),
      },
      tx,
    );
    return {
      id: appended.id,
      position: appended.position,
      prevHash: appended.prevHash,
      entryHash: appended.entryHash,
    };
  }

  /**
   * Walk the current tenant's chain and assert it is intact. Throws
   * AuditChainTamperError at the first broken position (INV-AUDIT-2); resolves
   * when the chain verifies.
   */
  async verify(): Promise<void> {
    const rows = await this.repository.listInOrder();
    const result = verifyChain(rows);
    if (!result.ok) {
      throw new AuditChainTamperError(result.position, result.reason);
    }
  }
}

/**
 * Re-exported for callers that want to run a parent state change + audit write
 * in one transaction without importing PrismaService directly. Thin helper:
 * opens a tenant-bound tx and hands it to `work` (which calls
 * `auditService.record(input, tx)` alongside its own repository writes).
 */
@Injectable()
export class AuditTransactionRunner {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(work: (tx: TenantTxClient) => Promise<T>): Promise<T> {
    return this.prisma.runInTenantTx(work);
  }
}
