/**
 * @Idempotent — opt a state-creating POST route into HTTP idempotency handling
 * (STANDARDS §7.4). Mirrors the project's metadata-decorator convention
 * (cf. @RequireRole / @RequirePermission in core/rbac). The Idempotency
 * interceptor only activates on routes carrying this metadata, so applying the
 * interceptor broadly is safe — unmarked routes pass straight through.
 */
import { SetMetadata, type CustomDecorator } from "@nestjs/common";

/** Reflector metadata key set by @Idempotent. */
export const IDEMPOTENT_METADATA_KEY = "probooks:idempotent";

/** The header that carries the client's idempotency key (a UUID), §7.4. */
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

/** Mark a POST route as idempotency-aware (accepts an Idempotency-Key header). */
export function Idempotent(): CustomDecorator {
  return SetMetadata(IDEMPOTENT_METADATA_KEY, true);
}
