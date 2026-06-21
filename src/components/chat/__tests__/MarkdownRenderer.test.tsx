import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NATIVE_EMOJI_STYLE_VERSION } from "@/lib/emoji";
import { MarkdownRenderer } from "../MarkdownRenderer";

describe("MarkdownRenderer emoji support", () => {
  it("renders native emoji shortcodes inline", () => {
    const markup = renderToStaticMarkup(
      <MarkdownRenderer content="let's go :joy:" />
    );

    expect(markup).toContain(`emoji-datasource-twitter@${NATIVE_EMOJI_STYLE_VERSION}`);
    expect(markup).not.toContain("let&#x27;s go :joy:");
  });

  it("renders native emoji characters with the shared emoji asset style", () => {
    const markup = renderToStaticMarkup(
      <MarkdownRenderer content="let's go 😂" />
    );

    expect(markup).toContain(`emoji-datasource-twitter@${NATIVE_EMOJI_STYLE_VERSION}`);
    expect(markup).not.toContain("let&#x27;s go 😂");
  });

  it("falls back to readable text for unresolved custom emoji tokens", () => {
    const markup = renderToStaticMarkup(
      <MarkdownRenderer content="ship it <:party_blob:emoji-123>" />
    );

    expect(markup).toContain(":party_blob:");
  });
});
