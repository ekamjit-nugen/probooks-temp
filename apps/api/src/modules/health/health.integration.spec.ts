/**
 * Health endpoints integration (STANDARDS §14, §19.3). Boots a real Nest app
 * with the HealthController + a global DomainExceptionFilter (ErrorsModule), and
 * drives it with supertest. Prisma clients are stubbed so we control up/down
 * without a container — the routing, status codes, and 503 envelope are what we
 * prove here. No tenant context, no auth: the routes are unguarded.
 */
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";

import { ErrorsModule } from "../../core/errors/errors.module";
import { PlatformPrismaService } from "../../core/prisma/platform-prisma.service";
import { PrismaService } from "../../core/prisma/prisma.service";

import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

describe("Health endpoints [STD-14]", () => {
  let app: INestApplication;
  let appDbUp = true;
  let platformDbUp = true;

  beforeAll(async () => {
    const appStub = {
      $queryRawUnsafe: jest.fn(() =>
        appDbUp ? Promise.resolve(1) : Promise.reject(new Error("down")),
      ),
    };
    const platformStub = {
      $queryRawUnsafe: jest.fn(() =>
        platformDbUp ? Promise.resolve(1) : Promise.reject(new Error("down")),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [ErrorsModule],
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: PrismaService, useValue: appStub },
        { provide: PlatformPrismaService, useValue: platformStub },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    appDbUp = true;
    platformDbUp = true;
  });

  function http(): ReturnType<typeof request> {
    return request(app.getHttpServer() as App);
  }

  it("GET /health/live → 200 ok (no auth, no DB)", async () => {
    const res = await http().get("/health/live").expect(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /health/ready → 200 ok when both connections are up", async () => {
    const res = await http().get("/health/ready").expect(200);
    expect((res.body as { status: string }).status).toBe("ok");
    expect((res.body as { checks: unknown[] }).checks).toEqual([
      { name: "database", status: "up" },
      { name: "platformDatabase", status: "up" },
    ]);
  });

  it("GET /health/ready → 503 SERVICE_NOT_READY when a dependency is down", async () => {
    appDbUp = false;
    const res = await http().get("/health/ready").expect(503);
    const body = res.body as {
      error: {
        code: string;
        details: { checks: { name: string; status: string }[] };
      };
    };
    expect(body.error.code).toBe("SERVICE_NOT_READY");
    expect(body.error.details.checks).toContainEqual({
      name: "database",
      status: "down",
    });
  });

  it("health routes require no Authorization header (unguarded)", async () => {
    // No bearer token set — neither 401 nor 403.
    await http().get("/health/live").expect(200);
    await http().get("/health/ready").expect(200);
  });
});
