/**
 * HealthModule (STANDARDS §14). Wires the liveness/readiness endpoints. Depends
 * on the global PrismaModule (both PrismaService + PlatformPrismaService) for
 * the dependency checks. Imported by AppModule so /health/* is always mounted.
 */
import { Module } from "@nestjs/common";

import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
