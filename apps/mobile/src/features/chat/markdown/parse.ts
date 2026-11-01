import type { Block, Inline } from "./ast";
import { resolveShortcode } from "./emoji";

// A port of the web's grammar (src/components/chat/MarkdownRenderer.tsx),
// which renders while it parses and so cannot be shared: keep the two in
// step. Order matters: `__` before `_`, `**` before `*`. Underscore emphasis
// needs a non-word character on both sides so snake_case stays literal.
// One addition: animated custom emoji (`<a:name:id>`) parse like still ones.
const INLINE_PATTERN =
  /(`[^`]+`|\|\|[^|]+\|\||\*\*[^*]+\*\*|\*[^*\s][^*]*\*|__[^_]+__|(?<![\w])_[^_\s][^_]*_(?![\w])|~~[^~]+~~|\[[^\]]+\]\([^)]+\)|<a?:[a-z0-9_]+:[a-z0-9-]+>|:[a-z0-9_+-]+:|@([a-zA-Z0-9_]+)|(https?:\/\/[^\s<>"'`)\]]+))/gi;
const MASKED_LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;
const CUSTOM_EMOJI = /^<a?:([a-z0-9_]+):([a-z0-9-]+)>$/i;
const TRAILING_PUNCTUATION = /[.,;:!?)]+$/;
const CODE_FENCE = /```([\s\S]*?)```/g;
// A fence's first line names its language when it is one word.
const LANGUAGE_LINE = /^([\w+#.-]+)[ \t]*\n/;

/** Whether `index` sits inside a whitespace-delimited http(s) URL (web rule). */
function isInsideUrl(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const tokenStart =
    Math.max(
      before.lastIndexOf(" "),
      before.lastIndexOf("\n"),
      before.lastIndexOf("\t"),
    ) + 1;
  const token = text.slice(tokenStart).split(/\s/)[0] ?? "";
  return /^https?:\/\//i.test(token);
}

/** Inline markdown in `text`: emphasis, code, spoilers, links, emoji, mentions. */
export function parseInline(text: string): Inline[] {
  const nodes: Inline[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const last = nodes.at(-1);
    if (last?.kind === "text") {
      nodes[nodes.length - 1] = { kind: "text", text: last.text + value };
    } else {
      nodes.push({ kind: "text", text: value });
    }
  };
  let cursor = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const m = match[0];
    const index = match.index;
    pushText(text.slice(cursor, index));
    cursor = index + m.length;
    if (m.startsWith("`")) {
      nodes.push({ kind: "code", text: m.slice(1, -1) });
    } else if (m.startsWith("||")) {
      nodes.push({ kind: "spoiler", children: parseInline(m.slice(2, -2)) });
    } else if (m.startsWith("**")) {
      nodes.push({ kind: "bold", children: parseInline(m.slice(2, -2)) });
    } else if (m.startsWith("__")) {
      nodes.push({ kind: "underline", children: parseInline(m.slice(2, -2)) });
    } else if (m.startsWith("*") || m.startsWith("_")) {
      nodes.push({ kind: "italic", children: parseInline(m.slice(1, -1)) });
    } else if (m.startsWith("~~")) {
      nodes.push({ kind: "strike", text: m.slice(2, -2) });
    } else if (m.startsWith("[")) {
      const link = MASKED_LINK.exec(m);
      if (link?.[1] && link[2]) {
        nodes.push({ kind: "link", text: link[1], url: link[2] });
      } else {
        pushText(m);
      }
    } else if (m.startsWith("<")) {
      const emoji = CUSTOM_EMOJI.exec(m);
      if (emoji?.[1] && emoji[2]) {
        nodes.push({ kind: "customEmoji", name: emoji[1], id: emoji[2] });
      } else {
        pushText(m);
      }
    } else if (m.startsWith(":")) {
      const native = isInsideUrl(text, index)
        ? null
        : resolveShortcode(m.slice(1, -1));
      if (native) nodes.push({ kind: "emoji", native, name: m.slice(1, -1) });
      else pushText(m);
    } else if (m.startsWith("@")) {
      nodes.push({ kind: "mention", username: m.slice(1) });
    } else if (/^http/i.test(m)) {
      const url = m.replace(TRAILING_PUNCTUATION, "");
      nodes.push({ kind: "url", url });
      pushText(m.slice(url.length));
    } else {
      pushText(m);
    }
  }
  pushText(text.slice(cursor));
  return nodes;
}

/** Text outside code fences: runs of `> ` lines become one quote. */
function parseTextBlocks(text: string, blocks: Block[]): void {
  // A trailing line break ends the line; it is not an empty line after it.
  const paragraph = (value: string) => {
    if (value.trim()) {
      const line = value.replace(/\r?\n$/, "");
      blocks.push({ kind: "paragraph", children: parseInline(line) });
    }
  };
  if (!/(^|\n)> /.test(text)) {
    paragraph(text);
    return;
  }
  let buffer: string[] = [];
  let quote: string[] = [];
  const flushBuffer = () => {
    if (buffer.length) paragraph(buffer.join("\n"));
    buffer = [];
  };
  const flushQuote = () => {
    if (quote.length) {
      blocks.push({ kind: "quote", children: parseInline(quote.join("\n")) });
    }
    quote = [];
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("> ") || line === ">") {
      flushBuffer();
      quote.push(line.replace(/^> ?/, ""));
    } else {
      flushQuote();
      buffer.push(line);
    }
  }
  flushQuote();
  flushBuffer();
}

function codeBlock(body: string): Block {
  const language = LANGUAGE_LINE.exec(body);
  const rest = language ? body.slice(language[0].length).trim() : "";
  if (language?.[1] && rest) {
    return { kind: "code", language: language[1], code: rest };
  }
  return { kind: "code", language: null, code: body.trim() };
}

/**
 * Message content as blocks: ``` fences, quotes and paragraphs. A single
 * line break either side of a fence is the fence's own line, not a gap.
 */
export function parseMarkdown(content: string): Block[] {
  const blocks: Block[] = [];
  let cursor = 0;
  for (const match of content.matchAll(CODE_FENCE)) {
    let before = content.slice(cursor, match.index);
    if (cursor > 0) before = before.replace(/^\r?\n/, "");
    parseTextBlocks(before, blocks);
    blocks.push(codeBlock(match[1] ?? ""));
    cursor = match.index + match[0].length;
  }
  const rest = content.slice(cursor);
  parseTextBlocks(cursor > 0 ? rest.replace(/^\r?\n/, "") : rest, blocks);
  return blocks;
}

const CACHE_SIZE = 400;
const cache = new Map<string, { content: string; blocks: Block[] }>();

/**
 * `parseMarkdown` once per message version: rows scrolled back into view,
 * or re-rendered by a reaction, reuse the blocks. Keyed by id; an edit
 * changes the content and so misses.
 */
export function parseMessage(id: string, content: string): Block[] {
  const hit = cache.get(id);
  if (hit && hit.content === content) return hit.blocks;
  const blocks = parseMarkdown(content);
  cache.delete(id);
  cache.set(id, { content, blocks });
  if (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return blocks;
}
