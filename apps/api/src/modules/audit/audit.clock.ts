/**
 * Audit clock seam (testability; STANDARDS §8.7 spirit). The audit service reads
 * "now" through this so occurredAt defaulting is deterministic in tests. Default
 * binding is the system clock; tests inject a fixed Date.
 */
export type AuditClock = () => Date;

/** Current wall-clock time as a Date (UTC at the I/O boundary — STANDARDS §8.7). */
export const systemAuditClock: AuditClock = () => new Date();

/** DI token for the injectable audit clock. */
export const AUDIT_CLOCK = Symbol("AUDIT_CLOCK");
