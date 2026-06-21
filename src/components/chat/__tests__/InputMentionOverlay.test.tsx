import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { NATIVE_EMOJI_STYLE_VERSION } from "@/lib/emoji";
import { InputMentionOverlay } from "../InputMentionOverlay";

vi.mock("@/hooks/useCustomEmojiLookup", () => ({
  useCustomEmojiLookup: () => ({
    "bbb80f56-387b-42d7-bb30-e0d38a072485": {
      id: "bbb80f56-387b-42d7-bb30-e0d38a072485",
      user_id: "user-1",
      shortcode: "sly_cooper",
      prompt: "Sly Cooper",
      status: "ready",
      image_url: "/api/emojis/assets/bbb80f56-387b-42d7-bb30-e0d38a072485",
      content_type: "image/png",
      size_bytes: 2048,
      created_at: "2026-06-20T15:33:09.144Z",
      updated_at: "2026-06-20T15:35:00.000Z",
      error_message: null,
      token: "<:sly_cooper:bbb80f56-387b-42d7-bb30-e0d38a072485>",
    },
  }),
}));

describe("InputMentionOverlay", () => {
  it("renders composer custom emoji placeholders in a fixed emoji-sized box", () => {
    const markup = renderToStaticMarkup(
      <InputMentionOverlay
        text={"\uE000"}
        composerCustomEmojiMap={{
          "\uE000": {
            id: "bbb80f56-387b-42d7-bb30-e0d38a072485",
            shortcode: "sly_cooper",
          },
        }}
      />,
    );

    expect(markup).toContain("h-[1.35em] w-[1.35em]");
    expect(markup).toContain("justify-center");
    expect(markup).toContain(":sly_cooper:");
  });

  it("renders mention pills without adding horizontal padding that skews caret alignment", () => {
    const markup = renderToStaticMarkup(
      <InputMentionOverlay text="@ralph" />,
    );

    expect(markup).toContain('data-mention="ralph"');
    expect(markup).toContain("rounded-sm");
    expect(markup).not.toContain("px-1");
  });

  it("renders native emoji characters with the shared asset style inside the composer overlay", () => {
    const markup = renderToStaticMarkup(
      <InputMentionOverlay text="😂" />,
    );

    expect(markup).toContain(`emoji-datasource-twitter@${NATIVE_EMOJI_STYLE_VERSION}`);
  });
});
