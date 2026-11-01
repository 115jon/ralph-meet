export type ContentPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "mention"; readonly text: string; readonly name: string }
  | { readonly kind: "link"; readonly text: string; readonly url: string }
  /** A custom emoji, `<:name:id>`, printed as `:name:` for now. */
  | { readonly kind: "emoji"; readonly text: string; readonly name: string };

// A URL, a custom emoji, or an @name where the @ does not follow a word
// character (so an email address is not a mention). Same mention shape as
// the web client's.
const TOKEN = /(https?:\/\/[^\s<]+)|<a?:(\w+):[\w-]+>|(^|[^\w@])@(\w+)/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/** Splits message text into plain runs, @mentions and links. */
export function parseContent(content: string): ContentPart[] {
  const parts: ContentPart[] = [];
  let cursor = 0;
  const push = (part: ContentPart) => {
    const last = parts.at(-1);
    if (part.kind === "text" && last?.kind === "text") {
      parts[parts.length - 1] = { kind: "text", text: last.text + part.text };
    } else if (part.text) {
      parts.push(part);
    }
  };
  for (const match of content.matchAll(TOKEN)) {
    const [whole, url, emoji, lead = "", name] = match;
    const start = match.index;
    push({ kind: "text", text: content.slice(cursor, start) });
    if (url) {
      const trimmed = url.replace(TRAILING_PUNCTUATION, "");
      push({ kind: "link", text: trimmed, url: trimmed });
      cursor = start + trimmed.length;
    } else if (emoji) {
      push({ kind: "emoji", text: `:${emoji}:`, name: emoji });
      cursor = start + whole.length;
    } else if (name) {
      push({ kind: "text", text: lead });
      push({ kind: "mention", text: `@${name}`, name });
      cursor = start + whole.length;
    }
  }
  push({ kind: "text", text: content.slice(cursor) });
  return parts;
}

/** True when `parts` mention `username`, @everyone or @here. */
export function mentionsUser(
  parts: readonly ContentPart[],
  username: string | undefined,
): boolean {
  const me = username?.toLowerCase();
  return parts.some((part) => {
    if (part.kind !== "mention") return false;
    const name = part.name.toLowerCase();
    return name === "everyone" || name === "here" || name === me;
  });
}
