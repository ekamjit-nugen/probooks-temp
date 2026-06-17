import { Module } from "@nestjs/common";

import { AuthModule } from "./core/auth/auth.module";
import { ConfigEnvModule } from "./core/config-env/config-env.module";
import { ErrorsModule } from "./core/errors/errors.module";
import { LoggingModule } from "./core/logging/logging.module";
import { ObservabilityModule } from "./core/observability/observability.module";
import { PrismaModule } from "./core/prisma/prisma.module";
import { RbacModule } from "./core/rbac/rbac.module";
import { TenancyGuardModule } from "./core/tenancy-guard/tenancy-guard.module";
import { TenantContextModule } from "./core/tenant-context/tenant-context.module";
import { HealthModule } from "./modules/health/health.module";

/**
 * Root module. Core foundation modules are registered here; domain modules land
 * in src/modules/<domain>/ per wave (auth, rbac, audit, idempotency, ...).
 * STANDARDS §6.
 *
 * - ConfigEnvModule: validated AppConfig + SecretsProvider (global) — §17.
 * - LoggingModule: injectable Pino logger with PII redaction (global) — §13.
 * - ErrorsModule: global DomainExceptionFilter → §7.1 envelope — §12.
 * - TenantContextModule: request-scoped tenant ALS (global) — §9.2.
 * - ObservabilityModule: request-id + traceparent middleware + RED metrics (global) — §13/§14.
 * - PrismaModule: RLS-bound PrismaService + service_role client (global) — §8.
 * - AuthModule: internal token layer + AuthGuard (global) — §10.1.
 * - RbacModule: RoleGuard (deny-by-default) (global) — §10.2/§10.4.
 * - TenancyGuardModule: TenantGuard (cross-tenant 404) + ResourceGuard — §9.4/§10.2.
 * - HealthModule: unauthenticated /health/live + /health/ready probes — §14.
 * The ZodValidationPipe (§11) is applied per-route with its schema, not global.
 * The guard stack (§10.2 order) is applied per-controller via GUARD_STACK.
 */
@Module({
  imports: [
    ConfigEnvModule,
    LoggingModule,
    ErrorsModule,
    TenantContextModule,
    ObservabilityModule,
    PrismaModule,
    AuthModule,
    RbacModule,
    TenancyGuardModule,
    HealthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
