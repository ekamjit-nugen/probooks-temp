# ADR-0001: INV-code canonicalization (SPEC wins over PRD labels)

- **Status:** Accepted (2026-06-04)
- **Context:** PRD.md §5 Phase 0 uses invariant labels (INV-TENANT-1, INV-RES-CA,
  INV-IDEMPOTENCY-1, INV-OPERATOR-NO-FIN-DATA) that drift from SPEC.md §4, the
  source of truth per CLAUDE.md's hierarchy (SPEC > STANDARDS > PRD).
- **Decision:** Code, tests, and commits cite the **SPEC** codes. Mapping:
  - INV-TENANT-1 / INV-TENANT-2 → **INV-TEN-1** (tenant_id on every row; RLS is its backstop)
  - INV-OPERATOR-NO-FIN-DATA → **INV-TEN-3**
  - INV-RES-CA → **INV-AUDIT-5** (ca-central-1 residency)
  - INV-AUDIT-1 / IMMUT → **INV-AUDIT-1, INV-AUDIT-2**
  - INV-AUTH-1 → **INV-AUTH-1, INV-AUTH-4**
  - INV-IDEMPOTENCY-1 → no SPEC code; cite **STD-7.4** (STANDARDS §7.4).
- **Consequences:** Test names and PR bodies reference SPEC codes. A future PRD
  revision should adopt SPEC codes to remove the drift.
- **Alternatives considered:** Use PRD labels (rejected — violates the doc hierarchy).
