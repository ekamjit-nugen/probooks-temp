/**
 * @probooks/shared — Zod schemas, INV codes, branded types, period/HST math.
 * Zero runtime deps beyond Zod (STANDARDS §2). Modules are filled in per wave.
 */

/**
 * Branded type helper (STANDARDS §3). Mixing two ID kinds at a call site is a
 * compile error: `type TenantId = Brand<string, 'TenantId'>`.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type TenantId = Brand<string, "TenantId">;
export type UserId = Brand<string, "UserId">;
export type ClientId = Brand<string, "ClientId">;

/** Package marker — replaced by real exports as modules land (Waves 1+). */
export const SHARED_PACKAGE = "@probooks/shared";

// API contract (STANDARDS §7.1) — response envelope shared BE+FE.
export {
  API_VERSION,
  ErrorCodeSchema,
  ErrorEnvelopeSchema,
  ResponseMetaSchema,
  successEnvelope,
  errorEnvelope,
  type ErrorEnvelope,
  type ResponseMeta,
} from "./api/response-envelope.js";

// Auth roles (STANDARDS §10.2; SPEC §1, §4.17) — shared BE+FE.
export {
  CLIENT_ROLES,
  isClientRole,
  UserRoleSchema,
  type UserRole,
} from "./auth/roles.js";

// RBAC permission matrix (STANDARDS §10.3; SPEC §4.17) — single source of truth.
export {
  CAPABILITY_MATRIX,
  hasPermission,
  permissionsForRole,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type Permission,
} from "./auth/permissions.js";

// Background-job idempotency — the three-layer pattern (STANDARDS §15.2; SPEC §5).
export {
  buildJobDedupeKey,
  DEFAULT_JOB_DEDUPE_TTL_MS,
  DEFAULT_JOB_LOCK_TTL_MS,
  JobIdempotencyContextSchema,
  JOB_DEDUPE_NAMESPACE,
  runIdempotentJob,
  type DedupeStore,
  type DistributedLock,
  type JobIdempotencyContext,
  type JobIdempotencyOptions,
  type JobRunOutcome,
  type LockLease,
} from "./jobs/idempotency.js";
