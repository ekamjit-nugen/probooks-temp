-- Wave 6 — financial stub: period_summaries (STANDARDS §8.6 money; INV-TEN-3).
--
-- The canonical "tenant FINANCIAL data the Platform Operator must never read."
-- Tenant- + client-scoped, RLS-enforced. Money is NUMERIC(18,4) (§8.6 — never
-- float/double/JS number). This table anchors the INV-TEN-3 proof:
--
--   * GRANT layer  — service_role (the operator/platform connection) is granted
--     NO privileges here. A stray operator query gets "permission denied" at the
--     DB, not just a code-review catch. (Contrast users/clients, where
--     service_role has CRUD for legitimate lifecycle work.)
--   * RLS layer    — app_user reads only rows for the tenant bound by
--     SET LOCAL app.tenant_id; with no/another tenant bound it sees zero rows
--     (fail-closed NULLIF policy).
--   * STRUCTURE    — PlatformRepository (the only service_role consumer) exposes
--     no method that touches this table (STANDARDS §9.6).

-- CreateTable
CREATE TABLE "period_summaries" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "period_label" TEXT NOT NULL,
    "net_tax" NUMERIC(18,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "period_summaries_pkey" PRIMARY KEY ("id")
);

-- ForeignKeys
ALTER TABLE "period_summaries"
  ADD CONSTRAINT "fk_period_summaries_tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "period_summaries"
  ADD CONSTRAINT "fk_period_summaries_client"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ix_period_summaries_tenant_id" ON "period_summaries"("tenant_id");
CREATE INDEX "ix_period_summaries_tenant_client" ON "period_summaries"("tenant_id", "client_id");

-- Grants: app_user (tenant-scoped, RLS-enforced) ONLY. service_role gets nothing
-- here — INV-TEN-3 enforced at the grant layer (operator cannot read financials).
GRANT SELECT, INSERT, UPDATE, DELETE ON "period_summaries" TO app_user;

-- RLS: ENABLE + FORCE + fail-closed tenant-isolation policy (same pattern as the
-- other tenant-scoped tables, 20260604120200).
ALTER TABLE "period_summaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "period_summaries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "rls_period_summaries_tenant_isolation" ON "period_summaries"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
