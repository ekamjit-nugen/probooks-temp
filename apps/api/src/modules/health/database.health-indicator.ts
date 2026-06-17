/**
 * DatabaseHealthIndicator (STANDARDS §14). Pings one database connection with a
 * dependency-free `SELECT 1` and reports up/down — it NEVER throws, so a single
 * unreachable connection degrades readiness rather than crashing the endpoint.
 *
 * Decoupled from the concrete Prisma classes: it accepts anything that can run a
 * raw query, so it works for both the app_user (PrismaService) and service_role
 * (PlatformPrismaService) connections without importing either.
 */

/** The minimal surface a health-checkable client exposes. */
export interface Pingable {
  $queryRawUnsafe(query: string): Promise<unknown>;
}

/** One dependency check result. */
export interface HealthCheck {
  readonly name: string;
  readonly status: "up" | "down";
}

/** Ping `client` and report up/down. Swallows the error (down, never throws). */
export async function checkDatabase(
  name: string,
  client: Pingable,
): Promise<HealthCheck> {
  try {
    await client.$queryRawUnsafe("SELECT 1");
    return { name, status: "up" };
  } catch {
    return { name, status: "down" };
  }
}
