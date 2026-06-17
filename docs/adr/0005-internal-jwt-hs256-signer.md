# ADR-0005: Internal HS256 JWT signer (Node crypto) behind a swappable interface

- **Status:** Accepted (2026-06-05)
- **Context:** Phase 0 Wave 3 needs an access/refresh token layer NOW, but the
  identity provider decision (Auth0 vs Cognito) is deferred to ADR-0002 at
  Phase 1 (per `docs/phase-0-plan.md` J.1 and STANDARDS §10.1). We must:
  1. Issue + verify short-lived access JWTs (~15 min) carrying tenantId, userId,
     role, sub_role, optional clientId, and refresh tokens (~8 h) with rotation
     lineage.
  2. Do it without committing to a provider, so the provider can swap with no
     call-site changes.
  3. Avoid introducing a heavy new dependency where the platform crypto suffices.
     STANDARDS §1 locks the stack and discourages unjustified dependencies;
     STANDARDS §11/§12 lock validation/error libraries (not crypto), so a JWT
     library is not pre-decided.
- **Decision:**
  - Define provider-neutral interfaces `TokenIssuer` + `TokenVerifier` (in
    `apps/api/src/core/auth`). All call sites (AuthGuard, refresh rotation)
    depend on the interfaces, never a concrete signer.
  - The Phase-0 concrete implementation, `HmacTokenService`, signs/verifies a
    compact JWS (JWT) using **HS256** via Node's built-in `node:crypto`
    (`createHmac('sha256', …)`) — no new dependency. Constant-time signature
    comparison via `crypto.timingSafeEqual`. Claims are parsed/validated with
    Zod (STANDARDS §11) on verify; tampered signature, tampered claims, wrong
    `typ`, expired `exp`, or wrong issuer/audience all reject.
  - The signing secret comes from config-env (`JWT_SECRET`, ≥32 bytes), via
    AWS Secrets Manager in real environments (STANDARDS §17) — never committed.
    Access/refresh TTLs are config (`JWT_ACCESS_TTL_SECONDS`,
    `JWT_REFRESH_TTL_SECONDS`) with the §10.1 defaults (900 / 28800).
  - HS256 (symmetric) is acceptable because the issuer and verifier are the same
    service in Phase 0. When ADR-0002 selects a provider, swapping to RS256/JWKS
    (asymmetric) is an interface-conformant replacement of `HmacTokenService`
    with, e.g., a `JwksTokenVerifier` — no change to AuthGuard or rotation.
- **Consequences:**
  - One symmetric secret to manage/rotate in Phase 0 (Secrets Manager rotation
    per STANDARDS §17). Acceptable for a single-service issuer; revisited at
    ADR-0002 when a third-party IdP issues tokens (then verification goes
    asymmetric and the secret is retired).
  - No login/MFA/passwordless UI is built here (later phases) — only the token
    contract, verification, refresh rotation, and the AuthGuard seam.
- **Alternatives considered:**
  - `jsonwebtoken` / `jose` libraries (rejected for Phase 0 — unnecessary
    dependency for a single-service HS256 signer; `jose` becomes attractive at
    ADR-0002 for JWKS, and the interface lets us adopt it then with no call-site
    churn).
  - Opaque random tokens + server-side session store (rejected — refresh tokens
    ARE server-side-tracked here via `refresh_tokens`, but the short-lived access
    token is deliberately stateless/self-describing so the request path needs no
    DB hit; that is the standard access/refresh split in STANDARDS §10.1).
- **Reference:** STANDARDS §10.1; `docs/phase-0-plan.md` J.1; ADR-0002 (provider,
  deferred to Phase 1).
