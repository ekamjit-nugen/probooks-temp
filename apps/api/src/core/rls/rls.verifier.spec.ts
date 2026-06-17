import {
  findRlsViolations,
  RlsPostureError,
  TENANT_SCOPED_TABLES,
  verifyRlsEnabled,
  type RlsQueryClient,
} from "./rls.verifier";

interface FakeRow {
  relname: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
}

function clientReturning(rows: FakeRow[]): RlsQueryClient {
  return {
    $queryRawUnsafe: <T>(): Promise<T> => Promise.resolve(rows as unknown as T),
  };
}

describe("RLS verifier [STD-8.4][INV-TEN-1]", () => {
  it("reports no violations when every table is enabled AND forced", async () => {
    const rows = TENANT_SCOPED_TABLES.map((relname) => ({
      relname,
      relrowsecurity: true,
      relforcerowsecurity: true,
    }));

    const violations = await findRlsViolations(clientReturning(rows));

    expect(violations).toHaveLength(0);
  });

  it("flags a table that is enabled but NOT forced (owner would leak)", async () => {
    const rows = TENANT_SCOPED_TABLES.map((relname) => ({
      relname,
      relrowsecurity: true,
      relforcerowsecurity: relname !== "audit_log",
    }));

    const violations = await findRlsViolations(clientReturning(rows));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.table).toBe("audit_log");
    expect(violations[0]?.forced).toBe(false);
  });

  it("flags a table entirely missing from pg_class", async () => {
    const violations = await findRlsViolations(clientReturning([]), ["users"]);

    expect(violations).toEqual([
      { table: "users", rowSecurityEnabled: false, forced: false },
    ]);
  });

  it("verifyRlsEnabled throws RlsPostureError listing violations", async () => {
    const client = clientReturning([
      { relname: "users", relrowsecurity: true, relforcerowsecurity: false },
    ]);

    await expect(verifyRlsEnabled(client, ["users"])).rejects.toBeInstanceOf(
      RlsPostureError,
    );
  });

  it("verifyRlsEnabled resolves when posture is correct", async () => {
    const client = clientReturning([
      { relname: "users", relrowsecurity: true, relforcerowsecurity: true },
    ]);

    await expect(verifyRlsEnabled(client, ["users"])).resolves.toBeUndefined();
  });
});
