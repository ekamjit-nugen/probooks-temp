-- Audit hash chain — Phase 0 Wave 4 (STANDARDS §8.3, §18.3; INV-AUDIT-1/2/3).
--
-- Extends the append-only audit_log (created in 20260604120100_init_spine, made
-- INSERT-only + RLS-forced in 20260604120200_rls_and_roles) with the fields the
-- hash chain needs:
--   actor_role  — the acting principal's role (who, alongside actor_user_id);
--   occurred_at — when the transition happened (distinct from created_at, when
--                 the row was written);
--   position    — per-tenant monotonic 1-based sequence (ordering + gap detection);
--   prev_hash   — the predecessor entry's entry_hash (genesis for the first);
--   entry_hash  — sha256 over the canonical hashed fields (tamper evidence).
--
-- These are NEW columns on a table that holds no production data yet (Phase 0).
-- They are NOT NULL with no default: the audit service always sets them on the
-- single INSERT path. This is a forward-only migration; the prior two migrations
-- are NOT edited (STANDARDS §8.3 — never edit a merged migration).
--
-- A UNIQUE (tenant_id, position) constraint is the DB-level correctness backstop
-- (STANDARDS §15.2 layer 3): even if two appenders raced past the advisory lock,
-- the second commit with a duplicate position fails — the chain cannot fork.

ALTER TABLE "audit_log"
  ADD COLUMN "actor_role"  text,
  ADD COLUMN "occurred_at" timestamptz(6) NOT NULL DEFAULT now(),
  ADD COLUMN "position"    bigint        NOT NULL,
  ADD COLUMN "prev_hash"   text          NOT NULL,
  ADD COLUMN "entry_hash"  text          NOT NULL;

-- Drop the DEFAULT now() — it was only to satisfy NOT NULL had any rows existed;
-- the service supplies occurred_at explicitly on every INSERT.
ALTER TABLE "audit_log" ALTER COLUMN "occurred_at" DROP DEFAULT;

-- Per-tenant monotonic position: the fork backstop (STANDARDS §15.2 layer 3).
ALTER TABLE "audit_log"
  ADD CONSTRAINT "uq_audit_log_tenant_position" UNIQUE ("tenant_id", "position");

-- The chain is walked in (tenant_id, position) order by the verifier; index it.
CREATE INDEX "ix_audit_log_tenant_position"
  ON "audit_log" ("tenant_id", "position");

-- entry_hash is globally unique by construction (it binds position + tenant +
-- prev_hash); a unique index makes a duplicated/forged hash a hard error too.
CREATE UNIQUE INDEX "uq_audit_log_entry_hash" ON "audit_log" ("entry_hash");

-- Re-affirm the append-only grant for the new columns is unaffected: app_user
-- still has only SELECT, INSERT on audit_log (set in 20260604120200); adding
-- columns does not change table-level privileges, so no re-GRANT is required.
