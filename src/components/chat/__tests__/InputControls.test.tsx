import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { InputControls } from "../InputControls";

/** Every class token in rendered markup. */
const classTokens = (markup: string) =>
  [...markup.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(" "));

describe("InputControls media launchers", () => {
  it("renders direct launcher buttons for gifs and stickers", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
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
      </TooltipProvider>,
    );

    expect(markup).toContain("Open GIF picker");
    expect(markup).toContain("Open sticker picker");
    expect(markup).toContain("Open emoji picker");
  });

  it("uses 48px slot keys, a silkscreen GIF word, and tints the open picker", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <InputControls
          showEmoji
          showGifPicker={false}
          gifPickerMediaType="gifs"
          setLocalState={() => undefined}
          handleEmojiSelect={() => undefined}
          handleGifSelect={async () => undefined}
          canSend={false}
          onSend={() => undefined}
        />
      </TooltipProvider>,
    );

    const open = markup.match(
      /<button[^>]*aria-label="Open emoji picker"[^>]*>/,
    );
    expect(open?.[0]).toContain('data-tone="toggled"');
    expect(open?.[0]).toContain("size-12");
    const idle = markup.match(/<button[^>]*aria-label="Open GIF picker"[^>]*>/);
    expect(idle?.[0]).toContain('data-tone="idle"');
    expect(idle?.[0]).toContain("silkscreen");
    expect(idle?.[0]).toContain("h-12");
    expect(markup).toMatch(/aria-label="Open GIF picker"[^>]*>GIF<\/button>/);
    // The open picker's glyph switches to Fill.
    expect(markup).toMatch(
      /aria-label="Open emoji picker"[^>]*>\s*<svg[^>]*data-state="active"/,
    );
    expect(classTokens(markup)).not.toContain("bg-rm-tint-1");
  });

  it("on phones, swaps the GIF key for send once there is text (no dead slot)", () => {
    const render = (canSend: boolean) =>
      renderToStaticMarkup(
        <TooltipProvider>
          <InputControls
            showEmoji={false}
            showGifPicker={false}
            gifPickerMediaType="gifs"
            setLocalState={() => undefined}
            handleEmojiSelect={() => undefined}
            handleGifSelect={async () => undefined}
            canSend={canSend}
            onSend={() => undefined}
          />
        </TooltipProvider>,
      );

    const gifClasses = (markup: string) =>
      classTokens(
        markup.match(/<button[^>]*aria-label="Open GIF picker"[^>]*>/)![0],
      );

    // Nothing to send: no send key at all, the GIF key ends the row.
    const empty = render(false);
    expect(empty).not.toContain('aria-label="Send message"');
    expect(gifClasses(empty)).not.toContain("max-md:hidden");

    // Text typed: send appears (phones only) and takes the GIF key's slot.
    const typed = render(true);
    expect(typed).toContain('aria-label="Send message"');
    expect(gifClasses(typed)).toContain("max-md:hidden");
    expect(gifClasses(typed)).toContain("max-md:w-12");
  });
});
