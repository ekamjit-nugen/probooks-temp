/**
 * AuditModule (STANDARDS §6, §18.3). Wires the append-only audit domain:
 * repository (INSERT-only, tenant-scoped), service (records + verifies the hash
 * chain), the transaction runner helper, and the injectable clock. Depends on
 * PrismaModule (global) + TenantContextModule (global) for tenant-scoped DB
 * access. Exported so other domains can record transitions atomically with
 * their own state changes (INV-AUDIT-1).
 */
import { Module } from "@nestjs/common";

import { AUDIT_CLOCK, systemAuditClock } from "./audit.clock";
import { AuditRepository } from "./audit.repository";
import { AuditService, AuditTransactionRunner } from "./audit.service";

@Module({
  providers: [
    AuditRepository,
    AuditService,
    AuditTransactionRunner,
    { provide: AUDIT_CLOCK, useValue: systemAuditClock },
  ],
  exports: [AuditService, AuditTransactionRunner],
})
export class AuditModule {}
