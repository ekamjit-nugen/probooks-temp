/**
 * Zod-validated environment schema (STANDARDS §17, §1, §3).
 *
 * The single place that interprets raw environment input. Missing/invalid env
 * fails FAST at boot with an aggregated, human-readable error — never silently
 * at runtime. No `process.env` access is permitted outside this module.
 */
import { z } from "zod";

/** Runtime environments the service recognizes. */
export const NodeEnvSchema = z.enum(["development", "test", "production"]);
export type NodeEnv = z.infer<typeof NodeEnvSchema>;

/** Pino log levels (STANDARDS §13). */
export const LogLevelSchema = z.enum([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

/**
 * Raw environment schema. Strings in (process.env is all strings); coerced and
 * defaulted here so the rest of the app consumes a typed AppConfig.
 */
export const EnvSchema = z.object({
  NODE_ENV: NodeEnvSchema.default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  LOG_LEVEL: LogLevelSchema.default("info"),
  /**
   * Postgres connection string for the tenant-scoped application role
   * (RLS-enforced; NON-superuser — STANDARDS §8.4, §9). Optional at boot so
   * non-DB workflows (some tests, CLIs) still construct config; PrismaService
   * resolves it via getRequired and fails fast when the DB is actually used.
   */
  DATABASE_URL: z.string().url().optional(),
  /**
   * Separate connection string for the platform service_role that BYPASSES RLS
   * (migrations + operator/platform queries — STANDARDS §9.6, INV-TEN-3).
   * Structurally distinct so tenant-scoped repositories never reach for it.
   */
  DATABASE_SERVICE_ROLE_URL: z.string().url().optional(),
  /**
   * Secret for the internal HS256 JWT signer (ADR-0005; STANDARDS §10.1, §17).
   * Sourced from AWS Secrets Manager in real environments — never committed.
   * ≥32 chars so HMAC-SHA256 has adequate keying. Optional at boot so non-auth
   * workflows still construct config; the token service resolves it via
   * getRequired and fails fast when a token is actually signed/verified.
   */
  JWT_SECRET: z.string().min(32).optional(),
  /** Access-token lifetime in seconds (STANDARDS §10.1 default 15 min). */
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  /** Refresh-token lifetime in seconds (STANDARDS §10.1 default 8 h). */
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(28_800),
});

/** The typed, validated configuration the application consumes. */
export interface AppConfig {
  readonly nodeEnv: NodeEnv;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly databaseUrl: string | undefined;
  readonly databaseServiceRoleUrl: string | undefined;
  readonly jwtSecret: string | undefined;
  readonly jwtAccessTtlSeconds: number;
  readonly jwtRefreshTtlSeconds: number;
}

/**
 * Thrown when the environment fails validation. Not a DomainError: this fires
 * at boot, before the HTTP layer and exception filter exist (STANDARDS §12 is
 * for request-time business errors).
 */
export class ConfigValidationError extends Error {
  override readonly name = "ConfigValidationError";

  constructor(issues: readonly z.ZodIssue[]) {
    const lines = issues.map((issue) => {
      const path = issue.path.join(".") || "(root)";
      return `  - ${path}: ${issue.message}`;
    });
    super(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
}

/**
 * Validate a raw environment record into a typed AppConfig. Throws
 * ConfigValidationError listing every offending variable when invalid.
 */
export function parseEnv(
  raw: NodeJS.ProcessEnv | Record<string, string | undefined>,
): AppConfig {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigValidationError(result.error.issues);
  }
  return {
    nodeEnv: result.data.NODE_ENV,
    port: result.data.PORT,
    logLevel: result.data.LOG_LEVEL,
    databaseUrl: result.data.DATABASE_URL,
    databaseServiceRoleUrl: result.data.DATABASE_SERVICE_ROLE_URL,
    jwtSecret: result.data.JWT_SECRET,
    jwtAccessTtlSeconds: result.data.JWT_ACCESS_TTL_SECONDS,
    jwtRefreshTtlSeconds: result.data.JWT_REFRESH_TTL_SECONDS,
  };
}
