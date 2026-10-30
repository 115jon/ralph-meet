import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { NATIVE_EMOJI_STYLE_VERSION } from "@/lib/emoji";
import {
  composerPrompt,
  MessageInputPlaceholder,
} from "../MessageInputPlaceholder";

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

  it("addresses a person in a DM: Message @Name, not #Name", () => {
    const markup = renderToStaticMarkup(
      <MessageInputPlaceholder
        channelName="Ada Lovelace"
        replyDisplayName={null}
        isDM
      />,
    );

    expect(markup).toContain("Message @Ada Lovelace");
    expect(markup).not.toContain("#Ada");
  });

  it("shares one prompt between the placeholder and the field label", () => {
    expect(
      composerPrompt({ channelName: "general", replyDisplayName: null }),
    ).toBe("Message #general");
    expect(
      composerPrompt({
        channelName: "Ada Lovelace",
        replyDisplayName: null,
        isDM: true,
      }),
    ).toBe("Message @Ada Lovelace");
    expect(
      composerPrompt({
        channelName: "Ada Lovelace",
        replyDisplayName: "Grace",
        isDM: true,
      }),
    ).toBe("Reply to Grace…");
  });
});
