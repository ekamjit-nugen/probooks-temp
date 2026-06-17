/**
 * Hash-chain verifier (STANDARDS §18.3; INV-AUDIT-1/2). Walks a tenant's audit
 * rows IN ORDER and proves the chain is intact, or returns the first tampered
 * entry. Pure — no DB; the repository supplies the ordered rows.
 *
 * Detection (all three required by Wave 4):
 *   - MUTATION   — a hashed field was changed without recomputing entryHash, so
 *                  the recomputed hash ≠ the stored entryHash → "entry-hash-mismatch".
 *   - DELETION   — a middle row is gone, so positions skip a value
 *                  ("position-gap") and/or the next row's prevHash no longer
 *                  equals the running hash ("prev-hash-mismatch").
 *   - REORDER /  — order no longer matches the prevHash linkage / position
 *     INSERTION    sequence → "prev-hash-mismatch" / "position-gap".
 */
import {
  GENESIS_PREV_HASH,
  computeEntryHash,
  type HashableEntry,
} from "./hash-chain";

/** A persisted audit row: the hashed fields plus the stored entryHash. */
export interface StoredAuditRow extends HashableEntry {
  /** The entryHash as persisted in the row (what we re-derive and compare). */
  readonly entryHash: string;
}

/** Why verification failed at a given position. */
export type ChainTamperReason =
  | "entry-hash-mismatch"
  | "prev-hash-mismatch"
  | "position-gap";

/** Result of walking a tenant's chain. */
export type ChainVerificationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** The position of the first row that fails verification. */
      readonly position: number;
      readonly reason: ChainTamperReason;
    };

/**
 * Verify an ordered list of one tenant's audit rows. `rows` MUST be supplied in
 * ascending `position` order (the repository sorts that way). Returns the first
 * break it finds, so callers can pinpoint the tampered entry.
 */
export function verifyChain(
  rows: readonly StoredAuditRow[],
): ChainVerificationResult {
  let expectedPrevHash = GENESIS_PREV_HASH;
  let expectedPosition = 1;

  for (const row of rows) {
    // Position must increase by exactly 1 from the chain's start. A gap means a
    // row was deleted or one was inserted/reordered.
    if (row.position !== expectedPosition) {
      return { ok: false, position: row.position, reason: "position-gap" };
    }

    // The row must link to the running hash (genesis for the first row). A
    // mismatch means a predecessor is missing or the order is wrong.
    if (row.prevHash !== expectedPrevHash) {
      return {
        ok: false,
        position: row.position,
        reason: "prev-hash-mismatch",
      };
    }

    // The stored hash must equal a fresh recomputation from the row's fields. A
    // mismatch means a hashed field was mutated after the hash was written.
    const recomputed = computeEntryHash(toHashable(row));
    if (recomputed !== row.entryHash) {
      return {
        ok: false,
        position: row.position,
        reason: "entry-hash-mismatch",
      };
    }

    expectedPrevHash = row.entryHash;
    expectedPosition += 1;
  }

  return { ok: true };
}

function toHashable(row: StoredAuditRow): HashableEntry {
  return {
    position: row.position,
    prevHash: row.prevHash,
    tenantId: row.tenantId,
    actorUserId: row.actorUserId,
    actorRole: row.actorRole,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    beforeState: row.beforeState,
    afterState: row.afterState,
    occurredAt: row.occurredAt,
  };
}
