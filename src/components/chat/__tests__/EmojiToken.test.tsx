import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import EmojiToken from "../EmojiToken";
import { NATIVE_EMOJI_STYLE_VERSION } from "@/lib/emoji";

describe("EmojiToken selection rendering", () => {
  it("renders native emoji with selectable text backing when requested", () => {
    const markup = renderToStaticMarkup(
      <EmojiToken value="😂" selectable />,
    );

    expect(markup).toContain("select-text");
    expect(markup).toContain("text-transparent");
    expect(markup).toContain(`emoji-datasource-twitter@${NATIVE_EMOJI_STYLE_VERSION}`);
    expect(markup).toContain("😂");
  });

  it("renders custom emoji with shortcode backing text when selectable", () => {
    const markup = renderToStaticMarkup(
      <EmojiToken
        value="<:party_blob:emoji-123>"
        selectable
        customEmojiMap={{
          "emoji-123": {
            image_url: "/api/emojis/assets/emoji-123",
          },
        }}
      />,
    );

    expect(markup).toContain("select-text");
    expect(markup).toContain(":party_blob:");
    expect(markup).toContain("/api/emojis/assets/emoji-123");
  });
});
