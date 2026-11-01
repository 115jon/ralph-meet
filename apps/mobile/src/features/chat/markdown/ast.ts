/**
 * Message markdown as data: what `parse.ts` produces and `Markdown.tsx`
 * draws. The grammar is the web's (src/components/chat/MarkdownRenderer.tsx).
 */

export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "spoiler"; readonly children: readonly Inline[] }
  | { readonly kind: "bold"; readonly children: readonly Inline[] }
  | { readonly kind: "underline"; readonly children: readonly Inline[] }
  | { readonly kind: "italic"; readonly children: readonly Inline[] }
  /** The web prints strikethrough content as plain text, unparsed. */
  | { readonly kind: "strike"; readonly text: string }
  /** `[text](url)`: the label is plain text. */
  | { readonly kind: "link"; readonly text: string; readonly url: string }
  /** A bare http(s) URL, trailing punctuation already left outside. */
  | { readonly kind: "url"; readonly url: string }
  /** `<:name:id>` or `<a:name:id>`, drawn from `/api/emojis/assets/:id`. */
  | {
      readonly kind: "customEmoji";
      readonly name: string;
      readonly id: string;
    }
  /** A `:shortcode:` that names a Unicode emoji. */
  | { readonly kind: "emoji"; readonly native: string; readonly name: string }
  | { readonly kind: "mention"; readonly username: string };

export type Block =
  | { readonly kind: "paragraph"; readonly children: readonly Inline[] }
  /** A run of `> ` lines. */
  | { readonly kind: "quote"; readonly children: readonly Inline[] }
  /** A ``` fence; `language` is its first line when that is one word. */
  | {
      readonly kind: "code";
      readonly language: string | null;
      readonly code: string;
    };
