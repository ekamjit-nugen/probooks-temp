/**
 * TenantGuard unit tests (STANDARDS §9.4; INV-TEN-2). A path tenant that does
 * not match the session tenant returns 404 (ResourceNotFoundError), NOT 403.
 */
import type { ExecutionContext } from "@nestjs/common";
import type { TenantId, UserId } from "@probooks/shared";
import { permissionsForRole } from "@probooks/shared";

import {
  ResourceNotFoundError,
  UnauthenticatedError,
} from "../auth/auth.errors";
import type { PrincipalClaim } from "../tenant-context/tenant-context.interceptor";

import { FIRM_ID_PARAM, TenantGuard } from "./tenant.guard";

const SESSION_TENANT = "11111111-1111-7111-8111-111111111111";

function principal(): PrincipalClaim {
  return {
    tenantId: SESSION_TENANT as TenantId,
    userId: "22222222-2222-7222-8222-222222222222" as UserId,
    userRole: "firm_admin",
    permissions: permissionsForRole("firm_admin"),
  };
}

function contextWith(
  params: Record<string, string | undefined>,
  claim?: PrincipalClaim,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ principalClaim: claim, params }),
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => (): void => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe("TenantGuard [STD-9.4][INV-TEN-2]", () => {
  const guard = new TenantGuard();

  it("passes when the path tenant matches the session tenant", () => {
    expect(
      guard.canActivate(
        contextWith({ [FIRM_ID_PARAM]: SESSION_TENANT }, principal()),
      ),
    ).toBe(true);
  });

  it("[INV-TEN-2] returns 404 (NOT 403) on a cross-tenant path", () => {
    const otherTenant = "99999999-9999-7999-8999-999999999999";
    try {
      guard.canActivate(
        contextWith({ [FIRM_ID_PARAM]: otherTenant }, principal()),
      );
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceNotFoundError);
      expect((error as ResourceNotFoundError).httpStatus).toBe(404);
    }
  });

  it("passes through when the route has no :firmId param", () => {
    expect(guard.canActivate(contextWith({}, principal()))).toBe(true);
  });

  it("rejects with 401 when no principal is present", () => {
    expect(() =>
      guard.canActivate(contextWith({ [FIRM_ID_PARAM]: SESSION_TENANT })),
    ).toThrow(UnauthenticatedError);
  });
});
