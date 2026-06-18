# Trunks — Agent Memory Index (ProBooks)

## Project
- [Shared package resolution](project-shared-package-resolution.md) — how apps/api imports @probooks/shared across the ADR-0003 Node/NodeNext split (dist exports + jest mapper).
- [RLS tenancy pattern](project-rls-tenancy-pattern.md) — Prisma app_user + runInTenantTx SET LOCAL + NULLIF fail-closed RLS; how to test it (non-superuser harness, zero-rows-without-WHERE).
- [Auth/RBAC/guards](project-auth-rbac-guards.md) — token interfaces + HS256 signer (ADR-0005), guard stack order, RBAC matrix in shared (SPEC §4.17), guards read req.principalClaim, cross-tenant 404.
