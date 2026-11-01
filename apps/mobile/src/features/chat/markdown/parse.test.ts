import { describe, expect, it } from "vitest";

import { mentionsViewer } from "./mentions-viewer";
import { parseInline, parseMarkdown, parseMessage } from "./parse";

// Cases mirror src/components/chat/__tests__/MarkdownRenderer.test.tsx and
// the web grammar in MarkdownRenderer.tsx.

describe("parseInline: Discord basics (web cases)", () => {
  it("parses _italic_ and __underline__ but leaves snake_case alone", () => {
    expect(parseInline("an _italic_ word")).toEqual([
      { kind: "text", text: "an " },
      { kind: "italic", children: [{ kind: "text", text: "italic" }] },
      { kind: "text", text: " word" },
    ]);
    expect(parseInline("__under__")).toEqual([
      { kind: "underline", children: [{ kind: "text", text: "under" }] },
    ]);
    expect(parseInline("use snake_case_names")).toEqual([
      { kind: "text", text: "use snake_case_names" },
    ]);
  });

  it("parses ||spoilers|| with their own inline content", () => {
    expect(parseInline("the end: ||it **ships**||")).toEqual([
      { kind: "text", text: "the end: " },
      {
        kind: "spoiler",
        children: [
          { kind: "text", text: "it " },
          { kind: "bold", children: [{ kind: "text", text: "ships" }] },
        ],
      },
    ]);
  });

  it("parses bold, star italic, strike and inline code", () => {
    expect(parseInline("**b** *i* ~~s **x**~~ `a *b*`")).toEqual([
      { kind: "bold", children: [{ kind: "text", text: "b" }] },
      { kind: "text", text: " " },
      { kind: "italic", children: [{ kind: "text", text: "i" }] },
      { kind: "text", text: " " },
      // Strikethrough content stays plain, as on the web.
      { kind: "strike", text: "s **x**" },
      { kind: "text", text: " " },
      { kind: "code", text: "a *b*" },
    ]);
  });

  it("does not treat a lone spaced star as italic", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([
      { kind: "text", text: "2 * 3 = 6" },
    ]);
  });

  it("parses masked links with a plain label", () => {
    expect(parseInline("see [the **docs**](https://example.com/a)")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", text: "the **docs**", url: "https://example.com/a" },
    ]);
  });

  it("auto-links URLs and leaves trailing punctuation as text", () => {
    expect(parseInline("go to https://example.com/x.")).toEqual([
      { kind: "text", text: "go to " },
      { kind: "url", url: "https://example.com/x" },
      { kind: "text", text: "." },
    ]);
  });

  it("parses mentions the web way", () => {
    expect(parseInline("hi @jon_m and @everyone")).toEqual([
      { kind: "text", text: "hi " },
      { kind: "mention", username: "jon_m" },
      { kind: "text", text: " and " },
      { kind: "mention", username: "everyone" },
    ]);
  });

  it("parses still and animated custom emoji", () => {
    expect(parseInline("ship <:party_blob:emoji-123><a:spin:abc>")).toEqual([
      { kind: "text", text: "ship " },
      { kind: "customEmoji", name: "party_blob", id: "emoji-123" },
      { kind: "customEmoji", name: "spin", id: "abc" },
    ]);
  });

  it("resolves native shortcodes and leaves unknown ones literal", () => {
    expect(parseInline("let's go :joy: :not_an_emoji_xyz:")).toEqual([
      { kind: "text", text: "let's go " },
      { kind: "emoji", native: "😂", name: "joy" },
      { kind: "text", text: " :not_an_emoji_xyz:" },
    ]);
  });

  it("keeps markup inside inline code literal", () => {
    expect(parseInline("`@here :joy: **x**`")).toEqual([
      { kind: "code", text: "@here :joy: **x**" },
    ]);
  });
});

describe("parseMarkdown: blocks", () => {
  it("turns > lines into one quote block", () => {
    expect(parseMarkdown("before\n> quoted one\n> quoted two\nafter")).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "before" }] },
      {
        kind: "quote",
        children: [{ kind: "text", text: "quoted one\nquoted two" }],
      },
      { kind: "paragraph", children: [{ kind: "text", text: "after" }] },
    ]);
  });

  it("needs a space after > (or a bare >) to quote", () => {
    expect(parseMarkdown(">nope")).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: ">nope" }] },
    ]);
  });

  it("parses fences with a language line and leaves their content raw", () => {
    expect(parseMarkdown("look:\n```ts\nconst a = **1**;\n```\nnice")).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "look:" }] },
      { kind: "code", language: "ts", code: "const a = **1**;" },
      { kind: "paragraph", children: [{ kind: "text", text: "nice" }] },
    ]);
  });

  it("treats a one-line fence as code with no language", () => {
    expect(parseMarkdown("```hello world```")).toEqual([
      { kind: "code", language: null, code: "hello world" },
    ]);
    expect(parseMarkdown("```js\n```")).toEqual([
      { kind: "code", language: null, code: "js" },
    ]);
  });

  it("leaves an unclosed fence as text", () => {
    expect(parseMarkdown("```oops")).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "```oops" }] },
    ]);
  });

  it("keeps blank lines inside a paragraph but drops a trailing break", () => {
    expect(parseMarkdown("a\n\nb\n")).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "a\n\nb" }] },
    ]);
  });

  it("returns nothing for empty or blank content", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("  \n ")).toEqual([]);
  });
});

describe("parseMessage", () => {
  it("reuses blocks for the same id and content, reparses an edit", () => {
    const first = parseMessage("m1", "**hi**");
    expect(parseMessage("m1", "**hi**")).toBe(first);
    expect(parseMessage("m1", "**hi** there")).not.toBe(first);
  });
});

describe("mentionsViewer (web rule)", () => {
  const viewer = { id: "u1", username: "jon" };
  const message = (content: string, author_id = "u2") => ({
    content,
    author_id,
  });

  it("pings on @username, @everyone and @here", () => {
    expect(mentionsViewer(message("hey @Jon"), viewer)).toBe(true);
    expect(mentionsViewer(message("@everyone look"), viewer)).toBe(true);
    expect(mentionsViewer(message("@here"), viewer)).toBe(true);
  });

  it("ignores emails, longer names and the viewer's own messages", () => {
    expect(mentionsViewer(message("mail a@jon.dev"), viewer)).toBe(false);
    expect(mentionsViewer(message("@jonathan"), viewer)).toBe(false);
    expect(mentionsViewer(message("@jon", "u1"), viewer)).toBe(false);
  });

  it("pings on a reply to the viewer", () => {
    expect(
      mentionsViewer(
        { content: "ok", author_id: "u2", reply_to: { author_id: "u1" } },
        viewer,
      ),
    ).toBe(true);
  });
});
