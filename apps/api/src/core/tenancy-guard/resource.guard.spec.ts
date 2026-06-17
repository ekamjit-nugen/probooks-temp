/**
 * ResourceGuard unit tests (STANDARDS §10.2 step 4; INV-TEN-2). The own-client
 * example: a client principal may act only on its own client; a mismatch is a
 * 404 (never leak another scope's existence). No @RequireResource → pass-through.
 */
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  permissionsForRole,
  type ClientId,
  type TenantId,
  type UserId,
  type UserRole,
} from "@probooks/shared";

import { ResourceNotFoundError } from "../auth/auth.errors";
import { type ResourceRule } from "../rbac/rbac.decorators";
import type { PrincipalClaim } from "../tenant-context/tenant-context.interceptor";

import { CLIENT_ID_PARAM, ResourceGuard } from "./resource.guard";

const TENANT = "11111111-1111-7111-8111-111111111111";
const OWN_CLIENT = "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa";

function principal(role: UserRole, clientId?: string): PrincipalClaim {
  const base = {
    tenantId: TENANT as TenantId,
    userId: "22222222-2222-7222-8222-222222222222" as UserId,
    userRole: role,
    permissions: permissionsForRole(role),
  };
  return clientId !== undefined
    ? { ...base, clientId: clientId as ClientId }
    : base;
}

function contextWith(
  params: Record<string, string | undefined>,
  claim: PrincipalClaim,
  rule: ResourceRule | undefined,
): { context: ExecutionContext; reflector: Reflector } {
  const reflector = new Reflector();
  jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(rule as never);
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ principalClaim: claim, params }),
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => (): void => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
  return { context, reflector };
}

const OWN_CLIENT_RULE: ResourceRule = { kind: "client", scope: "own-client" };

describe("ResourceGuard [STD-10.2][INV-TEN-2]", () => {
  it("passes through when no @RequireResource is set", () => {
    const { context, reflector } = contextWith(
      {},
      principal("client_owner", OWN_CLIENT),
      undefined,
    );
    expect(new ResourceGuard(reflector).canActivate(context)).toBe(true);
  });

  it("allows a client acting on their OWN client", () => {
    const { context, reflector } = contextWith(
      { [CLIENT_ID_PARAM]: OWN_CLIENT },
      principal("client_owner", OWN_CLIENT),
      OWN_CLIENT_RULE,
    );
    expect(new ResourceGuard(reflector).canActivate(context)).toBe(true);
  });

  it("[INV-TEN-2] returns 404 when a client targets another client", () => {
    const { context, reflector } = contextWith(
      { [CLIENT_ID_PARAM]: "bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb" },
      principal("client_owner", OWN_CLIENT),
      OWN_CLIENT_RULE,
    );
    expect(() => new ResourceGuard(reflector).canActivate(context)).toThrow(
      ResourceNotFoundError,
    );
  });

  it("does not constrain a firm role (no clientId binding) under own-client", () => {
    const { context, reflector } = contextWith(
      { [CLIENT_ID_PARAM]: OWN_CLIENT },
      principal("accountant"),
      OWN_CLIENT_RULE,
    );
    expect(new ResourceGuard(reflector).canActivate(context)).toBe(true);
  });
});
