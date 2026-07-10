import { describe, expect, it } from "vitest";

import { getDemoChatCharacterCounter } from "./demo-chat-limits";

describe("getDemoChatCharacterCounter", () => {
  it("returns remaining characters for demo chat messages", () => {
    expect(getDemoChatCharacterCounter("hello", 10)).toEqual({
      remaining: 5,
      label: "5 characters left",
    });
  });

  it("uses singular copy for one remaining character", () => {
    expect(getDemoChatCharacterCounter("1234", 5).label).toBe(
      "1 character left",
    );
  });
});
