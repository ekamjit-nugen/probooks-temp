/**
 * Real Postgres 16 Testcontainer harness (STANDARDS §19.2 — never SQLite; RLS
 * must match production semantics). Boots a container, applies the committed
 * Prisma migrations as the superuser (table owner), then provisions a
 * NON-superuser application role (`app_user`) and the BYPASSRLS `service_role`
 * with login passwords so tests can prove RLS the way production runs it.
 *
 * Why two login roles:
 *   - The container's default `postgres` user is a SUPERUSER and BYPASSES RLS.
 *     Testing RLS through it proves nothing. The migration FORCEs RLS so even
 *     the owner is bound, but the realistic, defense-in-depth proof connects as
 *     `app_user` (non-superuser, non-owner). That is what these tests do.
 *   - `service_role` (BYPASSRLS) models platform/operator + migration access
 *     (STANDARDS §9.6, INV-TEN-3).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Client } from "pg";

const execFileAsync = promisify(execFile);

/** Login password for the provisioned app/service roles (test-only, ephemeral). */
const APP_USER_PASSWORD = "app_user_test_pw";
const SERVICE_ROLE_PASSWORD = "service_role_test_pw";

export interface PostgresHarness {
  readonly container: StartedPostgreSqlContainer;
  /** Superuser/owner URL (postgres) — used to run migrations + seed fixtures. */
  readonly ownerUrl: string;
  /** NON-superuser application URL (app_user) — RLS is enforced on this role. */
  readonly appUserUrl: string;
  /** BYPASSRLS platform URL (service_role) — cross-tenant platform/ops access. */
  readonly serviceRoleUrl: string;
  /** Tear down the container. */
  stop(): Promise<void>;
}

/** Build a libpq URL for an arbitrary role against the started container. */
function urlFor(
  container: StartedPostgreSqlContainer,
  user: string,
  password: string,
): string {
  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const db = container.getDatabase();
  return `postgresql://${user}:${password}@${host}:${port}/${db}`;
}

/**
 * Start Postgres 16, apply migrations from `prismaSchemaDir`, and provision the
 * app_user / service_role login roles. `prismaSchemaDir` is the directory that
 * contains `schema.prisma` (i.e. `apps/api/prisma`).
 */
export async function startPostgresHarness(
  prismaSchemaDir: string,
): Promise<PostgresHarness> {
  const container = await new PostgreSqlContainer("postgres:16").start();
  const ownerUrl = urlFor(
    container,
    container.getUsername(),
    container.getPassword(),
  );

  // Apply the committed migrations as the superuser (table owner).
  await execFileAsync(
    "npx",
    [
      "prisma",
      "migrate",
      "deploy",
      "--schema",
      `${prismaSchemaDir}/schema.prisma`,
    ],
    { env: { ...process.env, DATABASE_URL: ownerUrl } },
  );

  // Grant the migration-created roles a LOGIN + password so tests can connect
  // as them. The roles + privileges + RLS policies already exist (migration);
  // here we only attach credentials (never committed — STANDARDS §17).
  const admin = new Client({ connectionString: ownerUrl });
  await admin.connect();
  try {
    await admin.query(
      `ALTER ROLE app_user LOGIN PASSWORD '${APP_USER_PASSWORD}'`,
    );
    await admin.query(
      `ALTER ROLE service_role LOGIN PASSWORD '${SERVICE_ROLE_PASSWORD}'`,
    );
  } finally {
    await admin.end();
  }

  return {
    container,
    ownerUrl,
    appUserUrl: urlFor(container, "app_user", APP_USER_PASSWORD),
    serviceRoleUrl: urlFor(container, "service_role", SERVICE_ROLE_PASSWORD),
    stop: async (): Promise<void> => {
      await container.stop();
    },
  };
}
