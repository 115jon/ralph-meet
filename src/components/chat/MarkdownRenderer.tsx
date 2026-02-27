"use client";

import React from 'react';
import { MentionBadge } from './MentionBadge';

interface Props {
  content: string;
}

function renderInline(text: string): React.ReactNode[] {
  // Added @([a-zA-Z0-9_]+) for mentions
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|\[([^\]]+)\]\(([^)]+)\)|@([a-zA-Z0-9_]+))/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
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
      parts.push(
        <a key={`a-${match.index}`} href={match[3]} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          {match[2]}
        </a>
      );
    } else if (m.startsWith('@')) {
      parts.push(
        <MentionBadge key={`at-${match.index}`} username={match[4]} />
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

/** Render markdown-lite content */
export const MarkdownRenderer = React.memo(({ content }: Props) => {
  const parts: React.ReactNode[] = [];
  const codeBlockRegex = /```([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(...renderInline(content.slice(lastIndex, match.index)));
    }
    parts.push(
      <pre key={`cb-${match.index}`} className="my-1.5 overflow-x-auto rounded-lg bg-rm-bg-elevated p-3 text-xs leading-relaxed text-rm-text-secondary border border-rm-border">
        <code>{match[1].trim()}</code>
      </pre>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    parts.push(...renderInline(content.slice(lastIndex)));
  }
  return <>{parts}</>;
});
