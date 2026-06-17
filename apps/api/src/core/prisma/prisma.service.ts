/**
 * PrismaService (STANDARDS §8). The tenant-scoped database client: connects as
 * the NON-superuser `app_user` role (DATABASE_URL) so Postgres RLS is enforced
 * on every statement (INV-TEN-1, defense-in-depth backstop).
 *
 * The ONLY sanctioned way to run tenant-scoped work is `runInTenantTx`: it opens
 * a transaction, issues `SET LOCAL app.tenant_id = '<uuid>'` so the RLS policies
 * bind, then runs the caller's work against the transactional client. The tenant
 * is read from TenantContext — never accepted as a parameter (STANDARDS §9.3).
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

import { AppConfigService } from "../config-env/app-config.service";
import { TenantContextService } from "../tenant-context/tenant-context.service";

/** The transactional client repositories receive inside runInTenantTx. */
export type TenantTxClient = Prisma.TransactionClient;

/** Guards against anything but a canonical UUID reaching the SET LOCAL string. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    config: AppConfigService,
    private readonly tenantContext: TenantContextService,
  ) {
    super({
      datasources: {
        // app_user URL — RLS-enforced (STANDARDS §8.4). Fail-fast if unset.
        db: { url: config.getRequired("databaseUrl") },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Run `work` inside a transaction bound to the current tenant. Reads the
   * tenant from context (throws NoTenantContextError if unseeded — fail-closed),
   * issues SET LOCAL app.tenant_id so RLS binds for the duration, then runs the
   * caller's repository work against the transactional client.
   */
  async runInTenantTx<T>(work: (tx: TenantTxClient) => Promise<T>): Promise<T> {
    const { tenantId } = this.tenantContext.require();
    if (!UUID_RE.test(tenantId)) {
      // Context ids are branded strings; this is a final injection backstop.
      throw new Prisma.PrismaClientKnownRequestError(
        "Tenant id is not a valid UUID",
        { code: "P2023", clientVersion: Prisma.prismaVersion.client },
      );
    }

    return this.$transaction(async (tx) => {
      // SET LOCAL is transaction-scoped: it auto-resets at COMMIT/ROLLBACK, so
      // the binding never leaks onto the pooled connection (STANDARDS §8.4).
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
      return work(tx);
    });
  }
}
