import { describe, expect, it } from "vitest";

import { getStandaloneUpdaterStatusText } from "../StandaloneUpdater";

describe("getStandaloneUpdaterStatusText", () => {
  it("shows a startup message after update checks finish with no update", () => {
    expect(getStandaloneUpdaterStatusText("starting", 0)).toBe("Starting Ralph Meet...");
  });
});
