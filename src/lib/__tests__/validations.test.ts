import { describe, expect, it } from "vitest";

import { sanitizeChannelName } from "@/lib/validations";

describe("sanitizeChannelName", () => {
  it("preserves decorative unicode in text channel names", () => {
    expect(sanitizeChannelName("「✨」chat", "text")).toBe("「✨」chat");
    expect(sanitizeChannelName("「✨」chat", "text", true)).toBe("「✨」chat");
  });

  it("still normalizes text-channel whitespace into hyphens", () => {
    expect(sanitizeChannelName("My Cool Channel!!!", "text", true)).toBe("my-cool-channel!!!");
  });
});
