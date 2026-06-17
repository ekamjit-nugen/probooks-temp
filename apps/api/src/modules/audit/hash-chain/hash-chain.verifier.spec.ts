/**
 * Hash-chain verifier unit tests (STANDARDS §19.2; INV-AUDIT-1/2). Pure: it
 * walks an ordered list of stored audit rows and reports the first tampered
 * entry. Proves detection of (a) a mutated field, (b) a deleted middle entry,
 * (c) a reordered / inserted entry — and an OK result on an intact chain.
 */
import {
  GENESIS_PREV_HASH,
  computeEntryHash,
  type HashableEntry,
} from "./hash-chain";
import { verifyChain, type StoredAuditRow } from "./hash-chain.verifier";

/** Build a well-formed, correctly-chained list of n rows for one tenant. */
function buildChain(n: number): StoredAuditRow[] {
  const tenantId = "00000000-0000-7000-8000-000000000001";
  const rows: StoredAuditRow[] = [];
  let prevHash = GENESIS_PREV_HASH;
  for (let i = 1; i <= n; i += 1) {
    const fields: HashableEntry = {
      position: i,
      prevHash,
      tenantId,
      actorUserId: "00000000-0000-7000-8000-0000000000aa",
      actorRole: "firm_admin",
      action: `action.${String(i)}`,
      entityType: "period",
      entityId: "00000000-0000-7000-8000-0000000000bb",
      beforeState: { n: i - 1 },
      afterState: { n: i },
      occurredAt: `2026-06-05T12:00:0${String(i)}.000Z`,
    };
    const entryHash = computeEntryHash(fields);
    rows.push({ ...fields, entryHash });
    prevHash = entryHash;
  }
  return rows;
}

describe("verifyChain [INV-AUDIT-1][INV-AUDIT-2]", () => {
  it("returns ok for an intact chain", () => {
    const result = verifyChain(buildChain(5));

    expect(result.ok).toBe(true);
  });

  it("returns ok for an empty chain", () => {
    expect(verifyChain([]).ok).toBe(true);
  });

  it("detects a mutated field and points at the tampered entry", () => {
    const rows = buildChain(5);
    // Mutate entry 3's action WITHOUT recomputing its stored entryHash —
    // models a row edited directly in the DB (bypassing the no-UPDATE grant).
    const tampered = rows.map((r) =>
      r.position === 3 ? { ...r, action: "action.HACKED" } : r,
    );

    const result = verifyChain(tampered);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.position).toBe(3);
      expect(result.reason).toBe("entry-hash-mismatch");
    }
  });

  it("detects a deleted middle entry", () => {
    const rows = buildChain(5);
    // Drop entry 3. Entry 4 now follows entry 2; 4.prevHash points at 3's hash,
    // which no longer precedes it. The break surfaces at the first row whose
    // prevHash does not match the running hash, AND the position gap (3 missing).
    const withGap = rows.filter((r) => r.position !== 3);

    const result = verifyChain(withGap);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.position).toBe(4);
      expect(["prev-hash-mismatch", "position-gap"]).toContain(result.reason);
    }
  });

  it("detects a reordered / inserted entry", () => {
    const rows = buildChain(5);
    // Swap entries 3 and 4 (reorder). The prevHash linkage no longer holds in
    // the new order, and positions are out of sequence.
    const reordered = [rows[0], rows[1], rows[3], rows[2], rows[4]].filter(
      (r): r is StoredAuditRow => r !== undefined,
    );

    const result = verifyChain(reordered);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["prev-hash-mismatch", "position-gap"]).toContain(result.reason);
    }
  });

  it("flags a forged first entry that does not link to genesis", () => {
    const rows = buildChain(3);
    const forged = rows.map((r) =>
      r.position === 1 ? { ...r, prevHash: "feedface" } : r,
    );

    const result = verifyChain(forged);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.position).toBe(1);
    }
  });
});
