import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { safeParse } from "@/lib/schema";

import {
  DisplayNameSchema,
  ProfileIdentityPatchSchema,
  UsernameSchema,
} from "@/lib/validations";

const parse = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown,
) => Schema.decodeUnknownSync(schema)(value);

describe("profile identity schemas", () => {
  it("normalizes valid usernames and display names", () => {
    expect(parse(UsernameSchema, "  Alice_42 ")).toBe("alice_42");
    expect(parse(DisplayNameSchema, "  Alice Display  ")).toBe("Alice Display");
  });

  it("rejects handles outside the supported format", () => {
    expect(safeParse(UsernameSchema, "alice smith").success).toBe(false);
    expect(safeParse(UsernameSchema, "a").success).toBe(false);
    expect(safeParse(UsernameSchema, "a".repeat(33)).success).toBe(false);
  });

  it("accepts identity patches with either field", () => {
    expect(
      parse(ProfileIdentityPatchSchema, { username: "New_Handle" }),
    ).toEqual({ username: "new_handle" });
    expect(
      parse(ProfileIdentityPatchSchema, { displayName: " New Name " }),
    ).toEqual({ displayName: "New Name" });
  });
});
