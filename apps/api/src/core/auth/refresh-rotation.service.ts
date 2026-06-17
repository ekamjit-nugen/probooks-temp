/**
 * RefreshRotationService (STANDARDS §10.1; INV-AUTH-4). Exchanges a refresh
 * token for a fresh access token + a rotated refresh token, with replay
 * detection backed by the refresh_tokens table.
 *
 * Rotation:
 *  1. Verify the refresh token (signature, type, expiry) via TokenVerifier.
 *  2. Look up its jti for the current tenant. Missing OR already-revoked → a
 *     replay: revoke the WHOLE lineage (every active token for the user) and
 *     reject with RefreshTokenReplayError (401). Defense-in-depth.
 *  3. Otherwise: revoke the presented jti, persist a new refresh token (jti J2,
 *     rotated_from J1), and issue a new access token.
 *
 * The subject (role/clientId) for the new access token must come from the
 * caller (the auth/login layer, later phases) — this Phase-0 service is given
 * the AccessSubject explicitly so it never invents authority from the refresh
 * token alone. Tenant comes from context (it seeds from the verified refresh
 * claims at the call site), never a parameter (STANDARDS §9.3).
 */
import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../config-env/app-config.service";

import { RefreshTokenReplayError } from "./auth.errors";
import { CLOCK, systemClockSeconds, type Clock } from "./clock";
import { RefreshTokenRepository } from "./refresh-token.repository";
import {
  TOKEN_ISSUER,
  TOKEN_VERIFIER,
  type AccessSubject,
  type TokenIssuer,
  type TokenVerifier,
} from "./token-contract";

/** The pair returned by a successful rotation. */
export interface RotatedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly refreshJti: string;
}

@Injectable()
export class RefreshRotationService {
  private readonly clock: Clock;

  constructor(
    @Inject(TOKEN_ISSUER) private readonly issuer: TokenIssuer,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    private readonly repository: RefreshTokenRepository,
    private readonly config: AppConfigService,
    @Inject(CLOCK) clock: Clock = systemClockSeconds,
  ) {
    this.clock = clock;
  }

  /**
   * Exchange `presentedRefreshToken` for a new token pair. `subject` carries the
   * authority the new access token should bear (role/clientId), supplied by the
   * caller — never derived from the refresh token. The presented token's
   * tenant/user must match the subject.
   */
  async rotate(
    presentedRefreshToken: string,
    subject: AccessSubject,
  ): Promise<RotatedTokens> {
    // 1. Verify signature/type/expiry. Throws InvalidTokenError (401) on failure.
    const claims = this.verifier.verifyRefreshToken(presentedRefreshToken);

    const existing = await this.repository.findByJti(claims.jti);

    // 2. Replay: unknown jti or already revoked → kill the lineage, reject.
    if (existing === null || existing.revokedAt !== null) {
      await this.repository.revokeAllForUser(claims.userId, new Date());
      throw new RefreshTokenReplayError();
    }

    // 3. Rotate: revoke presented, mint + persist successor, issue access.
    const now = new Date();
    await this.repository.revokeByJti(claims.jti, now);

    const newJti = randomUUID();
    const expiresAt = new Date(
      (this.clock() + this.config.get("jwtRefreshTtlSeconds")) * 1000,
    );
    await this.repository.create({
      userId: claims.userId,
      jti: newJti,
      rotatedFromJti: claims.jti,
      expiresAt,
    });

    const accessToken = this.issuer.signAccessToken(subject);
    const refreshToken = this.issuer.signRefreshToken({
      tenantId: subject.tenantId,
      userId: subject.userId,
      jti: newJti,
    });

    return { accessToken, refreshToken, refreshJti: newJti };
  }
}
