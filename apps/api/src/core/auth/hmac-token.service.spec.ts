/**
 * Unit tests for the internal HS256 token signer (STANDARDS §10.1; ADR-0005;
 * INV-AUTH-3). Round-trip, tamper rejection, expiry, type confusion, and the
 * INV-AUTH-3 clientId rule. Time is injected so expiry is deterministic.
 */
import { AppConfigService } from "../config-env/app-config.service";

import { InvalidTokenError } from "./auth.errors";
import { HmacTokenService } from "./hmac-token.service";
import type { AccessSubject, RefreshSubject } from "./token-contract";

const SECRET = "test-secret-at-least-32-characters-long!!";

function makeConfig(): AppConfigService {
  return new AppConfigService({
    nodeEnv: "test",
    port: 3000,
    logLevel: "info",
    databaseUrl: undefined,
    databaseServiceRoleUrl: undefined,
    jwtSecret: SECRET,
    jwtAccessTtlSeconds: 900,
    jwtRefreshTtlSeconds: 28_800,
  });
}

/** A controllable clock (epoch seconds). */
function clockFrom(ref: { now: number }): () => number {
  return () => ref.now;
}

const FIRM_SUBJECT: AccessSubject = {
  tenantId: "11111111-1111-7111-8111-111111111111",
  userId: "22222222-2222-7222-8222-222222222222",
  role: "firm_admin",
};

describe("HmacTokenService [STD-10.1][ADR-0005]", () => {
  const ref = { now: 1_700_000_000 };
  const service = new HmacTokenService(makeConfig(), clockFrom(ref));

  beforeEach(() => {
    ref.now = 1_700_000_000;
  });

  it("round-trips an access token with its claims", () => {
    const token = service.signAccessToken(FIRM_SUBJECT);
    const claims = service.verifyAccessToken(token);

    expect(claims.typ).toBe("access");
    expect(claims.tenantId).toBe(FIRM_SUBJECT.tenantId);
    expect(claims.userId).toBe(FIRM_SUBJECT.userId);
    expect(claims.role).toBe("firm_admin");
    expect(claims.exp).toBe(ref.now + 900);
  });

  it("rejects a token whose signature byte was altered [tamper]", () => {
    const token = service.signAccessToken(FIRM_SUBJECT);
    const [h, p, sig] = token.split(".");
    const flipped = (sig?.[0] === "A" ? "B" : "A") + (sig?.slice(1) ?? "");
    const tampered = `${h}.${p}.${flipped}`;

    expect(() => service.verifyAccessToken(tampered)).toThrow(
      InvalidTokenError,
    );
  });

  it("rejects a token whose claims were edited without re-signing [tamper]", () => {
    const token = service.signAccessToken(FIRM_SUBJECT);
    const [h, , sig] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({
        typ: "access",
        tenantId: FIRM_SUBJECT.tenantId,
        userId: FIRM_SUBJECT.userId,
        role: "platform_operator", // escalation attempt
        iat: ref.now,
        exp: ref.now + 900,
      }),
    ).toString("base64url");

    expect(() =>
      service.verifyAccessToken(`${h}.${forgedPayload}.${sig}`),
    ).toThrow(InvalidTokenError);
  });

  it("rejects an expired access token", () => {
    const token = service.signAccessToken(FIRM_SUBJECT);
    ref.now += 901; // past the 900s TTL

    expect(() => service.verifyAccessToken(token)).toThrow(InvalidTokenError);
  });

  it("rejects a refresh token presented as an access token [type confusion]", () => {
    const refreshSubject: RefreshSubject = {
      tenantId: FIRM_SUBJECT.tenantId,
      userId: FIRM_SUBJECT.userId,
      jti: "33333333-3333-7333-8333-333333333333",
    };
    const refresh = service.signRefreshToken(refreshSubject);

    expect(() => service.verifyAccessToken(refresh)).toThrow(InvalidTokenError);
  });

  it("rejects a structurally malformed token", () => {
    expect(() => service.verifyAccessToken("not.a.jwt")).toThrow(
      InvalidTokenError,
    );
    expect(() => service.verifyAccessToken("only-one-segment")).toThrow(
      InvalidTokenError,
    );
  });

  it("[INV-AUTH-3] carries clientId for a client role and round-trips it", () => {
    const clientSubject: AccessSubject = {
      tenantId: FIRM_SUBJECT.tenantId,
      userId: "44444444-4444-7444-8444-444444444444",
      role: "client_owner",
      clientId: "55555555-5555-7555-8555-555555555555",
    };
    const token = service.signAccessToken(clientSubject);
    const claims = service.verifyAccessToken(token);

    expect(claims.role).toBe("client_owner");
    expect(claims.clientId).toBe(clientSubject.clientId);
  });

  it("[INV-AUTH-3] refuses to sign a firm token carrying a clientId", () => {
    expect(() =>
      service.signAccessToken({
        ...FIRM_SUBJECT,
        clientId: FIRM_SUBJECT.tenantId,
      }),
    ).toThrow();
  });

  it("[INV-AUTH-3] refuses to sign a client token missing a clientId", () => {
    expect(() =>
      service.signAccessToken({ ...FIRM_SUBJECT, role: "client_owner" }),
    ).toThrow();
  });

  it("round-trips a refresh token with its jti", () => {
    const refreshSubject: RefreshSubject = {
      tenantId: FIRM_SUBJECT.tenantId,
      userId: FIRM_SUBJECT.userId,
      jti: "66666666-6666-7666-8666-666666666666",
    };
    const token = service.signRefreshToken(refreshSubject);
    const claims = service.verifyRefreshToken(token);

    expect(claims.typ).toBe("refresh");
    expect(claims.jti).toBe(refreshSubject.jti);
    expect(claims.exp).toBe(ref.now + 28_800);
  });
});
