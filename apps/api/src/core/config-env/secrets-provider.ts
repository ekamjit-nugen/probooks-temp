/**
 * SecretsProvider abstraction (STANDARDS §17).
 *
 * Local/dev/test resolve secrets from environment variables. The AWS Secrets
 * Manager / Parameter Store implementation is deferred to Wave 7 — only a
 * clearly-named stub exists here so the seam is visible.
 */
import { Injectable } from "@nestjs/common";

/** Resolves named secrets. Async so the AWS impl (Wave 7) can fit the same shape. */
export interface SecretsProvider {
  get(name: string): Promise<string>;
}

/** DI token for the active SecretsProvider implementation. */
export const SECRETS_PROVIDER = Symbol("SECRETS_PROVIDER");

/** Thrown when a requested secret is absent. Names the key, never a value. */
export class MissingSecretError extends Error {
  override readonly name = "MissingSecretError";

  constructor(public readonly secretName: string) {
    super(`Missing required secret: ${secretName}`);
  }
}

/** Environment-variable-backed provider for local/dev/test (STANDARDS §17). */
@Injectable()
export class EnvSecretsProvider implements SecretsProvider {
  constructor(private readonly source: Record<string, string | undefined>) {}

  get(name: string): Promise<string> {
    const value = this.source[name];
    if (value === undefined || value === "") {
      return Promise.reject(new MissingSecretError(name));
    }
    return Promise.resolve(value);
  }
}

/**
 * Deferred AWS Secrets Manager / Parameter Store provider (STANDARDS §17).
 * Implementation lands in Wave 7 when the AWS account is provisioned.
 */
@Injectable()
export class AwsSecretsProvider implements SecretsProvider {
  get(name: string): Promise<string> {
    return Promise.reject(
      new Error(
        `AwsSecretsProvider.get('${name}') is not implemented until Wave 7 (AWS Secrets Manager).`,
      ),
    );
  }
}
