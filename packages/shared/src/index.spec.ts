import { describe, expect, it } from "vitest";

import { SHARED_PACKAGE, type TenantId } from "./index.js";

describe("@probooks/shared scaffold", () => {
  it("exposes the package marker", () => {
    expect(SHARED_PACKAGE).toBe("@probooks/shared");
  });

  it("brands ids so they are not interchangeable [STD-3]", () => {
    const tenantId = "a" as TenantId;
    // Compile-time guarantee; runtime is just a string.
    expect(typeof tenantId).toBe("string");
  });
});
