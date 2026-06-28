
import React from "react";
import { buildCustomEmojiToken, extractCustomEmojiIds, isInsideUrl, resolveNativeEmojiShortcode, splitTextByNativeEmoji } from "@/lib/emoji";
import { useCustomEmojiLookup } from "@/hooks/useCustomEmojiLookup";

import EmojiToken from "./EmojiToken";
import type { ComposerCustomEmojiMap } from "./message-input-utils";

interface Props {
  text: string;
  composerCustomEmojiMap?: ComposerCustomEmojiMap;
}

function toPlaceholderRegex(char: string): string {
  return `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
}

export function InputMentionOverlay({ text, composerCustomEmojiMap = {} }: Props) {
  const placeholderPattern = React.useMemo(() => {
    const placeholders = Object.keys(composerCustomEmojiMap);
    if (placeholders.length === 0) return null;

    return placeholders.map(toPlaceholderRegex).join("|");
  }, [composerCustomEmojiMap]);
  const regex = React.useMemo(
    () => new RegExp(
      `${String.raw`(https?:\/\/[^\s<>"'\`)\]]+)|<:([a-z0-9_]+):([a-z0-9-]+)>|:([a-z0-9_+-]+):|@([a-zA-Z0-9_]+)`}${placeholderPattern ? `|(${placeholderPattern})` : ""}`,
      "gi",
    ),
    [placeholderPattern],
  );
  const customEmojiIds = React.useMemo(
    () => Array.from(new Set([
      ...extractCustomEmojiIds(text),
      ...Object.values(composerCustomEmojiMap).map((item) => item.id),
    ])),
    [composerCustomEmojiMap, text],
  );
  const customEmojiMap = useCustomEmojiLookup(customEmojiIds);
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const renderEmojiWithLayout = (
    key: string,
    rawToken: string,
    node: React.ReactNode,
  ) => (
    <span key={key} className="relative inline-block align-baseline">
      <span className="invisible select-none">{rawToken}</span>
      <span className="pointer-events-none absolute inset-0 inline-flex items-center justify-start">
        {node}
      </span>
    </span>
  );
  const renderFixedEmojiWithLayout = (
    key: string,
    node: React.ReactNode,
  ) => (
    <span key={key} className="relative inline-block h-[1.35em] w-[1.35em] align-[-0.22em]">
      <span className="invisible inline-block h-[1.35em] w-[1.35em] select-none">.</span>
      <span className="pointer-events-none absolute inset-0 inline-flex items-center justify-center">
        {node}
      </span>
    </span>
  );
  const renderPlainText = React.useCallback((segment: string, keyPrefix: string) => (
    splitTextByNativeEmoji(segment).map((part, index) => (
      part.type === "emoji"
        ? renderEmojiWithLayout(
          `${keyPrefix}-native-${index}`,
          part.value,
          <EmojiToken
            value={part.value}
            className="pointer-events-none"
          />,
        )
        : part.value
    ))
  ), []);

  while ((match = regex.exec(text)) !== null) {
    const isUrl = match[1] != null;
    const isCustomEmoji = match[2] != null && match[3] != null;
    const isNativeShortcode = match[4] != null;
    const isMention = match[5] != null;
    const isComposerCustomEmoji = match[6] != null;

    // Skip @mentions that are part of a URL (e.g. tiktok.com/@user/...)
    if (isMention && isInsideUrl(text, match.index)) {
      continue;
    }

    if (match.index > lastIndex) {
      parts.push(...renderPlainText(text.slice(lastIndex, match.index), `plain-${lastIndex}`));
    }

    if (isUrl) {
      // Render URL with primary/link color
      parts.push(
        <span
          key={`url-${match.index}`}
          className="text-primary pointer-events-none"
        >
          {match[0]}
        </span>
      );
    } else if (isCustomEmoji) {
      parts.push(
        renderEmojiWithLayout(
          `custom-emoji-${match.index}`,
          match[0],
          <EmojiToken
            value={match[0]}
            customEmojiMap={customEmojiMap}
            className="pointer-events-none"
          />,
        )
      );
    } else if (isComposerCustomEmoji) {
      const placeholder = match[6];
      const customEmoji = composerCustomEmojiMap[placeholder];

      parts.push(
        customEmoji ? renderFixedEmojiWithLayout(
          `composer-custom-emoji-${match.index}`,
          <EmojiToken
            value={buildCustomEmojiToken(customEmoji.shortcode, customEmoji.id)}
            customEmojiMap={customEmojiMap}
            className="pointer-events-none"
          />,
        ) : placeholder,
      );
    } else if (isNativeShortcode) {
      if (isInsideUrl(text, match.index)) {
        parts.push(match[0]);
      } else {
        const shortcode = match[4].toLowerCase();
        const emoji = resolveNativeEmojiShortcode(shortcode);
        parts.push(
          emoji ? (
            renderEmojiWithLayout(
              `native-emoji-${match.index}`,
              match[0],
              <EmojiToken
                value={match[0]}
                className="pointer-events-none"
              />,
            )
          ) : match[0]
        );
      }
    } else if (isMention) {
      parts.push(
        <span
          key={`mention-${match.index}`}
          data-mention={match[5]}
          className="rounded-sm font-medium select-none pointer-events-auto bg-rm-accent/20 text-rm-accent"
        >
          {match[0]}
        </span>
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(...renderPlainText(text.slice(lastIndex), `plain-tail-${lastIndex}`));
  }

  // Use zero-width space to preserve trailing newlines for height calculation
  return <>{parts}&#8203;</>;
}
