import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type EmojiRecentItem, resolveNativeEmojiShortcode, toNativeEmojiRecentItem } from "../emoji";
import { getQuickReactionItems, rememberRecentReaction } from "../message-reaction-recents";

describe("message reaction recents", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};

    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
        removeItem: (key: string) => {
          delete store[key];
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a fallback quick reaction set when recents are empty", () => {
    const items = getQuickReactionItems();

    expect(items).toHaveLength(5);
    expect(items.every((item) => item.type === "native")).toBe(true);
  });

  it("prioritizes recent emoji while filling remaining slots with fallback reactions", () => {
    const joy = resolveNativeEmojiShortcode("joy");
    if (!joy) {
      throw new Error("Expected joy emoji to exist in test catalog");
    }

    rememberRecentReaction(toNativeEmojiRecentItem(joy));

    const items = getQuickReactionItems();

    expect(items[0].id).toBe(joy.id);
    expect(items).toHaveLength(5);
  });

  it("preserves recent custom emoji entries in the quick reaction row", () => {
    const custom: EmojiRecentItem = {
      type: "custom",
      id: "emoji-1",
      shortcode: "party_blob",
      native: null,
      imageUrl: "/api/emojis/assets/emoji-1",
      insertText: "<:party_blob:emoji-1>",
      label: ":party_blob:",
      prompt: "Party blob",
    };

    rememberRecentReaction(custom);

    const items = getQuickReactionItems();

    expect(items[0]).toMatchObject(custom);
    expect(items).toHaveLength(5);
  });
});
