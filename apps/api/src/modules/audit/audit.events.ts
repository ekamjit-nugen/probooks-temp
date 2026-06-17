/**
 * Audit domain types (STANDARDS §5.4). The shape a caller hands the audit
 * service to record one state transition: who/what/when/before→after. Not a
 * Nest event-bus payload — it is the recorded fact. `who` (actorUserId +
 * actorRole) is read from TenantContext by the service, never passed here, so
 * the caller cannot misattribute an action (INV-AUDIT-1).
 */

/**
 * One state transition to record. The service supplies who (from context) and
 * when (defaulting to now); the caller supplies what + before→after.
 */
export interface RecordAuditInput {
  /** Dotted action, past tense (STANDARDS §5.4), e.g. "period.processed". */
  readonly action: string;
  /** The affected entity kind, e.g. "period", "flag", "attestation". */
  readonly entityType: string;
  /** The affected entity id; null for tenant-wide actions. */
  readonly entityId: string | null;
  /** Snapshot before the transition; null for creates. */
  readonly beforeState: unknown;
  /** Snapshot after the transition; null for deletes (rare — §15). */
  readonly afterState: unknown;
  /**
   * When the transition occurred. Optional — defaults to the service clock.
   * Distinct from the row's created_at (when the audit row was written).
   */
  readonly occurredAt?: Date;
}

/** What the service returns after appending: the chained position + hashes. */
export interface RecordedAuditEntry {
  readonly id: string;
  readonly position: number;
  readonly prevHash: string;
  readonly entryHash: string;
}
