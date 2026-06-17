/**
 * Deterministic per-tenant audit hash chain (STANDARDS §18.3; INV-AUDIT-1/2).
 *
 * Each audit entry carries an `entryHash = sha256(canonical(hashed fields))`
 * where the hashed fields include the entry's `position` (per-tenant monotonic
 * sequence) and the predecessor's `prevHash`. That binding is what makes the
 * log tamper-evident:
 *   - mutate any hashed field  → recomputed entryHash ≠ stored entryHash;
 *   - delete a middle entry    → its successor's stored prevHash no longer
 *                                equals the predecessor's entryHash (link broken),
 *                                and the position sequence gains a gap;
 *   - reorder / insert an entry → prevHash linkage and the position sequence
 *                                both break.
 *
 * The hash is reproducible from inputs (INV-FIN-8 spirit) because we canonicalize
 * with stable key ordering before hashing. No DB dependency here — pure functions.
 */
import { createHash } from "node:crypto";

import type { UserRole } from "@probooks/shared";

/**
 * The first entry in a tenant's chain links to this fixed, non-zero genesis.
 * A constant (not "" or all-zeros) so a forged "first" entry cannot trivially
 * fabricate a believable prevHash; it is itself the sha256 of a domain label.
 */
export const GENESIS_PREV_HASH: string = createHash("sha256")
  .update("probooks.audit.genesis.v1")
  .digest("hex");

/** The fields bound into an entry's hash. Order here is irrelevant — we canonicalize. */
export interface HashableEntry {
  /** Per-tenant monotonic sequence position (1-based). */
  readonly position: number;
  /** The predecessor entry's entryHash, or GENESIS_PREV_HASH for the first. */
  readonly prevHash: string;
  readonly tenantId: string;
  /** Acting principal id; null for system actions. */
  readonly actorUserId: string | null;
  /** Acting principal role; null for system actions. */
  readonly actorRole: UserRole | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  /** before → after snapshots; null where not applicable (create/delete). */
  readonly beforeState: unknown;
  readonly afterState: unknown;
  /** When the transition occurred (ISO 8601 UTC). */
  readonly occurredAt: string;
}

/**
 * Deterministic JSON: object keys sorted recursively so logically-equal values
 * always serialize identically. Arrays keep order (it is semantic); null is
 * preserved and distinct from absent. Undefined is not expected in hashed input.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sortDeep(item));
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortDeep(record[key]);
  }
  return sorted;
}

/**
 * Compute the sha256 hex digest binding all hashed fields of an entry. The
 * field set is fixed and explicit so the canonical form does not drift if the
 * HashableEntry shape gains unrelated properties later.
 */
export function computeEntryHash(entry: HashableEntry): string {
  const canonical = canonicalize({
    position: entry.position,
    prevHash: entry.prevHash,
    tenantId: entry.tenantId,
    actorUserId: entry.actorUserId,
    actorRole: entry.actorRole,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    beforeState: entry.beforeState ?? null,
    afterState: entry.afterState ?? null,
    occurredAt: entry.occurredAt,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
