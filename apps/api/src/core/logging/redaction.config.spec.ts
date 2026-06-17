import {
  REDACTION_PATHS,
  REDACTION_CENSOR,
  buildRedaction,
} from "./redaction.config";

describe("redaction config [STD-13]", () => {
  it("censors with [REDACTED]", () => {
    expect(REDACTION_CENSOR).toBe("[REDACTED]");
  });

  it("targets PII fields: emails, business numbers, names, document contents", () => {
    const joined = REDACTION_PATHS.join(" ");
    expect(joined).toMatch(/email/i);
    expect(joined).toMatch(/businessNumber/i);
    expect(joined).toMatch(/name/i);
    expect(joined).toMatch(/documentContents/i);
  });

  it("builds a pino redact object with paths and censor", () => {
    const redact = buildRedaction();
    expect(redact.censor).toBe("[REDACTED]");
    expect(Array.isArray(redact.paths)).toBe(true);
    expect(redact.paths.length).toBeGreaterThan(0);
  });

  it("covers both top-level and nested (req/payload) occurrences of a field", () => {
    const redact = buildRedaction();
    const emailPaths = redact.paths.filter((p) =>
      p.toLowerCase().includes("email"),
    );
    // at least a bare path and a nested wildcard path
    expect(emailPaths.length).toBeGreaterThanOrEqual(2);
  });
});
