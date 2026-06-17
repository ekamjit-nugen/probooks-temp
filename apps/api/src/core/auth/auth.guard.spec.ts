/**
 * AuthGuard unit tests (STANDARDS §10.2; INV-AUTH-4, INV-TEN-3). Verifies the
 * Bearer token, builds a server-derived principal with permissions re-derived
 * from the role, ignores any tenantId in the body, excludes financial scope for
 * platform_operator, and rejects unauthenticated requests (401).
 */
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hasPermission } from "@probooks/shared";

import { AppConfigService } from "../config-env/app-config.service";
import { PUBLIC_METADATA_KEY } from "../rbac/rbac.decorators";

import { InvalidTokenError, UnauthenticatedError } from "./auth.errors";
import { AuthGuard } from "./auth.guard";
import { HmacTokenService } from "./hmac-token.service";
import type { AccessSubject } from "./token-contract";

const SECRET = "guard-secret-at-least-32-characters-long!!";
const clock = (): number => 1_700_000_000;

function service(): HmacTokenService {
  const config = new AppConfigService({
    nodeEnv: "test",
    port: 3000,
    logLevel: "info",
    databaseUrl: undefined,
    databaseServiceRoleUrl: undefined,
    jwtSecret: SECRET,
    jwtAccessTtlSeconds: 900,
    jwtRefreshTtlSeconds: 28_800,
  });
  return new HmacTokenService(config, clock);
}

function reflector(isPublic = false): Reflector {
  const r = new Reflector();
  jest
    .spyOn(r, "getAllAndOverride")
    .mockImplementation((key: unknown) =>
      key === PUBLIC_METADATA_KEY ? (isPublic as never) : (undefined as never),
    );
  return r;
}

interface FakeRequest {
  headers: Record<string, string | undefined>;
  body?: unknown;
  principalClaim?: unknown;
}

function contextFor(request: FakeRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => (): void => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

const OPERATOR: AccessSubject = {
  tenantId: "11111111-1111-7111-8111-111111111111",
  userId: "22222222-2222-7222-8222-222222222222",
  role: "platform_operator",
};

describe("AuthGuard [STD-10.2][INV-AUTH-4][INV-TEN-3]", () => {
  const tokens = service();

  it("rejects a request with no Authorization header (401)", () => {
    const guard = new AuthGuard(reflector(), tokens);
    expect(() => guard.canActivate(contextFor({ headers: {} }))).toThrow(
      UnauthenticatedError,
    );
  });

  it("rejects a non-Bearer scheme (401)", () => {
    const guard = new AuthGuard(reflector(), tokens);
    expect(() =>
      guard.canActivate(
        contextFor({ headers: { authorization: "Basic abc" } }),
      ),
    ).toThrow(UnauthenticatedError);
  });

  it("rejects an invalid/tampered token (401)", () => {
    const guard = new AuthGuard(reflector(), tokens);
    expect(() =>
      guard.canActivate(
        contextFor({ headers: { authorization: "Bearer not.a.jwt" } }),
      ),
    ).toThrow(InvalidTokenError);
  });

  it("allows a @Public route with no token", () => {
    const guard = new AuthGuard(reflector(true), tokens);
    expect(guard.canActivate(contextFor({ headers: {} }))).toBe(true);
  });

  it("attaches a server-derived principal and ignores a tenantId in the body", () => {
    const token = tokens.signAccessToken({
      tenantId: "33333333-3333-7333-8333-333333333333",
      userId: OPERATOR.userId,
      role: "firm_admin",
    });
    const request: FakeRequest = {
      headers: { authorization: `Bearer ${token}` },
      body: { tenantId: "deadbeef-dead-7ead-8ead-deaddeaddead" },
    };
    const guard = new AuthGuard(reflector(), tokens);

    expect(guard.canActivate(contextFor(request))).toBe(true);
    const claim = request.principalClaim as { tenantId: string };
    // The tenant came from the VERIFIED token, NOT the body.
    expect(claim.tenantId).toBe("33333333-3333-7333-8333-333333333333");
  });

  it("[INV-TEN-3] excludes financial scope for platform_operator", () => {
    const token = tokens.signAccessToken(OPERATOR);
    const request: FakeRequest = {
      headers: { authorization: `Bearer ${token}` },
    };
    const guard = new AuthGuard(reflector(), tokens);
    guard.canActivate(contextFor(request));

    const claim = request.principalClaim as {
      userRole: "platform_operator";
      permissions: ReadonlySet<string>;
    };
    expect(claim.permissions.has("financial:read")).toBe(false);
    expect(claim.permissions.has("quarter_numbers:view")).toBe(false);
    expect(claim.permissions.has("excel:download")).toBe(false);
    // Sanity: re-derived from the role, matching the shared matrix.
    expect(hasPermission("platform_operator", "tenant:provision_suspend")).toBe(
      true,
    );
  });
});
