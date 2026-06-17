/**
 * Unit tests for IdempotencyInterceptor activation gates (STANDARDS §7.4).
 * Derived from the interceptor scenarios in idempotency.feature. The full
 * replay/claim/complete flow over a real DB is proven in idempotency.e2e.spec.ts
 * (the integration suite); here we cover the pure gates that need no datastore.
 */
import { Reflector } from "@nestjs/core";
import { lastValueFrom, of, type Observable } from "rxjs";

import type { TenantContext } from "../../core/tenant-context/tenant-context";
import { TenantContextService } from "../../core/tenant-context/tenant-context.service";

import { IDEMPOTENT_METADATA_KEY } from "./idempotency.decorator";
import { IdempotencyKeyMalformedError } from "./idempotency.errors";
import { IdempotencyInterceptor } from "./idempotency.interceptor";
import { IdempotencyService } from "./idempotency.service";

interface FakeReq {
  method: string;
  headers: Record<string, string | undefined>;
  body?: unknown;
  url?: string;
}

function ctxFor(req: FakeReq, idempotent: boolean) {
  const reflector = new Reflector();
  jest
    .spyOn(reflector, "getAllAndOverride")
    .mockImplementation((key: unknown) =>
      key === IDEMPOTENT_METADATA_KEY ? idempotent : undefined,
    );
  const handler = () => undefined;
  const executionContext = {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: <T>() => req as T,
      getResponse: <T>() => ({ statusCode: 200, status: jest.fn() }) as T,
    }),
  };
  return { reflector, executionContext };
}

describe("IdempotencyInterceptor gates [STD-7.4]", () => {
  const tenant = new TenantContextService();
  const seeded: TenantContext = {
    tenantId:
      "11111111-1111-7111-8111-111111111111" as TenantContext["tenantId"],
    userId: "22222222-2222-7222-8222-222222222222" as TenantContext["userId"],
    userRole: "firm_admin",
    permissions: new Set(),
  };

  function service() {
    const begin = jest.fn();
    const complete = jest.fn();
    const release = jest.fn();
    const svc = { begin, complete, release } as unknown as IdempotencyService;
    return { begin, complete, release, svc };
  }

  async function run(obs: Observable<unknown>): Promise<unknown> {
    return lastValueFrom(obs);
  }

  it("passes through when the route is NOT @Idempotent", async () => {
    const { begin, svc } = service();
    const { reflector, executionContext } = ctxFor(
      { method: "POST", headers: { "idempotency-key": "x" } },
      false,
    );
    const interceptor = new IdempotencyInterceptor(reflector, svc, tenant);
    const next = { handle: jest.fn(() => of("handler-ran")) };

    const result = await run(
      interceptor.intercept(executionContext as never, next as never),
    );

    expect(result).toBe("handler-ran");
    expect(begin).not.toHaveBeenCalled();
    expect(next.handle).toHaveBeenCalledTimes(1);
  });

  it("passes through for a non-POST method even when @Idempotent", async () => {
    const { begin, svc } = service();
    const { reflector, executionContext } = ctxFor(
      { method: "GET", headers: { "idempotency-key": "x" } },
      true,
    );
    const interceptor = new IdempotencyInterceptor(reflector, svc, tenant);
    const next = { handle: jest.fn(() => of("get-ran")) };

    const result = await run(
      interceptor.intercept(executionContext as never, next as never),
    );

    expect(result).toBe("get-ran");
    expect(begin).not.toHaveBeenCalled();
  });

  it("passes through when no Idempotency-Key header is present (header optional)", async () => {
    const { begin, svc } = service();
    const { reflector, executionContext } = ctxFor(
      { method: "POST", headers: {} },
      true,
    );
    const interceptor = new IdempotencyInterceptor(reflector, svc, tenant);
    const next = { handle: jest.fn(() => of("no-key-ran")) };

    const result = await run(
      interceptor.intercept(executionContext as never, next as never),
    );

    expect(result).toBe("no-key-ran");
    expect(begin).not.toHaveBeenCalled();
  });

  it("throws 400 when the Idempotency-Key is not a UUID", () => {
    const { svc } = service();
    const { reflector, executionContext } = ctxFor(
      { method: "POST", headers: { "idempotency-key": "not-a-uuid" } },
      true,
    );
    const interceptor = new IdempotencyInterceptor(reflector, svc, tenant);
    const next = { handle: jest.fn(() => of("should-not-run")) };

    expect(() =>
      tenant.runWithContext(seeded, () =>
        interceptor.intercept(executionContext as never, next as never),
      ),
    ).toThrow(IdempotencyKeyMalformedError);
    expect(next.handle).not.toHaveBeenCalled();
  });
});
