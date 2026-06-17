import { describe, expect, it } from "vitest";

import {
  CLIENT_ROLES,
  isClientRole,
  UserRoleSchema,
  type UserRole,
} from "./roles.js";

describe("@probooks/shared roles [SPEC §1][INV-AUTH-3]", () => {
  it("accepts the five canonical principal roles", () => {
    const roles: UserRole[] = [
      "platform_operator",
      "firm_admin",
      "accountant",
      "client_owner",
      "client_staff",
    ];
    for (const role of roles) {
      expect(UserRoleSchema.parse(role)).toBe(role);
    }
  });

  it("rejects an unknown role", () => {
    expect(UserRoleSchema.safeParse("root").success).toBe(false);
  });

  it("classifies client-scoped roles [INV-AUTH-3]", () => {
    expect(isClientRole("client_owner")).toBe(true);
    expect(isClientRole("client_staff")).toBe(true);
    expect(isClientRole("accountant")).toBe(false);
    expect(isClientRole("firm_admin")).toBe(false);
    expect(isClientRole("platform_operator")).toBe(false);
  });

  it("lists both client roles in CLIENT_ROLES", () => {
    expect(CLIENT_ROLES).toContain("client_owner");
    expect(CLIENT_ROLES).toContain("client_staff");
    expect(CLIENT_ROLES).toHaveLength(2);
  });
});
