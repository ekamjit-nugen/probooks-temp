/**
 * RLS posture verifier (STANDARDS §8.4; INV-TEN-1). Asserts every tenant-scoped
 * table has Row-Level Security ENABLED and FORCED. Run at boot (and in tests) to
 * prove the posture instead of trusting that the migration was applied — a table
 * that is RLS-enabled but not FORCEd still leaks to its owner.
 */

/** Tenant-scoped tables that MUST be RLS-enabled + FORCEd (SPEC §2 spine). */
export const TENANT_SCOPED_TABLES = Object.freeze([
  "users",
  "clients",
  "audit_log",
  "idempotency_keys",
  "refresh_tokens",
]);

/** A table whose RLS posture is wrong, with the offending flags. */
export interface RlsViolation {
  readonly table: string;
  readonly rowSecurityEnabled: boolean;
  readonly forced: boolean;
}

/** Minimal client surface we need — satisfied by PrismaClient and pg-backed shims. */
export interface RlsQueryClient {
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
}

interface PgClassRow {
  relname: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
}

/**
 * Return the tables whose RLS posture is NOT (enabled AND forced). An empty
 * array means the posture is correct for every tenant-scoped table.
 */
export async function findRlsViolations(
  client: RlsQueryClient,
  tables: readonly string[] = TENANT_SCOPED_TABLES,
): Promise<RlsViolation[]> {
  const rows = await client.$queryRawUnsafe<PgClassRow[]>(
    `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class
      WHERE relname = ANY($1::text[])`,
    tables,
  );

  const byName = new Map(rows.map((r) => [r.relname, r]));
  const violations: RlsViolation[] = [];

  for (const table of tables) {
    const row = byName.get(table);
    const rowSecurityEnabled = row?.relrowsecurity ?? false;
    const forced = row?.relforcerowsecurity ?? false;
    if (!rowSecurityEnabled || !forced) {
      violations.push({ table, rowSecurityEnabled, forced });
    }
  }

  return violations;
}

/** Thrown when the RLS posture is wrong at boot — fail fast (STANDARDS §8.4). */
export class RlsPostureError extends Error {
  override readonly name = "RlsPostureError";

  constructor(public readonly violations: readonly RlsViolation[]) {
    const detail = violations
      .map(
        (v) =>
          `  - ${v.table}: rowsecurity=${String(v.rowSecurityEnabled)} forced=${String(v.forced)}`,
      )
      .join("\n");
    super(`Tenant-scoped tables without ENABLE+FORCE RLS:\n${detail}`);
  }
}

/** Assert correct RLS posture or throw RlsPostureError (INV-TEN-1). */
export async function verifyRlsEnabled(
  client: RlsQueryClient,
  tables: readonly string[] = TENANT_SCOPED_TABLES,
): Promise<void> {
  const violations = await findRlsViolations(client, tables);
  if (violations.length > 0) {
    throw new RlsPostureError(violations);
  }
}
