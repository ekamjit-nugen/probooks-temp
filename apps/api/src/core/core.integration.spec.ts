import type { Server } from "node:http";
import { Writable } from "node:stream";

import {
  Body,
  Controller,
  Get,
  Module,
  Post,
  UsePipes,
  type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { ErrorEnvelope } from "@probooks/shared";
import pino from "pino";
import request from "supertest";
import { z } from "zod";

import { ConfigEnvModule } from "./config-env/config-env.module";
import { DomainExceptionFilter } from "./errors/domain-exception.filter";
import { ERROR_REPORTER, type ErrorReporter } from "./errors/error-reporter";
import { ErrorsModule } from "./errors/errors.module";
import { FlagAlreadyClearedError } from "./errors/example-errors";
import { buildPinoOptions } from "./logging/logger.factory";
import { ZodValidationPipe } from "./validation/zod-validation.pipe";

const CreateThingSchema = z
  .object({ name: z.string().min(1), age: z.number().min(0) })
  .strict();
type CreateThing = z.infer<typeof CreateThingSchema>;

@Controller("things")
class ThingsController {
  @Post()
  @UsePipes(new ZodValidationPipe<CreateThing>(CreateThingSchema))
  create(@Body() body: CreateThing): { data: CreateThing } {
    return { data: body };
  }

  @Get("conflict")
  conflict(): never {
    throw new FlagAlreadyClearedError("flag-integration");
  }

  @Get("boom")
  boom(): never {
    throw new Error("/internal/secret/path exploded");
  }
}

@Module({
  imports: [ConfigEnvModule, ErrorsModule],
  controllers: [ThingsController],
})
class IntegrationTestModule {}

/** Counts reporter calls without tripping unbound-method lint. */
function makeReporter(): { reporter: ErrorReporter; calls: () => unknown[] } {
  const received: unknown[] = [];
  return {
    reporter: { report: (error: unknown): void => void received.push(error) },
    calls: () => received,
  };
}

interface SuccessBody {
  data: CreateThing;
}

describe("core foundation integration [STD-7.1][STD-11][STD-12][STD-13]", () => {
  let app: INestApplication;
  let server: Server;
  const { reporter, calls } = makeReporter();

  beforeAll(async () => {
    process.env["NODE_ENV"] = "test";
    const moduleRef = await Test.createTestingModule({
      imports: [IntegrationTestModule],
    })
      .overrideProvider(ERROR_REPORTER)
      .useValue(reporter)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(app.get(DomainExceptionFilter));
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it("bad input → 400 VALIDATION_FAILED envelope with requestId", async () => {
    const res = await request(server).post("/things").send({ age: -1 });
    const body = res.body as ErrorEnvelope;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details).toHaveProperty("name");
    expect(body.error.details).toHaveProperty("age");
    expect(typeof body.error.requestId).toBe("string");
    expect(body.error.requestId.length).toBeGreaterThan(0);
  });

  it("valid input passes the pipe and returns the parsed value", async () => {
    const res = await request(server)
      .post("/things")
      .send({ name: "Ada", age: 30 });
    const body = res.body as SuccessBody;

    expect(res.status).toBe(201);
    expect(body.data).toEqual({ name: "Ada", age: 30 });
  });

  it("thrown DomainError → its status + code envelope", async () => {
    const res = await request(server).get("/things/conflict");
    const body = res.body as ErrorEnvelope;

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("FLAG_ALREADY_CLEARED");
    expect(body.error.requestId).toBeDefined();
    expect(calls()).toHaveLength(0);
  });

  it("unknown error → sanitized 500, no stack/path leak, reporter invoked", async () => {
    const res = await request(server).get("/things/boom");
    const body = res.body as ErrorEnvelope;

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("/internal/secret/path");
    expect(serialized).not.toContain("stack");
    expect(calls()).toHaveLength(1);
  });

  it("logger redacts email and business number in a composed payload", () => {
    let buffer = "";
    const sink = new Writable({
      write(chunk: Buffer | string, _enc, cb): void {
        buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        cb();
      },
    });
    const logger = pino(
      buildPinoOptions({ nodeEnv: "test", logLevel: "info" }),
      sink,
    );

    logger.info(
      { email: "client@example.com", businessNumber: "123456789RT0001" },
      "audit event",
    );

    expect(buffer).toContain("[REDACTED]");
    expect(buffer).not.toContain("client@example.com");
    expect(buffer).not.toContain("123456789RT0001");
  });
});
