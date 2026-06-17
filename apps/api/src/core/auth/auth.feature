Feature: Internal token layer + AuthGuard (STANDARDS §10.1/§10.2; INV-AUTH-1/3/4; ADR-0005)
  An internal HS256 signer issues short-lived access tokens and ~8h refresh tokens
  behind TokenIssuer/TokenVerifier interfaces, so the IdP can swap (ADR-0002) with
  no call-site changes. The AuthGuard verifies the access token, builds the
  principal, and hands it to the existing tenant-context seam.

  Scenario: A signed access token round-trips with its claims
    Given a firm_admin subject for tenant T and user U
    When an access token is signed and then verified
    Then the claims carry tenantId T, userId U, role firm_admin and typ "access"

  Scenario: The claim builder excludes financial scope for platform_operator
    Given a platform_operator subject (INV-TEN-3)
    When an access token is signed and verified
    Then the principal holds no financial permission (financial:read, quarter_numbers:view, excel:download)
    And it holds only tenant-lifecycle/governance permissions

  Scenario: A tampered signature is rejected
    Given a validly signed access token
    When a single byte of its signature is altered and it is verified
    Then verification throws InvalidTokenError (401)

  Scenario: Tampered claims are rejected
    Given a validly signed access token
    When the payload is edited (e.g. role escalated) without re-signing and verified
    Then verification throws InvalidTokenError (401)

  Scenario: An expired access token is rejected
    Given an access token whose exp is in the past
    When it is verified
    Then verification throws InvalidTokenError (401)

  Scenario: A client access token must carry a clientId; a firm token must not
    Given a client_owner subject with a clientId
    Then the verified claims expose that clientId
    Given a firm_admin subject
    Then signing with a clientId is rejected (INV-AUTH-3)

  Scenario: AuthGuard rejects a request with no/blank Authorization header
    Given a request without a Bearer token
    When the AuthGuard runs
    Then it throws UnauthenticatedError (401)

  Scenario: AuthGuard attaches a server-derived principal claim from the verified token
    Given a request with a valid Bearer access token for tenant T
    When the AuthGuard runs
    Then it attaches req.principalClaim built from the VERIFIED token
    And any tenantId in the request body is ignored
    And the permissions are re-derived from the role per request (INV-AUTH-4)

Feature: Refresh rotation with replay detection (STANDARDS §10.1; INV-AUTH-4)
  Refresh tokens are tracked in the refresh_tokens table by jti with a rotation
  lineage. Refreshing issues a new access token and rotates the refresh jti,
  revoking the prior. Presenting a revoked/old jti is a replay → 401 and the
  whole lineage is revoked (defense).

  Scenario: Rotating issues a new refresh jti and revokes the prior
    Given a valid refresh token with jti J1
    When it is exchanged
    Then a new access token is issued
    And a new refresh token with jti J2 (rotated_from J1) is persisted
    And J1 is marked revoked

  Scenario: Replaying an already-rotated refresh token is rejected and revokes the lineage
    Given J1 has already been rotated to J2
    When J1 is presented again
    Then the exchange throws RefreshTokenReplayError (401)
    And J2 (the active descendant) is also revoked
