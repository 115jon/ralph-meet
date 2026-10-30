import React from "react";
import {
  extractCustomEmojiIds,
  isInsideUrl,
  resolveNativeEmojiShortcode,
  splitTextByNativeEmoji,
  type GeneratedEmoji,
} from "@/lib/emoji";
import { useCustomEmojiLookup } from "@/hooks/useCustomEmojiLookup";
import { useEmojiDataReady } from "@/hooks/useEmojiDataReady";
import { cn } from "@/lib/utils";
import { MentionBadge } from "./MentionBadge";
import EmojiToken from "./EmojiToken";

interface Props {
  content: string;
}

const LINK_CLASS =
  "text-accent-ink underline-offset-3 pointer-fine:hover:underline";

function renderPlainText(text: string, keyPrefix: string): React.ReactNode[] {
  return splitTextByNativeEmoji(text).map((part, index) =>
    part.type === "emoji" ? (
      <EmojiToken
        key={`${keyPrefix}-emoji-${index}`}
        value={part.value}
        selectable
      />
    ) : (
      part.value
    ),
  );
}

/** `||spoiler||`: hidden behind a tint until clicked (Discord habit). */
function Spoiler({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = React.useState(false);
  if (revealed) {
    return (
      <span className="rounded-xs bg-tint-1 transition-colors duration-(--dur-2) ease-out">
        {children}
      </span>
    );
  }
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="Spoiler, select to reveal"
      onClick={(event) => {
        event.stopPropagation();
        setRevealed(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setRevealed(true);
        }
      }}
      className="cursor-pointer rounded-xs bg-tint-3 text-transparent select-none transition-colors duration-(--dur-2) ease-out pointer-fine:hover:bg-line-strong [&_*]:invisible"
    >
      {children}
    </span>
  );
}

// Order matters: `__` before `_`, `**` before `*`. Underscore emphasis needs
// a non-word character on both sides so snake_case stays literal.
const INLINE_PATTERN =
  /(`[^`]+`|\|\|[^|]+\|\||\*\*[^*]+\*\*|\*[^*\s][^*]*\*|__[^_]+__|(?<![\w])_[^_\s][^_]*_(?![\w])|~~[^~]+~~|\[[^\]]+\]\([^)]+\)|<:[a-z0-9_]+:[a-z0-9-]+>|:[a-z0-9_+-]+:|@([a-zA-Z0-9_]+)|(https?:\/\/[^\s<>"'`)\]]+))/gi;

