import { ConfigValidationError, parseEnv } from "./env.schema";

describe("parseEnv [STD-17][STD-3]", () => {
  const base = { NODE_ENV: "test", PORT: "3000", LOG_LEVEL: "info" };

  it("returns a typed AppConfig for a valid environment", () => {
    const cfg = parseEnv(base);

    expect(cfg.nodeEnv).toBe("test");
    expect(cfg.port).toBe(3000);
    expect(cfg.logLevel).toBe("info");
  });

  it("coerces PORT to a number", () => {
    const cfg = parseEnv({ ...base, PORT: "8080" });

    expect(cfg.port).toBe(8080);
    expect(typeof cfg.port).toBe("number");
  });

  it("applies defaults for omitted optional variables", () => {
    const cfg = parseEnv({ NODE_ENV: "development" });

    expect(cfg.port).toBe(3000);
    expect(cfg.logLevel).toBe("info");
  });

  it("fails fast with an aggregated error naming every offending variable", () => {
    let thrown: unknown;
    try {
      parseEnv({
        NODE_ENV: "not-an-env",
        PORT: "not-a-number",
        LOG_LEVEL: "loud",
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ConfigValidationError);
    const message = (thrown as ConfigValidationError).message;
    expect(message).toContain("NODE_ENV");
    expect(message).toContain("PORT");
    expect(message).toContain("LOG_LEVEL");
  });

  it("rejects an unparseable PORT", () => {
    expect(() => parseEnv({ ...base, PORT: "abc" })).toThrow(
      ConfigValidationError,
    );
  });

  it("parses the two DB connection strings when present [STD-8.4][STD-9.6]", () => {
    const cfg = parseEnv({
      ...base,
      DATABASE_URL: "postgresql://app_user:pw@localhost:5432/probooks",
      DATABASE_SERVICE_ROLE_URL:
        "postgresql://service_role:pw@localhost:5432/probooks",
    });

    expect(cfg.databaseUrl).toBe(
      "postgresql://app_user:pw@localhost:5432/probooks",
    );
    expect(cfg.databaseServiceRoleUrl).toBe(
      "postgresql://service_role:pw@localhost:5432/probooks",
    );
  });

  it("leaves DB URLs undefined when omitted (resolved fail-fast at use)", () => {
    const cfg = parseEnv(base);

    expect(cfg.databaseUrl).toBeUndefined();
    expect(cfg.databaseServiceRoleUrl).toBeUndefined();
  });

  it("rejects a malformed DATABASE_URL", () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: "not a url" })).toThrow(
      ConfigValidationError,
    );
  });

  it("defaults the JWT TTLs to the §10.1 values and leaves the secret undefined", () => {
    const cfg = parseEnv(base);

    expect(cfg.jwtAccessTtlSeconds).toBe(900);
    expect(cfg.jwtRefreshTtlSeconds).toBe(28_800);
    expect(cfg.jwtSecret).toBeUndefined();
  });

  it("parses a JWT_SECRET of adequate length and coerces TTLs [ADR-0005]", () => {
    const cfg = parseEnv({
      ...base,
      JWT_SECRET: "x".repeat(32),
      JWT_ACCESS_TTL_SECONDS: "600",
      JWT_REFRESH_TTL_SECONDS: "3600",
    });

    expect(cfg.jwtSecret).toBe("x".repeat(32));
    expect(cfg.jwtAccessTtlSeconds).toBe(600);
    expect(cfg.jwtRefreshTtlSeconds).toBe(3600);
  });

  it("rejects a JWT_SECRET shorter than 32 chars (HS256 keying floor)", () => {
    expect(() => parseEnv({ ...base, JWT_SECRET: "tooshort" })).toThrow(
      ConfigValidationError,
    );
  });
});
