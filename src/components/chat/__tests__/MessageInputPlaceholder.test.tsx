import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { NATIVE_EMOJI_STYLE_VERSION } from "@/lib/emoji";
import { MessageInputPlaceholder } from "../MessageInputPlaceholder";

vi.mock("@/hooks/useCustomEmojiLookup", () => ({
  useCustomEmojiLookup: () => ({}),
}));

describe("MessageInputPlaceholder", () => {
  it("renders the channel placeholder with emoji-aware inline content", () => {
    const markup = renderToStaticMarkup(
      <MessageInputPlaceholder
        channelName="「✨」chat"
        replyDisplayName={null}
      />,
    );

    expect(markup).toContain("Message #");
    expect(markup).toContain(
      `emoji-datasource-twitter@${NATIVE_EMOJI_STYLE_VERSION}`,
    );
  });
});
