/**
 * Shared infrastructure constants (STANDARDS §5.1 UPPER_SNAKE for constants).
 *
 * Residency is a hard PIPEDA requirement (INV-AUDIT-5): everything is pinned
 * to ca-central-1 and nothing is replicated cross-region. This single source
 * of truth is consumed by `bin/probooks-infra.ts` for every stack `env`.
 */

/** The only AWS region ProBooks data may live in (INV-AUDIT-5 / PIPEDA). */
export const CA_CENTRAL_1 = "ca-central-1";

/** CloudWatch log retention for application + audit logs, in days (STANDARDS §14). */
export const LOG_RETENTION_DAYS = 365;

/**
 * RDS automated-backup retention window, in days. >= 1 enables point-in-time
 * recovery; 14 days gives a comfortable PITR window for a financial system
 * (STANDARDS §8 durability; see docs/runbooks/dr-backup-restore.md).
 */
export const DB_BACKUP_RETENTION_DAYS = 14;
