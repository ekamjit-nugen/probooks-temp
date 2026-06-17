/**
 * Token contract (STANDARDS §10.1; ADR-0005). Provider-neutral interfaces for
 * issuing and verifying tokens, plus the claim shapes. Every call site
 * (AuthGuard, refresh rotation) depends on TokenIssuer/TokenVerifier — never a
 * concrete signer — so the IdP can swap (Auth0/Cognito at ADR-0002) with no
 * call-site changes.
 *
 * Access claims carry tenantId, userId, role, optional sub_role, optional
 * clientId. Refresh claims additionally carry the rotation jti. Both validated
 * with Zod on verify (STANDARDS §11).
 */
import { UserRoleSchema, type UserRole } from "@probooks/shared";
import { z } from "zod";

/** UUID v4/v7 shape for id claims (defense at the boundary, STANDARDS §11). */
const UuidSchema = z.string().uuid();

/**
 * Access-token claims (the request principal, self-describing). `clientId` is
 * present iff the role is a client role (INV-AUTH-3) — enforced by the issuer
 * and re-checked on verify via refine.
 */
export const AccessClaimsSchema = z
  .object({
    /** token type discriminator — rejects a refresh token used as an access token */
    typ: z.literal("access"),
    tenantId: UuidSchema,
    userId: UuidSchema,
    role: UserRoleSchema,
    /** Optional sub-role label (client_owner vs client_staff already in role). */
    subRole: z.string().min(1).optional(),
    clientId: UuidSchema.optional(),
    /** Issued-at / expiry, epoch seconds (STANDARDS §10.1). */
    iat: z.number().int().nonnegative(),
    exp: z.number().int().nonnegative(),
  })
  .superRefine((claims, ctx) => {
    const isClient =
      claims.role === "client_owner" || claims.role === "client_staff";
    if (isClient && claims.clientId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "client role requires clientId (INV-AUTH-3)",
        path: ["clientId"],
      });
    }
    if (!isClient && claims.clientId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "non-client role must not carry clientId (INV-AUTH-3)",
        path: ["clientId"],
      });
    }
  });

export type AccessClaims = z.infer<typeof AccessClaimsSchema>;

/** Refresh-token claims: a tracked jti backing rotation + replay detection. */
export const RefreshClaimsSchema = z.object({
  typ: z.literal("refresh"),
  tenantId: UuidSchema,
  userId: UuidSchema,
  /** This refresh token's unique id; persisted in refresh_tokens. */
  jti: UuidSchema,
  iat: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
});

export type RefreshClaims = z.infer<typeof RefreshClaimsSchema>;

/** The minimal principal an access token is minted for. */
export interface AccessSubject {
  readonly tenantId: string;
  readonly userId: string;
  readonly role: UserRole;
  readonly subRole?: string;
  readonly clientId?: string;
}

/** A refresh subject is identified by tenant + user. */
export interface RefreshSubject {
  readonly tenantId: string;
  readonly userId: string;
  /** The jti to embed — caller (rotation service) owns lineage allocation. */
  readonly jti: string;
}

/** Issues signed tokens. Concrete impl: HmacTokenService (ADR-0005). */
export interface TokenIssuer {
  signAccessToken(subject: AccessSubject): string;
  signRefreshToken(subject: RefreshSubject): string;
}

/** Verifies + parses signed tokens. Throws a DomainError (401) on any failure. */
export interface TokenVerifier {
  verifyAccessToken(token: string): AccessClaims;
  verifyRefreshToken(token: string): RefreshClaims;
}

/** DI tokens for the interfaces (concrete impl bound in AuthModule). */
export const TOKEN_ISSUER = Symbol("TOKEN_ISSUER");
export const TOKEN_VERIFIER = Symbol("TOKEN_VERIFIER");
