/**
 * ErrorsModule (STANDARDS §12). Provides the global DomainExceptionFilter and
 * the ErrorReporter seam. Registered globally so every route maps errors to the
 * §7.1 envelope consistently. main.ts wires the filter as a global filter.
 */
import { Global, Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { DomainExceptionFilter } from "./domain-exception.filter";
import { ERROR_REPORTER, NoopErrorReporter } from "./error-reporter";

@Global()
@Module({
  providers: [
    { provide: ERROR_REPORTER, useClass: NoopErrorReporter },
    DomainExceptionFilter,
    { provide: APP_FILTER, useExisting: DomainExceptionFilter },
  ],
  exports: [ERROR_REPORTER, DomainExceptionFilter],
})
export class ErrorsModule {}
