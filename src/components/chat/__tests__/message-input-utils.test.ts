import { describe, expect, it } from "vitest";

import {
  allocateComposerCustomEmojiPlaceholder,
  expandComposerCustomEmojiPlaceholders,
  pruneComposerCustomEmojiMap,
  replaceTextRange,
} from "../message-input-utils";

describe("message input utils", () => {
  it("inserts text at the requested range", () => {
    expect(replaceTextRange("hello", ":joy:", 0, 0)).toEqual({
      value: ":joy:hello",
      cursor: 5,
    });
    expect(replaceTextRange("hello", " world", 5, 5)).toEqual({
      value: "hello world",
      cursor: 11,
    });
  });

  it("replaces the selected range", () => {
    expect(replaceTextRange("hello world", "@ralph ", 6, 11)).toEqual({
      value: "hello @ralph ",
      cursor: 13,
    });
  });

  it("allocates placeholder characters for composer custom emoji", () => {
    const placeholder = allocateComposerCustomEmojiPlaceholder("hey", {});

    expect(placeholder.charCodeAt(0)).toBeGreaterThanOrEqual(0xe000);
    expect(placeholder.charCodeAt(0)).toBeLessThanOrEqual(0xf8ff);
  });

  it("expands mapped custom emoji placeholders into stored tokens", () => {
    const placeholder = "\uE000";

    expect(expandComposerCustomEmojiPlaceholders(`hey ${placeholder}`, {
      [placeholder]: {
        id: "bbb80f56-387b-42d7-bb30-e0d38a072485",
        shortcode: "sly_cooper",
      },
    })).toBe("hey <:sly_cooper:bbb80f56-387b-42d7-bb30-e0d38a072485>");
  });

  it("prunes custom emoji entries that are no longer present in the composer", () => {
    expect(pruneComposerCustomEmojiMap("hello", {
      "\uE000": {
        id: "bbb80f56-387b-42d7-bb30-e0d38a072485",
        shortcode: "sly_cooper",
      },
    })).toEqual({});
  });
});
