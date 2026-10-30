import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NATIVE_EMOJI_STYLE_VERSION } from "@/lib/emoji";
import { MarkdownRenderer } from "../MarkdownRenderer";

describe("MarkdownRenderer emoji support", () => {
  it("renders native emoji shortcodes inline", () => {
    const markup = renderToStaticMarkup(
      <MarkdownRenderer content="let's go :joy:" />,
    );

    expect(markup).toContain(
      `emoji-datasource-twitter@${NATIVE_EMOJI_STYLE_VERSION}`,
    );
    expect(markup).not.toContain("let&#x27;s go :joy:");
  });

  it("renders native emoji characters with the shared emoji asset style", () => {
    const markup = renderToStaticMarkup(
      <MarkdownRenderer content="let's go 😂" />,
    );

    expect(markup).toContain(
      `emoji-datasource-twitter@${NATIVE_EMOJI_STYLE_VERSION}`,
    );
    expect(markup).not.toContain("let&#x27;s go 😂");
  });

  it("falls back to readable text for unresolved custom emoji tokens", () => {
    const markup = renderToStaticMarkup(
      <MarkdownRenderer content="ship it <:party_blob:emoji-123>" />,
    );

    expect(markup).toContain(":party_blob:");
  });
});

describe("MarkdownRenderer Discord basics", () => {
  const render = (content: string) =>
    renderToStaticMarkup(<MarkdownRenderer content={content} />);

  it("renders _italic_ and __underline__ but leaves snake_case alone", () => {
    expect(render("an _italic_ word")).toContain("<em>italic</em>");
    expect(render("__under__")).toMatch(/<u[^>]*>under<\/u>/);
    expect(render("use snake_case_names")).toContain("snake_case_names");
  });

  it("hides ||spoilers|| until revealed", () => {
    const markup = render("the end: ||it ships||");
    expect(markup).toContain('aria-label="Spoiler, select to reveal"');
    expect(markup).toContain("text-transparent");
  });

  it("turns > lines into one quote block", () => {
    const markup = render("before\n> quoted one\n> quoted two\nafter");
    expect(markup.match(/before:left-0/g)?.length).toBe(1);
    expect(markup).toContain("quoted one\nquoted two");
  });

  it("wraps long raw URLs anywhere instead of mid-word break-all", () => {
    const markup = render("https://example.com/a-very-long-path");
    expect(markup).toContain("wrap-anywhere");
    expect(markup).not.toContain("break-all");
  });
});
