/**
 * IdempotencyModule (STANDARDS §6, §7.4). Wires the HTTP-idempotency domain:
 * repository (tenant-scoped atomic claim over RLS), service (lifecycle +
 * replay/conflict decisions), the injectable clock, and the interceptor that
 * routes opt into with @Idempotent. Depends on PrismaModule (global) +
 * TenantContextModule (global). Exports the interceptor + service so apps can
 * apply them per-route (or globally) as state-creating POST routes land.
 */
import { Module } from "@nestjs/common";

import { IDEMPOTENCY_CLOCK, systemIdempotencyClock } from "./idempotency.clock";
import { IdempotencyInterceptor } from "./idempotency.interceptor";
import { IdempotencyRepository } from "./idempotency.repository";
import { IdempotencyService } from "./idempotency.service";

@Module({
  providers: [
    IdempotencyRepository,
    IdempotencyService,
    IdempotencyInterceptor,
    { provide: IDEMPOTENCY_CLOCK, useValue: systemIdempotencyClock },
  ],
  exports: [IdempotencyService, IdempotencyInterceptor],
})
export class IdempotencyModule {}
