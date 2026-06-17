/**
 * Full guard-stack integration over a representative controller (STANDARDS
 * §10.2; §19.3 #3 cross-tenant-404, #4 RBAC matrix; INV-AUTH-4, INV-TEN-2/3,
 * INV-RBAC-1).
 *
 * Builds a real Nest app with AuthGuard → TenantGuard → RoleGuard →
 * ResourceGuard applied (GUARD_STACK), drives it with supertest, and proves:
 *  - RBAC matrix: each of the 5 roles hits guarded routes; only §4.17-permitted
 *    roles pass, others 403.
 *  - Cross-tenant path → 404 (NOT 403); same-tenant role denial → 403.
 *  - Unauthenticated → 401; deny-by-default unannotated route → 403.
 *  - TenantContext is seeded from the VERIFIED token (body tenantId ignored).
 * No DB: the guards operate on token + path; the handler reads ALS only.
 */
import {
  Controller,
  Get,
  Module,
  Param,
  UseGuards,
  type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { UserRole } from "@probooks/shared";
import request from "supertest";
import type { App } from "supertest/types";

import { AppConfigService } from "../config-env/app-config.service";
import { ConfigEnvModule } from "../config-env/config-env.module";
import { ErrorsModule } from "../errors/errors.module";
import { PlatformPrismaService } from "../prisma/platform-prisma.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  RequirePermission,
  RequireResource,
  RequireRole,
} from "../rbac/rbac.decorators";
import { RbacModule } from "../rbac/rbac.module";
import { GUARD_STACK } from "../tenancy-guard/guard-stack";
import { TenancyGuardModule } from "../tenancy-guard/tenancy-guard.module";
import { TenantContextInterceptor } from "../tenant-context/tenant-context.interceptor";
import { TenantContextModule } from "../tenant-context/tenant-context.module";
import { TenantContextService } from "../tenant-context/tenant-context.service";

import { AuthModule } from "./auth.module";
import { HmacTokenService } from "./hmac-token.service";
import type { AccessSubject } from "./token-contract";

const SECRET = "guard-stack-integration-secret-32-chars!!";
const TENANT_A = "11111111-1111-7111-8111-111111111111";
const TENANT_B = "99999999-9999-7999-8999-999999999999";
const CLIENT_OWN = "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_OTHER = "bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb";

/**
 * A representative controller scoped under /v1/firms/:firmId. Each route is
 * guarded by a §4.17 capability so the matrix test can assert role outcomes.
 */
@Controller("v1/firms/:firmId")
@UseGuards(...GUARD_STACK)
class ProbeController {
  constructor(private readonly tenant: TenantContextService) {}

  /** Guarded by a firm-only permission: edit firm settings (firm_admin only). */
  @Get("settings")
  @RequirePermission("firm_settings:edit")
  settings(): { ok: true } {
    return { ok: true };
  }

  /** mark-complete: accountant only (§4.17 period:mark_complete). */
  @Get("mark-complete")
  @RequirePermission("period:mark_complete")
  markComplete(): { ok: true } {
    return { ok: true };
  }

  /** A plain authenticated ping (any role with @RequireRole of all 5). */
  @Get("ping")
  @RequireRole(
    "platform_operator",
    "firm_admin",
    "accountant",
    "client_owner",
    "client_staff",
  )
  ping(): { tenantId: string } {
    // Reads ALS seeded by the interceptor from the verified token.
    return { tenantId: this.tenant.require().tenantId };
  }

  /** A client own-client resource route. */
  @Get("clients/:clientId/home")
  @RequireRole("client_owner", "client_staff")
  @RequireResource({ kind: "client", scope: "own-client" })
  clientHome(@Param("clientId") clientId: string): { clientId: string } {
    return { clientId };
  }

  /** Deny-by-default: no @RequireRole/@RequirePermission/@Public. */
  @Get("unannotated")
  unannotated(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [
    ConfigEnvModule,
    ErrorsModule,
    TenantContextModule,
    AuthModule,
    RbacModule,
    TenancyGuardModule,
  ],
  controllers: [ProbeController],
})
class ProbeTestModule {}

const ROLES: readonly UserRole[] = [
  "platform_operator",
  "firm_admin",
  "accountant",
  "client_owner",
  "client_staff",
];

