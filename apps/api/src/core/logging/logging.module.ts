/**
 * LoggingModule (STANDARDS §13). Wraps nestjs-pino so the logger is injectable
 * (never constructed ad-hoc) and every HTTP line carries requestId, route and
 * latencyMs. PII redaction is configured via buildPinoOptions. tenantId/userId
 * are null seams until TenantContext lands (Wave 2).
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { Global, Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";

import { AppConfigService } from "../config-env/app-config.service";
import { ConfigEnvModule } from "../config-env/config-env.module";

import { buildPinoOptions } from "./logger.factory";

@Global()
@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigEnvModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          ...buildPinoOptions({
            nodeEnv: config.get("nodeEnv"),
            logLevel: config.get("logLevel"),
          }),
          // requestId per line (STANDARDS §13). Honors an inbound header for tracing.
          genReqId: (req: IncomingMessage, res: ServerResponse): string => {
            const incoming = req.headers["x-request-id"];
            const id =
              typeof incoming === "string" && incoming.length > 0
                ? incoming
                : randomUUID();
            res.setHeader("x-request-id", id);
            return id;
          },
          // route + latencyMs (STANDARDS §13). pino-http times the request; we
          // surface the matched path and elapsed ms in the completion line.
          customProps: (req: IncomingMessage) => ({
            route: (req as IncomingMessage & { url?: string }).url ?? "unknown",
          }),
          customSuccessMessage: () => "request completed",
          customErrorMessage: () => "request errored",
        },
      }),
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
