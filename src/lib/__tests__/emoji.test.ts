import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCustomEmojiToken,
  buildNativeEmojiAssetUrl,
  extractCustomEmojiIds,
  getNativeEmojiCategories,
  EMOJI_RECENTS_STORAGE_KEY,
  loadEmojiRecents,
  parseCustomEmojiToken,
  rememberRecentEmoji,
  resolveNativeEmojiShortcode,
  searchNativeEmojis,
  splitTextByNativeEmoji,
  toNativeEmojiRecentItem,
} from "../emoji";

describe("emoji helpers", () => {
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

  it("resolves native shortcodes from the emoji catalog", () => {
    const emoji = resolveNativeEmojiShortcode("joy");

    expect(emoji).not.toBeNull();
    expect(emoji?.native).toBe("😂");
    expect(emoji?.imageUrl).toBe(buildNativeEmojiAssetUrl("1f602"));
  });

  it("searches the emoji catalog by shortcode and keywords", () => {
    const results = searchNativeEmojis("pizza");

    expect(
      results.some(
        (emoji) =>
          emoji.preferredShortcode === "pizza" ||
          emoji.shortcodes.includes("pizza"),
      ),
    ).toBe(true);
  });

  it("exposes curated category labels and icons for the picker", () => {
    const categories = getNativeEmojiCategories();
    const food = categories.find(
      (category) => category.label === "Food & Drink",
    );

    expect(food?.label).toBe("Food & Drink");
    expect(food?.iconShortcode).toBe("pizza");
  });

  it("builds discord-style custom emoji tokens", () => {
    expect(buildCustomEmojiToken("party_blob", "emoji-123")).toBe(
      "<:party_blob:emoji-123>",
    );
  });

  it("extracts custom emoji ids from message text", () => {
    expect(
      extractCustomEmojiIds("hi <:party_blob:one> and <:spark_pizza:two>"),
    ).toEqual(["one", "two"]);
  });

  it("parses custom emoji tokens", () => {
    expect(parseCustomEmojiToken("<:party_blob:emoji-123>")).toEqual({
      shortcode: "party_blob",
      id: "emoji-123",
    });
  });

  it("splits plain text into native emoji-aware segments", () => {
    expect(splitTextByNativeEmoji("wow 😂 pizza")).toEqual([
      { type: "text", value: "wow " },
      expect.objectContaining({ type: "emoji", value: "😂" }),
      { type: "text", value: " pizza" },
    ]);
  });

  it("matches emoji values even when the source omits an optional variation selector", () => {
    expect(splitTextByNativeEmoji("dirty house🏚")).toEqual([
      { type: "text", value: "dirty house" },
      expect.objectContaining({ type: "emoji", value: "🏚" }),
    ]);
  });

  it("stores recent emoji selections with deduplication", () => {
    const joy = resolveNativeEmojiShortcode("joy");
    const pizza = resolveNativeEmojiShortcode("pizza");
    if (!joy || !pizza) {
      throw new Error("Expected joy and pizza emoji to exist in test catalog");
    }

    rememberRecentEmoji(toNativeEmojiRecentItem(joy));
    rememberRecentEmoji(toNativeEmojiRecentItem(pizza));
    rememberRecentEmoji(toNativeEmojiRecentItem(joy));

    const recents = loadEmojiRecents();

    expect(recents).toHaveLength(2);
    expect(recents[0].id).toBe(joy.id);
    expect(recents[1].id).toBe(pizza.id);
  });

  it("returns a stable snapshot when emoji recents have not changed", () => {
    expect(loadEmojiRecents()).toBe(loadEmojiRecents());
  });

  describe("stored recents", () => {
    const valid = {
      type: "custom",
      id: "e1",
      shortcode: "party",
      native: null,
      imageUrl: "https://cdn.test/e1.png",
      insertText: ":party:",
      label: "party",
    };

    function seed(raw: string | null) {
      const store = window.localStorage as unknown as {
        setItem: (k: string, v: string) => void;
        removeItem: (k: string) => void;
      };
      if (raw === null) store.removeItem(EMOJI_RECENTS_STORAGE_KEY);
      else store.setItem(EMOJI_RECENTS_STORAGE_KEY, raw);
    }

    it("fills the optional fields of an entry saved without them", () => {
      seed(
        JSON.stringify([
          {
            type: "native",
            id: "joy",
            shortcode: "joy",
            insertText: "x",
            label: "joy",
          },
        ]),
      );

      expect(loadEmojiRecents()).toEqual([
        {
          type: "native",
          id: "joy",
          shortcode: "joy",
          native: null,
          imageUrl: null,
          insertText: "x",
          label: "joy",
        },
      ]);
    });

    it("drops entries that are malformed and keeps the rest", () => {
      seed(
        JSON.stringify([
          valid,
          null,
          "joy",
          { ...valid, id: 9 },
          { ...valid, type: "gif" },
          { ...valid, id: "e2", native: 5, imageUrl: ["x"] },
        ]),
      );

      expect(loadEmojiRecents().map((item) => item.id)).toEqual(["e1", "e2"]);
      expect(loadEmojiRecents()[1]).toMatchObject({
        native: null,
        imageUrl: null,
      });
    });

    it.each(["{not json", "null", '{"a":1}', '"text"', ""])(
      "is empty when the stored text is %j",
      (raw) => {
        seed(raw);
        expect(loadEmojiRecents()).toEqual([]);
      },
    );
  });
});
