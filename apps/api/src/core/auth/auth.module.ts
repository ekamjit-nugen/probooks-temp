/**
 * AuthModule (STANDARDS §10.1, §10.2; ADR-0005). Binds the internal token layer
 * behind its interfaces so the IdP can swap at ADR-0002:
 *   - TOKEN_ISSUER / TOKEN_VERIFIER → HmacTokenService (HS256 via node:crypto).
 *   - CLOCK → systemClockSeconds (overridable in tests).
 * Provides the AuthGuard (verify token → principal), the tenant-scoped
 * RefreshTokenRepository, and the RefreshRotationService. Global so guards can
 * be applied anywhere. Depends on PrismaModule + TenantContextModule (global).
 */
import { Global, Module } from "@nestjs/common";

import { PrismaModule } from "../prisma/prisma.module";

import { AuthGuard } from "./auth.guard";
import { CLOCK, systemClockSeconds } from "./clock";
import { HmacTokenService } from "./hmac-token.service";
import { RefreshRotationService } from "./refresh-rotation.service";
import { RefreshTokenRepository } from "./refresh-token.repository";
import { TOKEN_ISSUER, TOKEN_VERIFIER } from "./token-contract";

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    HmacTokenService,
    { provide: TOKEN_ISSUER, useExisting: HmacTokenService },
    { provide: TOKEN_VERIFIER, useExisting: HmacTokenService },
    { provide: CLOCK, useValue: systemClockSeconds },
    RefreshTokenRepository,
    RefreshRotationService,
    AuthGuard,
  ],
  exports: [
    TOKEN_ISSUER,
    TOKEN_VERIFIER,
    CLOCK,
    RefreshTokenRepository,
    RefreshRotationService,
    AuthGuard,
  ],
})
export class AuthModule {}
