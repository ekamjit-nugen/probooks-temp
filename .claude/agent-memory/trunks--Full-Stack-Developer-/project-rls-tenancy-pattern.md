---
name: project-rls-tenancy-pattern
description: How ProBooks enforces Postgres RLS tenant isolation + how to test it correctly (non-superuser role, NULLIF fail-closed)
metadata:
  type: project
---

Phase 0 Wave 2 established the tenant-isolation backstop. Every tenant-scoped wave builds on this.

**The runtime pattern (STANDARDS §8.4/§9.3):**
- `PrismaService` connects as `app_user` (DATABASE_URL) — a NON-superuser, non-owner role, so RLS binds.
- Tenant-scoped work goes through `PrismaService.runInTenantTx(work)`: opens a `$transaction`, issues `SET LOCAL app.tenant_id = '<uuid>'`, runs `work(tx)`. Tenant comes from `TenantContextService.require()` (ALS), NEVER a param.
- `PlatformPrismaService` connects as `service_role` (DATABASE_SERVICE_ROLE_URL, BYPASSRLS) — platform/operator/migration only (INV-TEN-3). Distinct class so it can't be injected into a tenant repo.
- RLS policies use `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`.

**Why:** the `NULLIF(...,'')` matters — when `app.tenant_id` is unset, `current_setting(...,true)` returns `''`, and `''::uuid` would THROW. NULLIF turns it into NULL → comparison false → zero rows (fail-closed) with no error a buggy caller could swallow. Tables are ENABLE + FORCE RLS (FORCE so even the owner is bound).

**How to apply (testing — do not get this wrong):**
- RLS tests MUST connect as `app_user`, NOT the Testcontainers default `postgres` (superuser → bypasses RLS → proves nothing). Harness: `startPostgresHarness(prismaDir)` in `@probooks/test-utils` boots postgres:16, runs `prisma migrate deploy` as owner, then `ALTER ROLE app_user/service_role LOGIN PASSWORD`. Exposes `appUserUrl`, `serviceRoleUrl`, `ownerUrl`.
- The load-bearing assertion: bind tenant A, query tenant B's row BY ID with NO tenant_id in WHERE → expect 0 rows. RLS, not app code, blocks it.
- Seed fixtures via `serviceRoleUrl` (BYPASSRLS). `audit_log` is append-only: app_user has SELECT+INSERT only (UPDATE/DELETE → permission denied), INV-AUDIT-2/3.

**Gotchas hit:** UUIDv7 SQL function needs `::integer` casts on masked bytes (set_byte rejects bigint). `updated_at` columns got `DEFAULT CURRENT_TIMESTAMP` so raw/service_role inserts (outside Prisma's `@updatedAt`) don't violate NOT NULL.

Related: [[project-shared-package-resolution]] (cross-package + node-version note: repo needs Node 22 via nvm; `which node` may show 18).
