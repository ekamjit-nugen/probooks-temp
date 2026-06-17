import { Test } from "@nestjs/testing";

import { AppModule } from "./app.module";

describe("AppModule (scaffold)", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it("compiles the root module", async () => {
    // PrismaService/PlatformPrismaService resolve their datasource URLs at DI
    // construction (fail-fast, §17). compile() instantiates them but does NOT
    // run onModuleInit ($connect), so well-formed URLs suffice — no live DB.
    process.env["NODE_ENV"] = "test";
    process.env["DATABASE_URL"] =
      "postgresql://app_user:pw@localhost:5432/probooks";
    process.env["DATABASE_SERVICE_ROLE_URL"] =
      "postgresql://service_role:pw@localhost:5432/probooks";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
