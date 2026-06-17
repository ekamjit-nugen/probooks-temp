import { describe, expect, it } from "vitest";

import {
  API_VERSION,
  ErrorEnvelopeSchema,
  ResponseMetaSchema,
  errorEnvelope,
  successEnvelope,
} from "./response-envelope.js";

describe("response envelope [STD-7.1]", () => {
  describe("successEnvelope", () => {
    it("wraps a payload with meta", () => {
      const meta = { requestId: "req-1", version: API_VERSION } as const;

      const env = successEnvelope({ id: "x" }, meta);

      expect(env).toEqual({ data: { id: "x" }, meta });
      expect(ResponseMetaSchema.safeParse(env.meta).success).toBe(true);
    });
  });

  describe("errorEnvelope", () => {
    it("produces the §7.1 error shape without details when omitted", () => {
      const env = errorEnvelope({
        code: "FLAG_ALREADY_CLEARED",
        message: "Flag already cleared.",
        requestId: "req-2",
      });

      expect(ErrorEnvelopeSchema.safeParse(env).success).toBe(true);
      expect(env.error.details).toBeUndefined();
      expect(env.error.requestId).toBe("req-2");
    });

    it("includes structured details when provided", () => {
      const env = errorEnvelope({
        code: "VALIDATION_FAILED",
        message: "Invalid input.",
        requestId: "req-3",
        details: { age: "must be >= 0" },
      });

      expect(env.error.details).toEqual({ age: "must be >= 0" });
      expect(ErrorEnvelopeSchema.safeParse(env).success).toBe(true);
    });
  });

  describe("ErrorEnvelopeSchema", () => {
    it("rejects a lowercase error code", () => {
      const result = ErrorEnvelopeSchema.safeParse({
        error: { code: "bad_code", message: "x", requestId: "r" },
      });

      expect(result.success).toBe(false);
    });
  });
});
