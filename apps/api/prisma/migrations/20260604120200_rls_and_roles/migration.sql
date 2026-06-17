-- Row-Level Security backstop + DB roles (STANDARDS §8.4, §9.6; INV-TEN-1/2/3).
--
-- Defense-in-depth: even if an application bug drops tenant_id from a WHERE
-- clause, RLS returns ZERO cross-tenant rows. The application connects as a
-- NON-superuser, NON-owner role (app_user) with FORCE ROW LEVEL SECURITY so the
-- policies bind. Platform/migration work uses service_role with BYPASSRLS.
--
-- Per-request, the app issues `SET LOCAL app.tenant_id = '<uuid>'` inside a
-- transaction; policies read it via current_setting('app.tenant_id', true). The
-- `true` (missing_ok) returns '' when unset; NULLIF(...,'') turns that into NULL
-- so the comparison is NULL (false) → zero rows (fail-closed), WITHOUT raising
-- an "invalid uuid" error that buggy callers might swallow.

-- ---------------------------------------------------------------------------
-- Roles. Created idempotently so the migration is safe on a shared cluster
-- where a role may already exist from a prior database in the same instance.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    -- Application role: NOT a superuser, NOT the table owner, so RLS applies.
    -- NOLOGIN by default here; the test harness / deployment grants LOGIN +
    -- a password out-of-band (we never commit credentials — STANDARDS §17).
    CREATE ROLE app_user NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    -- Platform/migration role: bypasses RLS for operator metadata + migrations
    -- (STANDARDS §9.6, INV-TEN-3). Structurally separate from app_user.
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Privileges for app_user. Least-privilege (STANDARDS §18, INV-RBAC-1):
--   - SELECT/INSERT/UPDATE/DELETE on tenant-scoped operational tables it owns
--     the lifecycle of (users, clients, idempotency_keys, refresh_tokens).
--   - audit_log is APPEND-ONLY (INV-AUDIT-2/3): SELECT + INSERT only, never
--     UPDATE or DELETE.
--   - tenants: SELECT only for app_user (lifecycle is service_role's job).
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO app_user;
GRANT USAGE ON SCHEMA public TO service_role;

GRANT SELECT ON "tenants" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "users" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "clients" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "idempotency_keys" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "refresh_tokens" TO app_user;
GRANT SELECT, INSERT ON "audit_log" TO app_user;

-- service_role manages all tables (bypasses RLS for platform ops + migrations).
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenants" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON "users" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON "clients" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON "idempotency_keys" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON "refresh_tokens" TO service_role;
GRANT SELECT, INSERT ON "audit_log" TO service_role;

-- ---------------------------------------------------------------------------
-- RLS: ENABLE + FORCE on every tenant-scoped table. FORCE is essential — it
-- makes RLS apply even to the table owner, so a bug that connects as the owner
-- still cannot read across tenants. `tenants` is the isolation boundary itself
-- (not tenant-scoped data) and is governed by role grants, not a tenant policy.
-- ---------------------------------------------------------------------------

-- users
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY "rls_users_tenant_isolation" ON "users"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- clients
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clients" FORCE ROW LEVEL SECURITY;
CREATE POLICY "rls_clients_tenant_isolation" ON "clients"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- audit_log
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY "rls_audit_log_tenant_isolation" ON "audit_log"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- idempotency_keys
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY "rls_idempotency_keys_tenant_isolation" ON "idempotency_keys"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- refresh_tokens
ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY "rls_refresh_tokens_tenant_isolation" ON "refresh_tokens"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
