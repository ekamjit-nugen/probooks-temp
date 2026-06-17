/**
 * ClientRepository — the §9.3 tenant-scoped repository EXEMPLAR. It proves the
 * pattern every domain repository must follow (and that the
 * @probooks/no-cross-tenant lint rule passes):
 *   - injects PrismaService + TenantContextService,
 *   - reads tenantId from CONTEXT (never a parameter — STANDARDS §9.3),
 *   - puts tenantId in the `where` of EVERY query (INV-TEN-1),
 *   - runs against the tenant-bound transaction client so RLS also binds.
 *
 * The full clients domain (controller/service/DTOs) lands in a later phase; this
 * is deliberately minimal: create + findByIdForTenant + listForTenant.
 *
 * `create` accepts an optional parent `tx` so a caller can compose the write
 * atomically with other tenant-scoped writes in the SAME transaction (e.g. an
 * audit-log append — INV-AUDIT-1). Tenant comes from context, never a param, and
 * is written into the row so RLS WITH CHECK binds (§9.3, INV-TEN-1).
 */
import { Injectable } from "@nestjs/common";
import type { Client } from "@prisma/client";

import {
  PrismaService,
  type TenantTxClient,
} from "../../core/prisma/prisma.service";
import { TenantContextService } from "../../core/tenant-context/tenant-context.service";

@Injectable()
export class ClientRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Create a client for the current tenant. When a parent `tx` is supplied the
   * INSERT joins the caller's transaction (so it commits/rolls back atomically
   * with sibling writes — INV-AUDIT-1); otherwise it runs in its own tenant-bound
   * transaction. Either way tenantId comes from context and is written into the
   * row (§9.3; RLS WITH CHECK binds — INV-TEN-1).
   */
  async create(input: { name: string }, tx?: TenantTxClient): Promise<Client> {
    const { tenantId } = this.tenantContext.require();
    const write = (client: TenantTxClient): Promise<Client> =>
      client.client.create({
        data: { tenantId, name: input.name },
      });
    return tx !== undefined ? write(tx) : this.prisma.runInTenantTx(write);
  }

  /** All clients for the current tenant, newest first. */
  async listForTenant(): Promise<Client[]> {
    const { tenantId } = this.tenantContext.require();
    return this.prisma.runInTenantTx((tx: TenantTxClient) =>
      tx.client.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      }),
    );
  }

  /** A single client by id, scoped to the current tenant (404-on-miss is the caller's job). */
  async findByIdForTenant(clientId: string): Promise<Client | null> {
    const { tenantId } = this.tenantContext.require();
    return this.prisma.runInTenantTx((tx: TenantTxClient) =>
      tx.client.findFirst({
        where: { tenantId, id: clientId },
      }),
    );
  }
}
