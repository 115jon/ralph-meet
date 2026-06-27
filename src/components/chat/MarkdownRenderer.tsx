
import React from 'react';
import { extractCustomEmojiIds, isInsideUrl, resolveNativeEmojiShortcode, splitTextByNativeEmoji, type GeneratedEmoji } from "@/lib/emoji";
import { useCustomEmojiLookup } from "@/hooks/useCustomEmojiLookup";
import { MentionBadge } from './MentionBadge';
import EmojiToken from "./EmojiToken";

interface Props {
  content: string;
}

function renderPlainText(text: string, keyPrefix: string): React.ReactNode[] {
  return splitTextByNativeEmoji(text).map((part, index) => (
    part.type === "emoji" ? (
      <EmojiToken
        key={`${keyPrefix}-emoji-${index}`}
        value={part.value}
        selectable
      />
    ) : part.value
  ));
}

function renderInline(text: string, customEmojiMap: Record<string, GeneratedEmoji>): React.ReactNode[] {
  // Added @([a-zA-Z0-9_]+) for mentions, and raw URL auto-linking
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|\[[^\]]+\]\([^)]+\)|<:[a-z0-9_]+:[a-z0-9-]+>|:[a-z0-9_+-]+:|@([a-zA-Z0-9_]+)|(https?:\/\/[^\s<>"'`)\]]+))/gi;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(...renderPlainText(text.slice(lastIndex, match.index), `plain-${lastIndex}`));
    }
    const m = match[0];
    if (m.startsWith('`')) {
      parts.push(
        <code key={`ic-${match.index}`} className="rounded bg-rm-bg-elevated px-1.5 py-0.5 text-[0.85em] text-primary">{m.slice(1, -1)}</code>
      );
    } else if (m.startsWith('**')) {
      parts.push(<strong key={`b-${match.index}`}>{m.slice(2, -2)}</strong>);
    } else if (m.startsWith('*')) {
      parts.push(<em key={`i-${match.index}`}>{m.slice(1, -1)}</em>);
    } else if (m.startsWith('~~')) {
      parts.push(<del key={`s-${match.index}`}>{m.slice(2, -2)}</del>);
    } else if (m.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(m);
      if (!linkMatch) {
        parts.push(m);
      } else {
        parts.push(
          <a key={`a-${match.index}`} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            {linkMatch[1]}
          </a>
        );
      }
    } else if (m.startsWith('<:')) {
      parts.push(
        <EmojiToken
          key={`ce-${match.index}`}
          value={m}
          customEmojiMap={customEmojiMap}
          selectable
        />
      );
    } else if (m.startsWith(':')) {
      if (isInsideUrl(text, match.index)) {
        parts.push(m);
      } else {
        const nativeEmoji = resolveNativeEmojiShortcode(m.slice(1, -1));
        parts.push(
          nativeEmoji ? (
            <EmojiToken
              key={`ne-${match.index}`}
              value={m}
              selectable
            />
          ) : m
        );
      }
    } else if (m.startsWith('@')) {
      parts.push(
        <MentionBadge key={`at-${match.index}`} username={m.slice(1)} />
      );
    } else if (m.startsWith('http')) {
      // Auto-link raw URLs
      // Clean trailing punctuation that slipped in
      const cleanUrl = m.replace(/[.,;:!?)]+$/, '');
      const trailing = m.slice(cleanUrl.length);
      parts.push(
        <a
          key={`url-${match.index}`}
          href={cleanUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline break-all"
        >
          {cleanUrl}
        </a>
      );
      if (trailing) parts.push(trailing);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(...renderPlainText(text.slice(lastIndex), `plain-tail-${lastIndex}`));
  }
  return parts;
}

/** Render markdown-lite content */
export const MarkdownRenderer = React.memo(({ content }: Props) => {
  const customEmojiIds = React.useMemo(() => extractCustomEmojiIds(content), [content]);
  const customEmojiMap = useCustomEmojiLookup(customEmojiIds);
  const parts: React.ReactNode[] = [];
  const codeBlockRegex = /```([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(...renderInline(content.slice(lastIndex, match.index), customEmojiMap));
    }
    parts.push(
      <pre key={`cb-${match.index}`} className="my-1.5 overflow-x-auto rounded-lg bg-rm-bg-elevated p-3 text-xs leading-relaxed text-rm-text-secondary border border-rm-border">
        <code>{match[1].trim()}</code>
      </pre>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    parts.push(...renderInline(content.slice(lastIndex), customEmojiMap));
  }
  return <>{parts}</>;
});
