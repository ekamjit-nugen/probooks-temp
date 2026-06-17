/**
 * Typed config accessor (STANDARDS §17). The only sanctioned way for the rest
 * of the app to read configuration — no `process.env` elsewhere.
 */
import { Injectable } from "@nestjs/common";

import type { AppConfig } from "./env.schema";

/** Thrown when an optional-at-boot config value is required at point of use. */
export class MissingConfigError extends Error {
  override readonly name = "MissingConfigError";

  constructor(public readonly key: keyof AppConfig) {
    super(`Required configuration "${String(key)}" is not set`);
  }
}

@Injectable()
export class AppConfigService {
  constructor(private readonly config: AppConfig) {}

  /** Read a single typed config value. */
  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key];
  }

  /**
   * Read a value that is optional at boot but required at point of use (e.g.
   * DATABASE_URL when PrismaService connects). Fails fast with a named error
   * rather than passing `undefined` into a driver (STANDARDS §17).
   */
  getRequired<K extends keyof AppConfig>(key: K): NonNullable<AppConfig[K]> {
    const value = this.config[key];
    if (value === undefined || value === null) {
      throw new MissingConfigError(key);
    }
    return value as NonNullable<AppConfig[K]>;
  }

  /** The whole validated config (read-only). */
  get all(): AppConfig {
    return this.config;
  }
}
