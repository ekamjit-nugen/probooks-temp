/**
 * Audit DomainErrors (STANDARDS §12.1). Extend DomainError so the
 * DomainExceptionFilter maps them to the §7.1 envelope — never throw raw Error
 * for business cases (STANDARDS §29).
 */
import { DomainError } from "../../core/errors/domain-error";

import type { ChainTamperReason } from "./hash-chain/hash-chain.verifier";

/**
 * 409 — a tenant's audit chain failed verification: an entry was mutated,
 * deleted, reordered, or inserted out of band. Surfaces the first bad position
 * and the reason. 409 (Conflict) because the persisted state is internally
 * inconsistent and cannot be trusted (STANDARDS §7.2).
 */
export class AuditChainTamperError extends DomainError {
  readonly code = "AUDIT_CHAIN_TAMPER";
  readonly httpStatus = 409;

  constructor(
    public readonly position: number,
    public readonly reason: ChainTamperReason,
  ) {
    super(
      `Audit chain integrity check failed at position ${String(position)}`,
      {
        position,
        reason,
      },
    );
  }
}
