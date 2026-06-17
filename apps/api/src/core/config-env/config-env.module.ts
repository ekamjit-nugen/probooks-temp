/**
 * ConfigEnvModule (STANDARDS §17). Validates the environment ONCE at module
 * construction (fail-fast at boot) and exposes the typed AppConfigService plus
 * the active SecretsProvider. Global so any module can inject without re-import.
 */
import { Global, Module } from "@nestjs/common";

import { AppConfigService } from "./app-config.service";
import { parseEnv, type AppConfig } from "./env.schema";
import { EnvSecretsProvider, SECRETS_PROVIDER } from "./secrets-provider";

@Global()
@Module({
  providers: [
    {
      provide: AppConfigService,
      useFactory: (): AppConfigService => {
        // Single sanctioned process.env read (STANDARDS §17). Fails fast if invalid.
        const config: AppConfig = parseEnv(process.env);
        return new AppConfigService(config);
      },
    },
    {
      provide: SECRETS_PROVIDER,
      useFactory: (): EnvSecretsProvider => new EnvSecretsProvider(process.env),
    },
  ],
  exports: [AppConfigService, SECRETS_PROVIDER],
})
export class ConfigEnvModule {}
