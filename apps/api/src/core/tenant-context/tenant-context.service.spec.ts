import type { ClientId, Permission, TenantId, UserId } from "@probooks/shared";

import { TenantContext } from "./tenant-context";
import { NoTenantContextError } from "./tenant-context.errors";
import { TenantContextService } from "./tenant-context.service";

function firmContext(tenantId: string): TenantContext {
  return {
    tenantId: tenantId as TenantId,
    userId: "user-1" as UserId,
    userRole: "firm_admin",
    permissions: new Set<Permission>(),
  };
}

function clientContext(tenantId: string, clientId: string): TenantContext {
  return {
    tenantId: tenantId as TenantId,
    userId: "user-2" as UserId,
    userRole: "client_owner",
    clientId: clientId as ClientId,
    permissions: new Set<Permission>(),
  };
}

describe("TenantContextService [STD-9.2][STD-9.3][INV-TEN-1]", () => {
  let service: TenantContextService;

  beforeEach(() => {
    service = new TenantContextService();
  });

  it("require() returns the seeded context inside runWithContext", () => {
    const ctx = firmContext("tenant-A");

    const seen = service.runWithContext(ctx, () => service.require());

    expect(seen.tenantId).toBe("tenant-A");
    expect(seen.userRole).toBe("firm_admin");
  });

  it("require() throws NoTenantContextError when unseeded (fail-closed)", () => {
    expect(() => service.require()).toThrow(NoTenantContextError);
  });

  it("get() returns undefined when unseeded, the context when seeded", () => {
    expect(service.get()).toBeUndefined();
    const ctx = firmContext("tenant-A");
    const seen = service.runWithContext(ctx, () => service.get());
    expect(seen?.tenantId).toBe("tenant-A");
  });

  it("does not leak context across concurrent async call trees", async () => {
    const results = await Promise.all([
      new Promise<string>((resolve) => {
        service.runWithContext(firmContext("tenant-A"), () => {
          setTimeout(() => resolve(service.require().tenantId), 10);
        });
      }),
      new Promise<string>((resolve) => {
        service.runWithContext(firmContext("tenant-B"), () => {
          setTimeout(() => resolve(service.require().tenantId), 5);
        });
      }),
    ]);

    expect(results).toContain("tenant-A");
    expect(results).toContain("tenant-B");
  });

  it("exposes clientId for a client principal, absent for a firm principal", () => {
    const clientSeen = service.runWithContext(
      clientContext("tenant-A", "client-9"),
      () => service.require(),
    );
    const firmSeen = service.runWithContext(firmContext("tenant-A"), () =>
      service.require(),
    );

    expect(clientSeen.clientId).toBe("client-9");
    expect(firmSeen.clientId).toBeUndefined();
  });

  it("NoTenantContextError maps to 401 with a stable code", () => {
    const error = new NoTenantContextError();
    expect(error.httpStatus).toBe(401);
    expect(error.code).toBe("NO_TENANT_CONTEXT");
  });
});
