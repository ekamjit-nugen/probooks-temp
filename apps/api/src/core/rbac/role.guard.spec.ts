/**
 * RoleGuard unit tests (STANDARDS §10.2/§10.4; INV-RBAC-1, INV-AUTH-4). Covers
 * deny-by-default for unannotated routes, @RequireRole, @RequirePermission, and
 * that same-tenant denial is ForbiddenError (403) — not 404.
 */
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  permissionsForRole,
  type Permission,
  type TenantId,
  type UserId,
  type UserRole,
} from "@probooks/shared";

import { ForbiddenError } from "../auth/auth.errors";
import type { PrincipalClaim } from "../tenant-context/tenant-context.interceptor";

import {
  PERMISSIONS_METADATA_KEY,
  PUBLIC_METADATA_KEY,
  ROLES_METADATA_KEY,
} from "./rbac.decorators";
import { RoleGuard } from "./role.guard";

function principal(role: UserRole): PrincipalClaim {
  return {
    tenantId: "11111111-1111-7111-8111-111111111111" as TenantId,
    userId: "22222222-2222-7222-8222-222222222222" as UserId,
    userRole: role,
    permissions: permissionsForRole(role),
  };
}

/** A minimal ExecutionContext with a request carrying a principal. */
function contextWith(claim?: PrincipalClaim): ExecutionContext {
  const handler = (): void => undefined;
  class Controller {}
  return {
    switchToHttp: () => ({
      getRequest: () => ({ principalClaim: claim }),
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => handler,
    getClass: () => Controller,
  } as unknown as ExecutionContext;
}

/** Reflector stubbed to return metadata for the named keys. */
function reflectorWith(meta: Record<string, unknown>): Reflector {
  const reflector = new Reflector();
  jest
    .spyOn(reflector, "getAllAndOverride")
    .mockImplementation((key: unknown) => meta[key as string] as never);
  return reflector;
}

describe("RoleGuard [STD-10.4][INV-RBAC-1]", () => {
  it("[INV-RBAC-1] denies an unannotated guarded route (deny-by-default)", () => {
    const guard = new RoleGuard(reflectorWith({}));
    expect(() =>
      guard.canActivate(contextWith(principal("firm_admin"))),
    ).toThrow(ForbiddenError);
  });

  it("allows a @Public route without a principal", () => {
    const guard = new RoleGuard(reflectorWith({ [PUBLIC_METADATA_KEY]: true }));
    expect(guard.canActivate(contextWith(undefined))).toBe(true);
  });

  it("@RequireRole permits the listed role and rejects others (403)", () => {
    const guard = new RoleGuard(
      reflectorWith({ [ROLES_METADATA_KEY]: ["accountant"] as UserRole[] }),
    );
    expect(guard.canActivate(contextWith(principal("accountant")))).toBe(true);
    expect(() =>
      guard.canActivate(contextWith(principal("client_owner"))),
    ).toThrow(ForbiddenError);
  });

  it("@RequirePermission checks the §4.17 matrix per request", () => {
    const guard = new RoleGuard(
      reflectorWith({
        [PERMISSIONS_METADATA_KEY]: ["period:mark_complete"] as Permission[],
      }),
    );
    // accountant holds period:mark_complete; client_owner does not.
    expect(guard.canActivate(contextWith(principal("accountant")))).toBe(true);
    expect(() =>
      guard.canActivate(contextWith(principal("client_owner"))),
    ).toThrow(ForbiddenError);
  });

  it("[INV-TEN-3] platform_operator is denied financial:read", () => {
    const guard = new RoleGuard(
      reflectorWith({
        [PERMISSIONS_METADATA_KEY]: ["financial:read"] as Permission[],
      }),
    );
    expect(() =>
      guard.canActivate(contextWith(principal("platform_operator"))),
    ).toThrow(ForbiddenError);
  });
});