function renderInline(
  text: string,
  customEmojiMap: Record<string, GeneratedEmoji>,
  keyBase = "",
): React.ReactNode[] {
  const regex = new RegExp(INLINE_PATTERN.source, INLINE_PATTERN.flags);
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const key = `${keyBase}${match.index}`;
    if (match.index > lastIndex) {
      parts.push(
        ...renderPlainText(text.slice(lastIndex, match.index), `plain-${key}`),
      );
    }
    const m = match[0];
    if (m.startsWith("`")) {
      parts.push(
        <code
          key={`ic-${key}`}
          className="rounded-xs bg-tint-2 px-1 font-mono text-ui-sm text-ink-1"
        >
          {m.slice(1, -1)}
        </code>,
      );
    } else if (m.startsWith("||")) {
      parts.push(
        <Spoiler key={`sp-${key}`}>
          {renderInline(m.slice(2, -2), customEmojiMap, `${key}-sp-`)}
        </Spoiler>,
      );
    } else if (m.startsWith("**")) {
      parts.push(
        <strong key={`b-${key}`} className="font-semibold">
          {renderInline(m.slice(2, -2), customEmojiMap, `${key}-b-`)}
        </strong>,
      );
    } else if (m.startsWith("__")) {
      parts.push(
        <u key={`u-${key}`} className="underline-offset-3">
          {renderInline(m.slice(2, -2), customEmojiMap, `${key}-u-`)}
        </u>,
      );
    } else if (m.startsWith("*") || m.startsWith("_")) {
      parts.push(
        <em key={`i-${key}`}>
          {renderInline(m.slice(1, -1), customEmojiMap, `${key}-i-`)}
        </em>,
      );
    } else if (m.startsWith("~~")) {
      parts.push(<del key={`s-${key}`}>{m.slice(2, -2)}</del>);
    } else if (m.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(m);
      if (!linkMatch) {
        parts.push(m);
      } else {
        parts.push(
          <a
            key={`a-${key}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className={LINK_CLASS}
          >
            {linkMatch[1]}
          </a>,
        );
      }
    } else if (m.startsWith("<:")) {
      parts.push(
        <EmojiToken
          key={`ce-${key}`}
          value={m}
          customEmojiMap={customEmojiMap}
          selectable
        />,
      );
    } else if (m.startsWith(":")) {
      if (isInsideUrl(text, match.index)) {
        parts.push(m);
      } else {
        const nativeEmoji = resolveNativeEmojiShortcode(m.slice(1, -1));
        parts.push(
          nativeEmoji ? (
            <EmojiToken key={`ne-${key}`} value={m} selectable />
          ) : (
            m
          ),
        );
      }
    } else if (m.startsWith("@")) {
      parts.push(<MentionBadge key={`at-${key}`} username={m.slice(1)} />);
    } else if (m.startsWith("http")) {
      // Auto-link raw URLs; trailing punctuation stays text.
      const cleanUrl = m.replace(/[.,;:!?)]+$/, "");
      const trailing = m.slice(cleanUrl.length);
      parts.push(
        <a
          key={`url-${key}`}
          href={cleanUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(LINK_CLASS, "wrap-anywhere")}
        >
          {cleanUrl}
        </a>,
      );
      if (trailing) parts.push(trailing);
    } else {
      parts.push(m);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(
      ...renderPlainText(
        text.slice(lastIndex),
        `plain-tail-${keyBase}${lastIndex}`,
      ),
    );
  }
  return parts;
}

/**
 * Text outside code blocks: runs of lines starting with `> ` become one
 * quote (a neutral guide bar, never a hue), everything else renders inline.
 */
function renderTextBlock(
  text: string,
  customEmojiMap: Record<string, GeneratedEmoji>,
  keyBase: string,
): React.ReactNode[] {
  if (!/(^|\n)> /.test(text)) {
    return renderInline(text, customEmojiMap, keyBase);
  }
  const nodes: React.ReactNode[] = [];
  const lines = text.split("\n");
  let buffer: string[] = [];
  let quote: string[] = [];
  const flushBuffer = (index: number) => {
    if (buffer.length === 0) return;
    nodes.push(
      ...renderInline(
        buffer.join("\n"),
        customEmojiMap,
        `${keyBase}t${index}-`,
      ),
    );
    buffer = [];
  };
  const flushQuote = (index: number) => {
    if (quote.length === 0) return;
    nodes.push(
      <span
        key={`${keyBase}q${index}`}
        className="relative my-0.5 block pl-3 text-ink-2 before:absolute before:inset-y-0.5 before:left-0 before:w-0.5 before:rounded-full before:bg-line-strong"
      >
        {renderInline(quote.join("\n"), customEmojiMap, `${keyBase}q${index}-`)}
      </span>,
    );
    quote = [];
  };
  lines.forEach((line, index) => {
    const isQuote = line.startsWith("> ") || line === ">";
    if (isQuote) {
      flushBuffer(index);
      quote.push(line.replace(/^> ?/, ""));
    } else {
      flushQuote(index);
      buffer.push(line);
    }
  });
  flushQuote(lines.length);
  flushBuffer(lines.length);
  return nodes;
}

/** Render markdown-lite content */
export const MarkdownRenderer = React.memo(({ content }: Props) => {
  // Re-render once the lazily loaded emoji set lands (desktop).
  useEmojiDataReady();
  const customEmojiIds = React.useMemo(
    () => extractCustomEmojiIds(content),
    [content],
  );
  const customEmojiMap = useCustomEmojiLookup(customEmojiIds);
  const parts: React.ReactNode[] = [];
  const codeBlockRegex = /```([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        ...renderTextBlock(
          content.slice(lastIndex, match.index),
          customEmojiMap,
          `b${lastIndex}-`,
        ),
      );
    }
    parts.push(
      <pre
        key={`cb-${match.index}`}
        className="my-1 max-w-full overflow-x-auto rounded-md border border-line bg-ply-2 p-3 font-mono text-ui-sm leading-5 text-ink-1"
      >
        <code>{match[1].trim()}</code>
      </pre>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    parts.push(
      ...renderTextBlock(
        content.slice(lastIndex),
        customEmojiMap,
        `b${lastIndex}-`,
      ),
    );
  }
  return <>{parts}</>;
});
