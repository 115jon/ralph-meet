"use client";

import { useChatState } from "@/lib/chat-context";
import { cn } from "@/lib/utils";
import NextImage from "next/image";
import React, { useState } from "react";

interface Props {
  text: string;
}

function InputMentionBadge({ username, originalText }: { username: string, originalText: string }) {
  const state = useChatState();
  const [showTooltip, setShowTooltip] = useState(false);

  const member = state.members.find(
    (m) => m.user.username.toLowerCase() === username.toLowerCase()
  );

  return (
    <span
      className={cn(
        "relative rounded px-1 font-medium pointer-events-auto cursor-text",
        member ? "bg-indigo-500/20 text-indigo-400" : "text-transparent"
      )}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={(e) => {
        // We let the click happen, but we don't prevent default,
        // so if there's a clever way to forward to textarea we could.
        // For now, it just acts as text. To allow editing, we might need to
        // temporarily disable pointer events.
      }}
    >
      {/* We render transparent text so it perfectly aligns with the textarea underneath,
          unless it's a valid mention, in which case we color it. */}
      <span className={member ? "" : "text-transparent"}>{originalText}</span>

      {showTooltip && member && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 flex flex-col items-center animate-in fade-in zoom-in-95 duration-100 z-[60] pointer-events-none">
          <div className="flex items-center gap-2 rounded-lg bg-rm-bg-popover border border-rm-border px-3 py-1.5 shadow-xl min-w-max">
            <div className="relative flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rm-bg-surface text-[8px] font-bold text-rm-text-muted border border-rm-border">
              {member.user.avatar_url ? (
                <NextImage
                  src={member.user.avatar_url}
                  alt=""
                  fill
                  className="object-cover"
                />
              ) : (
                member.user.username[0].toUpperCase()
              )}
            </div>
            <span className="text-xs font-semibold text-rm-text-primary">
              {member.user.username}
            </span>
          </div>
          <div className="h-1.5 w-3 -mt-[1px]">
            <svg viewBox="0 0 12 6" className="fill-rm-bg-popover stroke-rm-border drop-shadow-sm h-full w-full">
              <path d="M0 0l6 6 6-6H0z" />
            </svg>
          </div>
        </div>
      )}
    </span>
  );
}

export function InputMentionOverlay({ text }: Props) {
  const regex = /@([a-zA-Z0-9_]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={`text-${lastIndex}`} className="text-transparent">
          {text.slice(lastIndex, match.index)}
        </span>
      );
    }
    parts.push(
      <InputMentionBadge key={`mention-${match.index}`} username={match[1]} originalText={match[0]} />
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(
      <span key={`text-${lastIndex}`} className="text-transparent">
        {text.slice(lastIndex)}
      </span>
    );
  }

  // Use a zero-width space at the end to ensure the div height matches trailing newlines
  return <>{parts}&#8203;</>;
}
