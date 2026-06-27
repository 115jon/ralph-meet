import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InputControls } from "../InputControls";

describe("InputControls media launchers", () => {
  it("renders direct launcher buttons for gifs and stickers", () => {
    const markup = renderToStaticMarkup(
      <InputControls
        showEmoji={false}
        showGifPicker={false}
        gifPickerMediaType="gifs"
        setLocalState={() => undefined}
        handleEmojiSelect={() => undefined}
        handleGifSelect={async () => undefined}
        canSend={false}
        onSend={() => undefined}
      />
    );

    expect(markup).toContain("Open GIF picker");
    expect(markup).toContain("Open sticker picker");
  });
});
