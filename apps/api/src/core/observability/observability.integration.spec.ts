/**
 * Observability integration (STANDARDS §13/§14, §19.3). A real Nest app with
 * ObservabilityModule (RequestIdMiddleware + global RedMetricsInterceptor) and
 * ErrorsModule (global DomainExceptionFilter). Proves the correlation id reaches
 * the §7.1 error envelope (closing the Wave-2 seam) and that RED metrics record.
 */
import { Controller, Get, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";

import { DomainError } from "../errors/domain-error";
import { ErrorsModule } from "../errors/errors.module";

import { InMemoryMetricsRecorder, METRICS_RECORDER } from "./metrics.recorder";
import { ObservabilityModule } from "./observability.module";

class TestBoomError extends DomainError {
  readonly code = "TEST_BOOM";
  readonly httpStatus = 400;
  constructor() {
    super("boom");
  }
}

@Controller()
class ProbeController {
  @Get("ok")
  ok(): { ok: true } {
    return { ok: true };
  }

  @Get("boom")
  boom(): never {
    throw new TestBoomError();
  }
}

describe("Observability integration [STD-13][STD-14]", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ObservabilityModule, ErrorsModule],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  function http(): ReturnType<typeof request> {
    return request(app.getHttpServer() as App);
  }

  it("echoes a safe incoming x-request-id and sets a traceparent", async () => {
    const res = await http()
      .get("/ok")
      .set("x-request-id", "req-abc")
      .expect(200);
    expect(res.headers["x-request-id"]).toBe("req-abc");
    expect(res.headers["traceparent"]).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/,
    );
  });

  it("[§7.1] flows the request id into the error envelope", async () => {
    const res = await http()
      .get("/boom")
      .set("x-request-id", "req-trace-me")
      .expect(400);
    const body = res.body as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("TEST_BOOM");
    expect(body.error.requestId).toBe("req-trace-me");
  });

  it("generates a request id when none is supplied", async () => {
    const res = await http().get("/ok").expect(200);
    expect(res.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("[§14] records RED metrics per route template", async () => {
    const recorder = app.get<InMemoryMetricsRecorder>(METRICS_RECORDER);
    recorder.reset();

    await http().get("/ok").expect(200);
    await http().get("/boom").expect(400);

    expect(recorder.get("GET /ok")?.count).toBe(1);
    expect(recorder.get("GET /ok")?.errors).toBe(0);
    // 400 is a client outcome, not a RED error (only 5xx counts).
    expect(recorder.get("GET /boom")?.count).toBe(1);
    expect(recorder.get("GET /boom")?.errors).toBe(0);
  });
});
