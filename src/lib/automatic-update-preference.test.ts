import { describe, expect, it } from "vitest";

import { shouldRunAutomaticUpdateCheck } from "./automatic-update-preference";

describe("shouldRunAutomaticUpdateCheck", () => {
  it("runs only when the installer or user preference explicitly enables automatic checks", () => {
    expect(shouldRunAutomaticUpdateCheck(true)).toBe(true);
    expect(shouldRunAutomaticUpdateCheck(false)).toBe(false);
    expect(shouldRunAutomaticUpdateCheck(null)).toBe(false);
  });
});
