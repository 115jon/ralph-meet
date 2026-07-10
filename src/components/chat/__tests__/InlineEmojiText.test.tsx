import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { NATIVE_EMOJI_STYLE_VERSION } from "@/lib/emoji";
import InlineEmojiText from "../InlineEmojiText";

vi.mock("@/hooks/useCustomEmojiLookup", () => ({
  useCustomEmojiLookup: (ids: string[]) =>
    ids.includes("emoji-123")
      ? {
          "emoji-123": {
            image_url: "/api/emojis/assets/emoji-123",
          },
        }
      : {},
}));

describe("InlineEmojiText", () => {
  it("renders native emoji with the shared emoji asset styling", () => {
    const markup = renderToStaticMarkup(<InlineEmojiText text="「✨」chat" />);

    expect(markup).toContain(
      `emoji-datasource-twitter@${NATIVE_EMOJI_STYLE_VERSION}`,
    );
    expect(markup).not.toContain("「✨」chat");
  });

  it("renders custom emoji tokens through EmojiToken", () => {
    const markup = renderToStaticMarkup(
      <InlineEmojiText text="ship it <:party_blob:emoji-123>" />,
    );

    expect(markup).toContain("/api/emojis/assets/emoji-123");
    expect(markup).not.toContain("&lt;:party_blob:emoji-123&gt;");
  });
});
