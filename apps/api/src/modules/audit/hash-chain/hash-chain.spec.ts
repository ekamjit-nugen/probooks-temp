/**
 * Hash-chain unit tests (STANDARDS §19.1/§19.2; INV-AUDIT-1/2). Pure functions,
 * no DB. Proves reproducibility (INV-FIN-8 spirit), key-order independence,
 * genesis linkage, prev-hash dependency, and field-mutation sensitivity.
 */
import {
  GENESIS_PREV_HASH,
  canonicalize,
  computeEntryHash,
  type HashableEntry,
} from "./hash-chain";

function baseEntry(): HashableEntry {
  return {
    position: 1,
    prevHash: GENESIS_PREV_HASH,
    tenantId: "00000000-0000-7000-8000-000000000001",
    actorUserId: "00000000-0000-7000-8000-0000000000aa",
    actorRole: "firm_admin",
    action: "period.processed",
    entityType: "period",
    entityId: "00000000-0000-7000-8000-0000000000bb",
    beforeState: { state: "open" },
    afterState: { state: "processed" },
    occurredAt: "2026-06-05T12:00:00.000Z",
  };
}

describe("canonicalize", () => {
  it("produces identical output regardless of key insertion order", () => {
    const a = canonicalize({ b: 1, a: 2, nested: { y: 1, x: 2 } });

    const b = canonicalize({ nested: { x: 2, y: 1 }, a: 2, b: 1 });

    expect(a).toBe(b);
  });

  it("distinguishes null from absent and from string 'null'", () => {
    expect(canonicalize({ x: null })).not.toBe(canonicalize({}));
    expect(canonicalize({ x: null })).not.toBe(canonicalize({ x: "null" }));
  });
});

describe("computeEntryHash [INV-AUDIT-2]", () => {
  it("is reproducible from the same inputs (INV-FIN-8 spirit)", () => {
    const entry = baseEntry();

    const first = computeEntryHash(entry);
    const second = computeEntryHash(entry);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is independent of hashed-field object key order", () => {
    const ordered = baseEntry();
    const reordered: HashableEntry = {
      occurredAt: ordered.occurredAt,
      afterState: ordered.afterState,
      beforeState: ordered.beforeState,
      entityId: ordered.entityId,
      entityType: ordered.entityType,
      action: ordered.action,
      actorRole: ordered.actorRole,
      actorUserId: ordered.actorUserId,
      tenantId: ordered.tenantId,
      prevHash: ordered.prevHash,
      position: ordered.position,
    };

    expect(computeEntryHash(ordered)).toBe(computeEntryHash(reordered));
  });

  it("changes when any single hashed field is altered", () => {
    const original = computeEntryHash(baseEntry());

    expect(
      computeEntryHash({ ...baseEntry(), action: "period.filed" }),
    ).not.toBe(original);
    expect(computeEntryHash({ ...baseEntry(), position: 2 })).not.toBe(
      original,
    );
    expect(computeEntryHash({ ...baseEntry(), prevHash: "deadbeef" })).not.toBe(
      original,
    );
    expect(
      computeEntryHash({ ...baseEntry(), afterState: { state: "filed" } }),
    ).not.toBe(original);
    expect(
      computeEntryHash({
        ...baseEntry(),
        occurredAt: "2026-06-05T12:00:01.000Z",
      }),
    ).not.toBe(original);
  });

  it("breaks the link when a predecessor is mutated [INV-AUDIT-1]", () => {
    const a = baseEntry();
    const aHash = computeEntryHash(a);
    const b: HashableEntry = { ...baseEntry(), position: 2, prevHash: aHash };

    // Tamper with A; recompute its hash. B.prevHash now points at a hash that
    // the (mutated) A no longer produces — the chain link is broken.
    const aMutated: HashableEntry = { ...a, action: "period.tampered" };
    const aMutatedHash = computeEntryHash(aMutated);

    expect(b.prevHash).not.toBe(aMutatedHash);
  });

  it("uses a non-empty, constant genesis for the first entry", () => {
    expect(GENESIS_PREV_HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(GENESIS_PREV_HASH).not.toBe("0".repeat(64));
  });
});
