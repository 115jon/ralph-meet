import { describe, expect, it } from "vitest";

import {
  DisplayNameSchema,
  ProfileIdentityPatchSchema,
  UsernameSchema,
} from "@/lib/validations";

describe("profile identity schemas", () => {
  it("normalizes valid usernames and display names", () => {
    expect(UsernameSchema.parse("  Alice_42 ")).toBe("alice_42");
    expect(DisplayNameSchema.parse("  Alice Display  ")).toBe("Alice Display");
  });

  it("rejects handles outside the supported format", () => {
    expect(UsernameSchema.safeParse("alice smith").success).toBe(false);
    expect(UsernameSchema.safeParse("a").success).toBe(false);
    expect(UsernameSchema.safeParse("a".repeat(33)).success).toBe(false);
  });

  it("accepts identity patches with either field", () => {
    expect(
      ProfileIdentityPatchSchema.parse({ username: "New_Handle" }),
    ).toEqual({ username: "new_handle" });
    expect(
      ProfileIdentityPatchSchema.parse({ displayName: " New Name " }),
    ).toEqual({ displayName: "New Name" });
  });
});
