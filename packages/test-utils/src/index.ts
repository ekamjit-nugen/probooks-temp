/**
 * @probooks/test-utils — Testcontainers helpers, factories, fixtures (STANDARDS §19.2).
 * Real Postgres + Redis containers; never SQLite stand-ins (RLS must match).
 * Helpers are filled in alongside the modules that need them (Waves 2+).
 */
export const TEST_UTILS_PACKAGE = "@probooks/test-utils";

export {
  startPostgresHarness,
  type PostgresHarness,
} from "./postgres-container.js";
