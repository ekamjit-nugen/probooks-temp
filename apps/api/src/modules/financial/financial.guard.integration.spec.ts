/**
 * Financial guard-layer integration (STANDARDS §10.2; INV-TEN-3 guard half).
 * Boots the real guard stack over FinancialController with the FinancialService
 * STUBBED (no DB) — this isolates the AUTHORIZATION decision: the Platform
 * Operator is denied `financial:read` and gets 403 before any handler/DB access,
 * while a firm_admin holding the capability reaches the handler. The RLS half of
 * INV-TEN-3 (zero rows) is proven in platform.e2e.spec.ts.
 */
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { UserRole } from "@probooks/shared";
import request from "supertest";
import type { App } from "supertest/types";

import { AuthModule } from "../../core/auth/auth.module";
import { HmacTokenService } from "../../core/auth/hmac-token.service";
import type { AccessSubject } from "../../core/auth/token-contract";
import { AppConfigService } from "../../core/config-env/app-config.service";
import { ConfigEnvModule } from "../../core/config-env/config-env.module";
import { ErrorsModule } from "../../core/errors/errors.module";
import { PlatformPrismaService } from "../../core/prisma/platform-prisma.service";
import { PrismaService } from "../../core/prisma/prisma.service";
import { RbacModule } from "../../core/rbac/rbac.module";
import { TenancyGuardModule } from "../../core/tenancy-guard/tenancy-guard.module";
import { TenantContextInterceptor } from "../../core/tenant-context/tenant-context.interceptor";
import { TenantContextModule } from "../../core/tenant-context/tenant-context.module";

import { FinancialController } from "./financial.controller";
import { FinancialService } from "./financial.service";

const SECRET = "financial-guard-integration-secret-32ch!!";
const TENANT_A = "11111111-1111-7111-8111-111111111111";
const CLIENT_OWN = "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa";

describe("Financial guard layer [STD-10.2][INV-TEN-3]", () => {
  let app: INestApplication;
  let signer: HmacTokenService;

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    process.env["JWT_SECRET"] = SECRET;

    const prismaStub = { onModuleInit: jest.fn(), onModuleDestroy: jest.fn() };
    // Handler must never touch the DB for the operator (403 first); for the firm
    // path we stub the service so the test stays DB-free.
    const serviceStub = { listSummaries: jest.fn(() => Promise.resolve([])) };

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigEnvModule,
        ErrorsModule,
        TenantContextModule,
        AuthModule,
        RbacModule,
        TenancyGuardModule,
      ],
      controllers: [FinancialController],
      providers: [{ provide: FinancialService, useValue: serviceStub }],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(PlatformPrismaService)
      .useValue(prismaStub)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(app.get(TenantContextInterceptor));
    await app.init();
    signer = new HmacTokenService(app.get(AppConfigService));
  });

  afterAll(async () => {
    await app?.close();
    delete process.env["JWT_SECRET"];
  });

  function auth(role: UserRole): string {
    const base: AccessSubject = {
      tenantId: TENANT_A,
      userId: "22222222-2222-7222-8222-222222222222",
      role,
    };
    const subject =
      role === "client_owner" || role === "client_staff"
        ? { ...base, clientId: CLIENT_OWN }
        : base;
    return `Bearer ${signer.signAccessToken(subject)}`;
  }

  function http(): ReturnType<typeof request> {
    return request(app.getHttpServer() as App);
  }

  it("[INV-TEN-3] the Platform Operator is DENIED /v1/financial/summaries (403)", async () => {
    await http()
      .get("/v1/financial/summaries")
      .set("authorization", auth("platform_operator"))
      .expect(403);
  });

  it("a firm_admin holding financial:read reaches the handler (200)", async () => {
    const res = await http()
      .get("/v1/financial/summaries")
      .set("authorization", auth("firm_admin"))
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it("an accountant (financial:read for their clients) also reaches the handler", async () => {
    await http()
      .get("/v1/financial/summaries")
      .set("authorization", auth("accountant"))
      .expect(200);
  });

  it("rejects an unauthenticated request with 401", async () => {
    await http().get("/v1/financial/summaries").expect(401);
  });
});
