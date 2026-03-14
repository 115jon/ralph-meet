
import React from "react";

interface Props {
  text: string;
}

/** Check if a match at `index` falls inside a URL in the text */
function isInsideUrl(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const lastSpace = Math.max(before.lastIndexOf(" "), before.lastIndexOf("\n"), before.lastIndexOf("\t"));
  const tokenStart = lastSpace + 1;
  const token = text.slice(tokenStart).split(/\s/)[0];
  return /^https?:\/\//i.test(token);
}

export function InputMentionOverlay({ text }: Props) {
  // Match both @mentions and raw URLs
  const regex = /(https?:\/\/[^\s<>"'`)\]]+)|@([a-zA-Z0-9_]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const isUrl = match[1] != null;
    const isMention = match[2] != null;

    // Skip @mentions that are part of a URL (e.g. tiktok.com/@user/...)
    if (isMention && isInsideUrl(text, match.index)) {
      continue;
    }

    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
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
    } else if (isMention) {
      parts.push(
        <span
          key={`mention-${match.index}`}
          data-mention={match[2]}
          className="rounded px-1 font-medium select-none pointer-events-auto bg-indigo-500/20 text-indigo-400"
        >
          {match[0]}
        </span>
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  // Use zero-width space to preserve trailing newlines for height calculation
  return <>{parts}&#8203;</>;
}
