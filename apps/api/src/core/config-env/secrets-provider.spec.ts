import {
  AwsSecretsProvider,
  EnvSecretsProvider,
  MissingSecretError,
} from "./secrets-provider";

describe("EnvSecretsProvider [STD-17]", () => {
  it("returns a secret present in the source record", async () => {
    const provider = new EnvSecretsProvider({ SOME_SECRET: "shh" });

    await expect(provider.get("SOME_SECRET")).resolves.toBe("shh");
  });

  it("throws MissingSecretError rather than returning undefined", async () => {
    const provider = new EnvSecretsProvider({});

    await expect(provider.get("ABSENT_SECRET")).rejects.toBeInstanceOf(
      MissingSecretError,
    );
  });

  it("never exposes the secret value in the missing-secret error", async () => {
    const provider = new EnvSecretsProvider({ OTHER: "value" });

    await expect(provider.get("ABSENT_SECRET")).rejects.toThrow(
      "ABSENT_SECRET",
    );
  });
});

describe("AwsSecretsProvider stub [STD-17]", () => {
  it("throws a not-implemented error citing Wave 7", async () => {
    const provider = new AwsSecretsProvider();

    await expect(provider.get("ANY")).rejects.toThrow(/Wave 7/);
  });
});
