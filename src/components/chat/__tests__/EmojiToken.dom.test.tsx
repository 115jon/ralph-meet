// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import EmojiToken from "../EmojiToken";

describe("EmojiToken DOM rendering", () => {
  it("falls back to the native glyph when a native emoji asset fails to load", () => {
    render(<EmojiToken value="😂" />);

    fireEvent.error(screen.getByAltText(":joy:"));

    expect(screen.getByText("😂")).toBeInTheDocument();
    expect(screen.queryByAltText(":joy:")).not.toBeInTheDocument();
  });

  it("falls back to shortcode text when a custom emoji asset fails to load", () => {
    render(
      <EmojiToken
        value="<:party_blob:emoji-123>"
        customEmojiMap={{
          "emoji-123": {
            image_url: "/api/emojis/assets/emoji-123",
          },
        }}
      />,
    );

    fireEvent.error(screen.getByAltText(":party_blob:"));

    expect(screen.getByText(":party_blob:")).toBeInTheDocument();
    expect(screen.queryByAltText(":party_blob:")).not.toBeInTheDocument();
  });
});
