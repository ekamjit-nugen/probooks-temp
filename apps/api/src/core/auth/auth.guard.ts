/**
 * AuthGuard (STANDARDS §10.2 step 1; INV-AUTH-4). Verifies the Bearer access
 * token, builds the request principal from the VERIFIED claims, re-derives
 * permissions from the role via the shared §4.17 matrix (per request — never
 * from prior session state), and attaches it as `req.principalClaim`. The
 * existing TenantContextInterceptor then seeds the AsyncLocalStorage from that
 * claim (Wave 2 seam) — so tenant is server-derived, never from the body.
 *
 * @Public routes (rare; §10.4) skip authentication. Unauthenticated requests to
 * any other route throw UnauthenticatedError (401).
 */
import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  permissionsForRole,
  type ClientId,
  type Permission,
  type TenantId,
  type UserId,
} from "@probooks/shared";

import { PUBLIC_METADATA_KEY } from "../rbac/rbac.decorators";
import type { PrincipalClaim } from "../tenant-context/tenant-context.interceptor";

import { UnauthenticatedError } from "./auth.errors";
import {
  TOKEN_VERIFIER,
  type AccessClaims,
  type TokenVerifier,
} from "./token-contract";

interface MutableRequest {
  headers: Record<string, string | string[] | undefined>;
  principalClaim?: PrincipalClaim;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.isPublic(context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<MutableRequest>();
    const token = this.extractBearer(request.headers["authorization"]);
    if (token === undefined) {
      throw new UnauthenticatedError("Missing Bearer access token");
    }

    // Throws InvalidTokenError (401) on bad signature / tampered / expired.
    const claims = this.verifier.verifyAccessToken(token);

    request.principalClaim = this.toPrincipal(claims);
    return true;
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  /** Build the request principal; permissions re-derived per request (INV-AUTH-4). */
  private toPrincipal(claims: AccessClaims): PrincipalClaim {
    const permissions: ReadonlySet<Permission> = permissionsForRole(
      claims.role,
    );
    const base = {
      tenantId: claims.tenantId as TenantId,
      userId: claims.userId as UserId,
      userRole: claims.role,
      permissions,
    };
    if (claims.clientId !== undefined) {
      return { ...base, clientId: claims.clientId as ClientId };
    }
    return base;
  }

  private extractBearer(
    header: string | string[] | undefined,
  ): string | undefined {
    const value = Array.isArray(header) ? header[0] : header;
    if (value === undefined) {
      return undefined;
    }
    const [scheme, token] = value.split(" ");
    if (scheme !== "Bearer" || token === undefined || token.length === 0) {
      return undefined;
    }
    return token;
  }
}

/** DI token so AuthModule can bind the verifier via the symbol provider. */
export const AUTH_GUARD_VERIFIER = TOKEN_VERIFIER;
