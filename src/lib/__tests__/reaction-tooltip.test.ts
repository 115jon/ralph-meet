import { describe, expect, it } from "vitest";

import {
  formatReactionUserNames,
  getReactionEmojiLabel,
} from "@/lib/reaction-tooltip";
import { getNextReactionEmoji } from "@/lib/reaction-details";

describe("reaction tooltip", () => {
  it("shows up to three names and the remaining participant count", () => {
    expect(
      formatReactionUserNames(["HayHay", "Jon", "Mina", "Priya"], 100),
    ).toBe("HayHay, Jon, Mina +97 people more");
  });

  it("does not add a more suffix when every participant is visible", () => {
    expect(formatReactionUserNames(["HayHay", "Jon"], 2)).toBe("HayHay, Jon");
  });

  it("uses native shortcodes and custom shortcodes as the emoji label", () => {
    expect(getReactionEmojiLabel("✅")).toBe(":white_check_mark:");
    expect(getReactionEmojiLabel("<:party_parrot:emoji-1>")).toBe(
      ":party_parrot:",
    );
  });

  it("keeps the selected emoji when it remains and falls back when it is removed", () => {
    const reactions = [
      { emoji: "✅", count: 1, me: false, users: ["user-1"] },
      { emoji: "❤️", count: 2, me: false, users: ["user-1", "user-2"] },
    ];

    expect(getNextReactionEmoji(reactions, "❤️")).toBe("❤️");
    expect(getNextReactionEmoji(reactions.slice(1), "✅")).toBe("❤️");
    expect(getNextReactionEmoji([], "❤️")).toBeNull();
  });
});
