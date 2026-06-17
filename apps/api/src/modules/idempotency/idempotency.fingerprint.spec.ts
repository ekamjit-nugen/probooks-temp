/**
 * Unit tests for request fingerprinting (STANDARDS §7.4). Derived from the
 * fingerprint scenarios in idempotency.feature.
 */
import {
  computeRequestFingerprint,
  computeResponseHash,
} from "./idempotency.fingerprint";

describe("computeRequestFingerprint [STD-7.4]", () => {
  it("is stable for the same method, path and body", () => {
    const a = computeRequestFingerprint({
      method: "POST",
      path: "/v1/things",
      body: { a: 1, b: 2 },
    });
    const b = computeRequestFingerprint({
      method: "POST",
      path: "/v1/things",
      body: { a: 1, b: 2 },
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores body key order", () => {
    const a = computeRequestFingerprint({
      method: "POST",
      path: "/v1/things",
      body: { a: 1, b: 2 },
    });
    const b = computeRequestFingerprint({
      method: "POST",
      path: "/v1/things",
      body: { b: 2, a: 1 },
    });
    expect(a).toBe(b);
  });

  it("ignores nested key order too", () => {
    const a = computeRequestFingerprint({
      method: "POST",
      path: "/p",
      body: { outer: { x: 1, y: 2 }, list: [{ m: 1, n: 2 }] },
    });
    const b = computeRequestFingerprint({
      method: "POST",
      path: "/p",
      body: { list: [{ n: 2, m: 1 }], outer: { y: 2, x: 1 } },
    });
    expect(a).toBe(b);
  });

  it("differs when the body differs", () => {
    const a = computeRequestFingerprint({
      method: "POST",
      path: "/p",
      body: { a: 1 },
    });
    const b = computeRequestFingerprint({
      method: "POST",
      path: "/p",
      body: { a: 2 },
    });
    expect(a).not.toBe(b);
  });

  it("differs when the path differs", () => {
    const a = computeRequestFingerprint({
      method: "POST",
      path: "/v1/things",
      body: { a: 1 },
    });
    const b = computeRequestFingerprint({
      method: "POST",
      path: "/v1/others",
      body: { a: 1 },
    });
    expect(a).not.toBe(b);
  });

  it("preserves array order (order is significant in a list)", () => {
    const a = computeRequestFingerprint({
      method: "POST",
      path: "/p",
      body: [1, 2],
    });
    const b = computeRequestFingerprint({
      method: "POST",
      path: "/p",
      body: [2, 1],
    });
    expect(a).not.toBe(b);
  });

  it("treats method case-insensitively", () => {
    const a = computeRequestFingerprint({
      method: "post",
      path: "/p",
      body: {},
    });
    const b = computeRequestFingerprint({
      method: "POST",
      path: "/p",
      body: {},
    });
    expect(a).toBe(b);
  });
});

describe("computeResponseHash [STD-7.4]", () => {
  it("is stable and key-order independent", () => {
    expect(computeResponseHash({ id: "x", n: 1 })).toBe(
      computeResponseHash({ n: 1, id: "x" }),
    );
  });
});
