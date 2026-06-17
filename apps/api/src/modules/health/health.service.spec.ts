/**
 * Unit tests for the database indicator + HealthService (STANDARDS §14).
 * Derived from health.feature. Prisma clients are stubbed — the real DB ping is
 * covered transitively by the app booting against Postgres elsewhere.
 */
import { checkDatabase, type Pingable } from "./database.health-indicator";
import { HealthService } from "./health.service";

function pingable(impl: () => Promise<unknown>): Pingable {
  return { $queryRawUnsafe: impl };
}

describe("checkDatabase [STD-14]", () => {
  it("reports up when SELECT 1 resolves", async () => {
    const check = await checkDatabase(
      "database",
      pingable(() => Promise.resolve([{ "?column?": 1 }])),
    );
    expect(check).toEqual({ name: "database", status: "up" });
  });

  it("reports down (and never throws) when SELECT 1 rejects", async () => {
    const check = await checkDatabase(
      "database",
      pingable(() => Promise.reject(new Error("ECONNREFUSED"))),
    );
    expect(check).toEqual({ name: "database", status: "down" });
  });
});

describe("HealthService [STD-14]", () => {
  function make(appOk: boolean, platformOk: boolean) {
    const ping = (ok: boolean): Pingable =>
      pingable(() =>
        ok ? Promise.resolve(1) : Promise.reject(new Error("down")),
      );
    const service = new HealthService(
      ping(appOk) as never,
      ping(platformOk) as never,
    );
    return service;
  }

  it("liveness is always ok and touches no dependency", () => {
    const service = make(false, false); // even with DBs down
    expect(service.liveness()).toEqual({ status: "ok" });
  });

  it("readiness is ready when both connections are up", async () => {
    const result = await make(true, true).readiness();
    expect(result.ready).toBe(true);
    expect(result.checks).toEqual([
      { name: "database", status: "up" },
      { name: "platformDatabase", status: "up" },
    ]);
  });

  it("readiness is NOT ready when the app_user connection is down", async () => {
    const result = await make(false, true).readiness();
    expect(result.ready).toBe(false);
    expect(result.checks).toContainEqual({ name: "database", status: "down" });
  });

  it("readiness is NOT ready when the service_role connection is down", async () => {
    const result = await make(true, false).readiness();
    expect(result.ready).toBe(false);
    expect(result.checks).toContainEqual({
      name: "platformDatabase",
      status: "down",
    });
  });
});
