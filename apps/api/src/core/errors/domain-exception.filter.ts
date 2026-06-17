/**
 * Single exception filter (STANDARDS §12.2) translating any thrown value into
 * the §7.1 error envelope. DomainErrors map to their declared status/code;
 * unknown errors become a sanitized 500 (no stack, no internal paths) and are
 * forwarded to the ErrorReporter (Sentry seam, STANDARDS §14).
 */
import { randomUUID } from "node:crypto";

import {
  Catch,
  Inject,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { errorEnvelope, type ErrorEnvelope } from "@probooks/shared";

import { DomainError } from "./domain-error";
import { ERROR_REPORTER, type ErrorReporter } from "./error-reporter";

/** Minimal shape we read off the request — requestId is set by middleware (Wave 2+). */
interface RequestLike {
  requestId?: string;
}

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): ResponseLike;
}

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  constructor(
    @Inject(ERROR_REPORTER) private readonly reporter: ErrorReporter,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestLike>();
    const response = http.getResponse<ResponseLike>();
    const requestId = request.requestId ?? randomUUID();

    const { status, envelope } = this.resolve(exception, requestId);
    response.status(status).json(envelope);
  }

  private resolve(
    exception: unknown,
    requestId: string,
  ): { status: number; envelope: ErrorEnvelope } {
    if (exception instanceof DomainError) {
      return {
        status: exception.httpStatus,
        envelope: errorEnvelope({
          code: exception.code,
          message: exception.message,
          requestId,
          ...(exception.details !== undefined
            ? { details: exception.details }
            : {}),
        }),
      };
    }

    // Unknown — never leak internals (STANDARDS §12.2, §18.1). Report + sanitize.
    this.reporter.report(exception);
    return {
      status: 500,
      envelope: errorEnvelope({
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        requestId,
      }),
    };
  }
}
