"use client";

import React from "react";

interface Props {
  text: string;
}

export function InputMentionOverlay({ text }: Props) {
  const regex = /@([a-zA-Z0-9_]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <span
        key={`mention-${match.index}`}
        data-mention={match[1]}
        className="rounded font-medium select-none"
        style={{
          color: '#818cf8', // indigo-400
          backgroundColor: '#393c56', // Solid approximate for bg-indigo-500/20 on elev bg
          boxShadow: '0 0 0 1px #393c56' // Slight bleed to ensure it covers text behind
        }}
      >
        {match[0]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  // Use zero-width space to preserve trailing newlines for height calculation
  return <>{parts}&#8203;</>;
}
