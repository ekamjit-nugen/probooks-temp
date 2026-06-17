/**
 * HmacTokenService (ADR-0005; STANDARDS §10.1, §11, §17). The Phase-0 concrete
 * TokenIssuer + TokenVerifier: a compact JWS (JWT) signed with HS256 via Node's
 * built-in node:crypto — no new dependency. Behind the TokenIssuer/TokenVerifier
 * interfaces so the IdP can swap (Auth0/Cognito → RS256/JWKS) at ADR-0002 with
 * no call-site change.
 *
 * Security:
 *  - Signature compared in constant time (crypto.timingSafeEqual).
 *  - Claims parsed + validated with Zod on verify (tamper → reject).
 *  - typ discriminates access vs refresh (no type confusion).
 *  - exp checked against the injected clock.
 *  - clientId presence enforced by role at sign AND verify (INV-AUTH-3).
 * Any failure throws InvalidTokenError (401) — never leaks which check failed.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../config-env/app-config.service";

import { InvalidTokenError } from "./auth.errors";
import { CLOCK, systemClockSeconds, type Clock } from "./clock";
import {
  AccessClaimsSchema,
  RefreshClaimsSchema,
  type AccessClaims,
  type AccessSubject,
  type RefreshClaims,
  type RefreshSubject,
  type TokenIssuer,
  type TokenVerifier,
} from "./token-contract";

const HEADER = { alg: "HS256", typ: "JWT" } as const;

function encodeSegment(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

@Injectable()
export class HmacTokenService implements TokenIssuer, TokenVerifier {
  private readonly clock: Clock;

  constructor(
    private readonly config: AppConfigService,
    @Inject(CLOCK) clock: Clock = systemClockSeconds,
  ) {
    this.clock = clock;
  }

  signAccessToken(subject: AccessSubject): string {
    const now = this.clock();
    const claims: AccessClaims = AccessClaimsSchema.parse({
      typ: "access",
      tenantId: subject.tenantId,
      userId: subject.userId,
      role: subject.role,
      ...(subject.subRole !== undefined ? { subRole: subject.subRole } : {}),
      ...(subject.clientId !== undefined ? { clientId: subject.clientId } : {}),
      iat: now,
      exp: now + this.config.get("jwtAccessTtlSeconds"),
    });
    return this.sign(claims);
  }

  signRefreshToken(subject: RefreshSubject): string {
    const now = this.clock();
    const claims: RefreshClaims = RefreshClaimsSchema.parse({
      typ: "refresh",
      tenantId: subject.tenantId,
      userId: subject.userId,
      jti: subject.jti,
      iat: now,
      exp: now + this.config.get("jwtRefreshTtlSeconds"),
    });
    return this.sign(claims);
  }

  verifyAccessToken(token: string): AccessClaims {
    const payload = this.verifyAndDecode(token);
    const result = AccessClaimsSchema.safeParse(payload);
    if (!result.success) {
      throw new InvalidTokenError();
    }
    return result.data;
  }

  verifyRefreshToken(token: string): RefreshClaims {
    const payload = this.verifyAndDecode(token);
    const result = RefreshClaimsSchema.safeParse(payload);
    if (!result.success) {
      throw new InvalidTokenError();
    }
    return result.data;
  }

  /** Sign claims into a compact JWS. */
  private sign(claims: object): string {
    const signingInput = `${encodeSegment(HEADER)}.${encodeSegment(claims)}`;
    const signature = this.hmac(signingInput);
    return `${signingInput}.${signature}`;
  }

  /** HMAC-SHA256 of the signing input, base64url-encoded. */
  private hmac(signingInput: string): string {
    return createHmac("sha256", this.requireSecret())
      .update(signingInput)
      .digest("base64url");
  }

  private requireSecret(): string {
    return this.config.getRequired("jwtSecret");
  }

  /**
   * Verify the signature in constant time and the exp against the clock, then
   * return the raw decoded payload for Zod validation by the caller. Any
   * structural, signature, or expiry problem throws InvalidTokenError.
   */
  private verifyAndDecode(token: string): unknown {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new InvalidTokenError();
    }
    const [header, payload, signature] = parts as [string, string, string];

    const expected = this.hmac(`${header}.${payload}`);
    if (!this.signaturesEqual(signature, expected)) {
      throw new InvalidTokenError();
    }

    const claims = this.decodePayload(payload);
    const exp = (claims as { exp?: unknown }).exp;
    if (typeof exp !== "number" || exp <= this.clock()) {
      throw new InvalidTokenError();
    }
    return claims;
  }

  private decodePayload(payload: string): unknown {
    try {
      return JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      ) as unknown;
    } catch {
      throw new InvalidTokenError();
    }
  }

  /** Constant-time signature comparison (length-mismatch fails closed). */
  private signaturesEqual(actual: string, expected: string): boolean {
    const a = Buffer.from(actual);
    const b = Buffer.from(expected);
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  }
}
