import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InputControls } from "../InputControls";

/** Every class token in rendered markup. */
const classTokens = (markup: string) =>
  [...markup.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(" "));

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
      />,
    );

    expect(markup).toContain("Open GIF picker");
    expect(markup).toContain("Open sticker picker");
  });

  it("reveals the phone send button with opacity and scale, never width", () => {
    const render = (canSend: boolean) =>
      renderToStaticMarkup(
        <InputControls
          showEmoji={false}
          showGifPicker={false}
          gifPickerMediaType="gifs"
          setLocalState={() => undefined}
          handleEmojiSelect={() => undefined}
          handleGifSelect={async () => undefined}
          canSend={canSend}
          onSend={() => undefined}
        />,
      );

    const hidden = render(false);
    expect(hidden).toContain("opacity-0");
    expect(hidden).toContain("scale-90");
    expect(classTokens(hidden)).not.toContain("w-0");

    const shown = render(true);
    expect(shown).toContain("opacity-100");
    expect(classTokens(shown)).not.toContain("w-8");
  });
});
