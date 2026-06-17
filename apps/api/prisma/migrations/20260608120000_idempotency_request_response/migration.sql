-- Wave 5 — HTTP idempotency (STANDARDS §7.4).
--
-- The init_spine idempotency_keys table modelled only `response_hash`, which is
-- insufficient to (a) replay the actual cached response and (b) detect a reused
-- key carrying a DIFFERENT body. This migration completes the §7.4 model:
--   - request_fingerprint : sha256(method+path+body) → same key + diff body = 409
--   - state               : in_progress → completed lifecycle (the claim marker)
--   - response_status/body : the stored response, replayed verbatim on a repeat
--   - response_hash        : relaxed to NULLable (no response exists while in_progress)
--
-- Backward-compatible (STANDARDS §8.3): the table is empty in every environment
-- (no traffic in Phase 0), new columns are nullable or defaulted, and the
-- existing UNIQUE (tenant_id, key) — the Layer-3 backstop (§15.2) — is retained.
-- RLS (ENABLE + FORCE) and the app_user/service_role grants set in
-- 20260604120200_rls_and_roles already cover the whole row, including new
-- columns; no policy or grant change is required.

ALTER TABLE "idempotency_keys"
  ADD COLUMN "request_fingerprint" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "state" TEXT NOT NULL DEFAULT 'in_progress',
  ADD COLUMN "response_status" INTEGER,
  ADD COLUMN "response_body" JSONB;

-- A response only exists once the request COMPLETES; null while in_progress.
ALTER TABLE "idempotency_keys" ALTER COLUMN "response_hash" DROP NOT NULL;

-- state is a closed enum at the application layer; enforce it at the DB too.
ALTER TABLE "idempotency_keys"
  ADD CONSTRAINT "ck_idempotency_keys_state"
  CHECK ("state" IN ('in_progress', 'completed'));

-- The DEFAULT on request_fingerprint exists only to satisfy NOT NULL on the
-- (empty) existing table; every real insert supplies a fingerprint explicitly.
ALTER TABLE "idempotency_keys" ALTER COLUMN "request_fingerprint" DROP DEFAULT;
