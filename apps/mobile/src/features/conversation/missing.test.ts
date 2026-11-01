import { describe, expect, it } from "vitest";

import { checkMissing } from "./missing";

describe("checkMissing", () => {
  it("does nothing while the list is not loaded", () => {
    expect(checkMissing(false, null, "a")).toEqual({
      seen: false,
      close: false,
    });
    expect(checkMissing(true, null, "a")).toEqual({ seen: true, close: false });
  });

  it("marks a conversation seen once it is listed", () => {
    expect(checkMissing(false, "x,a", "a")).toEqual({
      seen: true,
      close: false,
    });
  });

  it("never closes one that was not seen yet", () => {
    expect(checkMissing(false, "x,y", "a")).toEqual({
      seen: false,
      close: false,
    });
    expect(checkMissing(false, "", "a")).toEqual({ seen: false, close: false });
  });

  it("closes one that was seen and is now gone", () => {
    expect(checkMissing(true, "x,y", "a")).toEqual({ seen: true, close: true });
    expect(checkMissing(true, "", "a")).toEqual({ seen: true, close: true });
  });
});
