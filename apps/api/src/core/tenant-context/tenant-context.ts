/**
 * TenantContext (STANDARDS §9.2). The authenticated principal, carried per
 * request in AsyncLocalStorage. Branded ids from @probooks/shared make mixing
 * a tenantId and a clientId at a call site a compile error (STANDARDS §3).
 */
import type {
  ClientId,
  Permission,
  TenantId,
  UserId,
  UserRole,
} from "@probooks/shared";

export type { Permission };

/**
 * The principal context. `clientId` is present iff the role is a client role
 * (INV-AUTH-3) — enforced when the context is built (auth, Wave 3).
 */
export interface TenantContext {
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly userRole: UserRole;
  readonly clientId?: ClientId;
  readonly permissions: ReadonlySet<Permission>;
}
