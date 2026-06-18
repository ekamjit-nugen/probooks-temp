---
name: auth-rbac-guards
description: ProBooks Phase-0 Wave-3 auth/RBAC/guard architecture — token interfaces, HS256 signer, guard stack order, RBAC matrix source of truth.
metadata:
  type: project
---

Phase 0 Wave 3 landed the auth/RBAC/tenancy-guard layer. Key facts not obvious from a quick read:

**Why:** STANDARDS §10 + SPEC §4.17 require deny-by-default RBAC, cross-tenant
404 (not 403), and a provider-swappable token layer (Auth0/Cognito deferred to
ADR-0002). See [[project-rls-tenancy-pattern]].

**How to apply when extending auth/authz:**
- Token layer is behind `TokenIssuer`/`TokenVerifier` interfaces in
  `apps/api/src/core/auth/token-contract.ts`. Concrete impl `HmacTokenService`
  (HS256 via node:crypto, ADR-0005) — do NOT add jsonwebtoken/jose for Phase 0.
  When ADR-0002 picks a provider, replace the concrete class bound to
  `TOKEN_ISSUER`/`TOKEN_VERIFIER` symbols in `auth.module.ts`; call sites untouched.
- RBAC matrix single source of truth: `packages/shared/src/auth/permissions.ts`
  encodes SPEC §4.17 as `CAPABILITY_MATRIX` (grant/read/deny per role).
  `permissions.spec.ts` asserts it cell-by-cell vs a verbatim §4.17 transcription —
  if you change a permission, update BOTH the matrix and EXPECTED_417.
  Rows §4.17 grants to NO role (select-period, perma-delete) are global
  prohibitions, NOT permissions.
- Guard order is load-bearing (STANDARDS §10.2): AuthGuard → TenantGuard →
  RoleGuard → ResourceGuard. Apply via `@UseGuards(...GUARD_STACK)` from
  `core/tenancy-guard/guard-stack.ts`.
- Guards read the principal from `req.principalClaim` (set by AuthGuard), NOT from
  the ALS TenantContext — because Nest runs guards BEFORE interceptors, and the
  TenantContextInterceptor (which seeds ALS from the verified principal) is a
  global interceptor wired in main.ts. So: guards use req.principalClaim; the
  handler + repositories use TenantContextService.require().
- Cross-tenant path mismatch → `ResourceNotFoundError` (404), same-tenant role
  denial → `ForbiddenError` (403). Never leak existence across tenants.
- Access claim enforces INV-AUTH-3: client roles MUST carry clientId, firm/operator
  roles MUST NOT — enforced at sign (Zod superRefine) AND verify.
- `TenantContext.permissions` is now `ReadonlySet<Permission>` (the shared union),
  not `ReadonlySet<string>`. Test contexts must use `new Set<Permission>()`.
- AppConfig gained jwtSecret (optional, ≥32 chars)/jwtAccessTtlSeconds/
  jwtRefreshTtlSeconds — any new AppConfig literal in a test must include all three.
