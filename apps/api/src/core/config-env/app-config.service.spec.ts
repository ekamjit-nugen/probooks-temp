import { Test } from "@nestjs/testing";

import { AppConfigService, MissingConfigError } from "./app-config.service";
import { ConfigEnvModule } from "./config-env.module";

describe("AppConfigService [STD-17]", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it("exposes a validated, typed AppConfig via DI", async () => {
    process.env["NODE_ENV"] = "test";
    process.env["PORT"] = "4001";
    process.env["LOG_LEVEL"] = "debug";

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigEnvModule],
    }).compile();

    const config = moduleRef.get(AppConfigService);

    expect(config.get("port")).toBe(4001);
    expect(config.get("logLevel")).toBe("debug");
    expect(config.all.nodeEnv).toBe("test");

    await moduleRef.close();
  });

  it("getRequired throws MissingConfigError when an optional value is absent", () => {
    const service = new AppConfigService({
      nodeEnv: "test",
      port: 3000,
      logLevel: "info",
      databaseUrl: undefined,
      databaseServiceRoleUrl: undefined,
      jwtSecret: undefined,
      jwtAccessTtlSeconds: 900,
      jwtRefreshTtlSeconds: 28_800,
    });

    expect(() => service.getRequired("databaseUrl")).toThrow(
      MissingConfigError,
    );
  });

  it("getRequired returns the value when present", () => {
    const url = "postgresql://app_user:pw@localhost:5432/probooks";
    const service = new AppConfigService({
      nodeEnv: "test",
      port: 3000,
      logLevel: "info",
      databaseUrl: url,
      databaseServiceRoleUrl: undefined,
      jwtSecret: undefined,
      jwtAccessTtlSeconds: 900,
      jwtRefreshTtlSeconds: 28_800,
    });

    expect(service.getRequired("databaseUrl")).toBe(url);
  });
});
