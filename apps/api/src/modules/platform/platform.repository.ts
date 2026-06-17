/**
 * PlatformRepository (STANDARDS §9.6; INV-TEN-3). The ONLY consumer of the
 * service_role (BYPASSRLS) connection. It serves the Platform Operator's
 * cross-tenant surfaces — tenant lifecycle + billing METADATA — and is
 * structurally restricted to tenant-metadata tables: it never selects from a
 * financial table (period_summaries, and the documents/flags/summaries that land
 * later). That separation is enforced three ways (INV-TEN-3):
 *   1. STRUCTURE — this class exposes no financial accessor;
 *   2. GRANT     — service_role holds no privilege on financial tables, so a
 *                  stray query errors at the DB (proven in platform.e2e.spec.ts);
 *   3. REVIEW    — STANDARDS §24 checklist verifies no operator route reaches
 *                  financial data.
 *
 * Because operator queries legitimately span tenants (there is no single tenant
 * to bind), this repository DOES take a tenantId argument — it is NOT a §9.3
 * tenant-scoped repository (those read tenant from context and run under RLS).
 * It uses raw SQL via the service_role client; the @probooks/no-cross-tenant
 * lint rule targets app_user Prisma model calls, not this metadata path.
 */
import { Injectable } from "@nestjs/common";

import { PlatformPrismaService } from "../../core/prisma/platform-prisma.service";

/** Operator-visible tenant metadata — never financial figures (INV-TEN-3). */
export interface TenantMetadata {
  readonly id: string;
  readonly status: string;
  readonly region: string;
  readonly planRef: string | null;
  readonly userCount: number;
}

interface TenantMetadataRow {
  id: string;
  status: string;
  region: string;
  plan_ref: string | null;
  user_count: number;
}

@Injectable()
export class PlatformRepository {
  constructor(private readonly platformPrisma: PlatformPrismaService) {}

  /** One tenant's metadata (status, region, plan, user count), or null. */
  async getTenantMetadata(tenantId: string): Promise<TenantMetadata | null> {
    const rows = await this.platformPrisma.$queryRawUnsafe<TenantMetadataRow[]>(
      `SELECT t.id, t.status, t.region, t.plan_ref,
              (SELECT count(*)::int FROM users u WHERE u.tenant_id = t.id) AS user_count
         FROM tenants t
        WHERE t.id = $1::uuid`,
      tenantId,
    );
    const row = rows[0];
    return row === undefined ? null : this.toMetadata(row);
  }

  /** All tenants' metadata, newest first — the operator tenant list. */
  async listTenants(): Promise<TenantMetadata[]> {
    const rows = await this.platformPrisma.$queryRawUnsafe<TenantMetadataRow[]>(
      `SELECT t.id, t.status, t.region, t.plan_ref,
              (SELECT count(*)::int FROM users u WHERE u.tenant_id = t.id) AS user_count
         FROM tenants t
        ORDER BY t.created_at DESC`,
    );
    return rows.map((r) => this.toMetadata(r));
  }

  private toMetadata(row: TenantMetadataRow): TenantMetadata {
    return {
      id: row.id,
      status: row.status,
      region: row.region,
      planRef: row.plan_ref,
      userCount: Number(row.user_count),
    };
  }
}
