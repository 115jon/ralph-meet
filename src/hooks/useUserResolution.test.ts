import { describe, expect, it } from "vitest";
import { findCachedMember } from "./useUserResolution";

describe("findCachedMember", () => {
  it("returns the active-server member without flattening caches", () => {
    const active = { user: { id: "a" } };
    const other = { user: { id: "b" } };

    expect(findCachedMember([active], { "server-2": [other] }, "a")).toBe(
      active,
    );
  });

  it("walks cached servers without allocating a flattened array", () => {
    const cached = { user: { id: "b" } };

    expect(
      findCachedMember([], { "server-2": [cached], "server-3": [] }, "b"),
    ).toBe(cached);
  });

  it("returns undefined when the user is missing", () => {
    expect(
      findCachedMember([{ user: { id: "a" } }], { "server-2": [] }, "z"),
    ).toBeUndefined();
  });
});