describe("Guard stack integration [STD-10.2][INV-AUTH-4][INV-TEN-2][INV-RBAC-1]", () => {
  let app: INestApplication;
  let signer: HmacTokenService;

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    process.env["JWT_SECRET"] = SECRET;

    // The guard stack never touches the DB; stub both Prisma clients so the app
    // boots without a live Postgres (their constructors otherwise require DB URLs
    // and onModuleInit would $connect).
    const prismaStub = { onModuleInit: jest.fn(), onModuleDestroy: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      imports: [ProbeTestModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(PlatformPrismaService)
      .useValue(prismaStub)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(app.get(TenantContextInterceptor));
    await app.init();

    const config = app.get(AppConfigService);
    signer = new HmacTokenService(config);
  });

  afterAll(async () => {
    await app?.close();
    delete process.env["JWT_SECRET"];
  });

  function tokenFor(role: UserRole, tenantId = TENANT_A): string {
    const base: AccessSubject = {
      tenantId,
      userId: "22222222-2222-7222-8222-222222222222",
      role,
    };
    const subject =
      role === "client_owner" || role === "client_staff"
        ? { ...base, clientId: CLIENT_OWN }
        : base;
    return signer.signAccessToken(subject);
  }

  function auth(role: UserRole, tenantId = TENANT_A): string {
    return `Bearer ${tokenFor(role, tenantId)}`;
  }

  /** Typed supertest agent (avoids `any` from app.getHttpServer()). */
  function http(): ReturnType<typeof request> {
    return request(app.getHttpServer() as App);
  }

  it("returns 401 when no Bearer token is presented", async () => {
    await http().get(`/v1/firms/${TENANT_A}/ping`).expect(401);
  });

  it("[deny-by-default] an unannotated guarded route is 403", async () => {
    await http()
      .get(`/v1/firms/${TENANT_A}/unannotated`)
      .set("authorization", auth("firm_admin"))
      .expect(403);
  });

  it("seeds TenantContext from the VERIFIED token, ignoring the body tenantId", async () => {
    const res = await http()
      .get(`/v1/firms/${TENANT_A}/ping`)
      .set("authorization", auth("firm_admin"))
      .send({ tenantId: "deadbeef-dead-7ead-8ead-deaddeaddead" })
      .expect(200);
    expect((res.body as { tenantId: string }).tenantId).toBe(TENANT_A);
  });

  describe("[INV-TEN-2] cross-tenant probe → 404, not 403", () => {
    it("user of tenant A hitting /v1/firms/<tenantB>/ping → 404", async () => {
      await http()
        .get(`/v1/firms/${TENANT_B}/ping`)
        .set("authorization", auth("firm_admin", TENANT_A))
        .expect(404);
    });

    it("same-tenant role denial on the same controller → 403 (not 404)", async () => {
      // client_owner is NOT permitted firm_settings:edit (§4.17) — same tenant.
      await http()
        .get(`/v1/firms/${TENANT_A}/settings`)
        .set("authorization", auth("client_owner", TENANT_A))
        .expect(403);
    });
  });

  describe("[INV-RBAC-1] RBAC matrix — every role × representative routes", () => {
    // Expected per SPEC §4.17.
    const matrix: ReadonlyArray<{
      path: string;
      allowed: ReadonlySet<UserRole>;
    }> = [
      {
        path: "settings", // firm_settings:edit → firm_admin only
        allowed: new Set<UserRole>(["firm_admin"]),
      },
      {
        path: "mark-complete", // period:mark_complete → accountant only
        allowed: new Set<UserRole>(["accountant"]),
      },
    ];

    for (const route of matrix) {
      for (const role of ROLES) {
        const expectAllowed = route.allowed.has(role);
        it(`${role} → /${route.path} : ${expectAllowed ? "2xx" : "403"}`, async () => {
          const res = await http()
            .get(`/v1/firms/${TENANT_A}/${route.path}`)
            .set("authorization", auth(role, TENANT_A));
          if (expectAllowed) {
            expect(res.status).toBe(200);
          } else {
            expect(res.status).toBe(403);
          }
        });
      }
    }
  });

  describe("[INV-TEN-2] ResourceGuard own-client", () => {
    it("client_owner on their OWN client → 200", async () => {
      const res = await http()
        .get(`/v1/firms/${TENANT_A}/clients/${CLIENT_OWN}/home`)
        .set("authorization", auth("client_owner", TENANT_A))
        .expect(200);
      expect((res.body as { clientId: string }).clientId).toBe(CLIENT_OWN);
    });

    it("client_owner on ANOTHER client → 404 (no existence leak)", async () => {
      await http()
        .get(`/v1/firms/${TENANT_A}/clients/${CLIENT_OTHER}/home`)
        .set("authorization", auth("client_owner", TENANT_A))
        .expect(404);
    });
  });
});
