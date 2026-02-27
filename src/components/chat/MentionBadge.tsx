"use client";

import { useChatState } from "@/lib/chat-context";
import { cn } from "@/lib/utils";
import NextImage from "next/image";
import { useRef, useState } from "react";
import UserProfilePopover from "./UserProfilePopover";

interface Props {
  username: string;
  isInputOverlay?: boolean;
}

export function MentionBadge({ username, isInputOverlay }: Props) {
  const state = useChatState();
  const [showTooltip, setShowTooltip] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const badgeRef = useRef<HTMLSpanElement>(null);

  // Find the user by username (case-insensitive)
  const member = state.members.find(
    (m) => m.user.username.toLowerCase() === username.toLowerCase()
  );

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (member) {
      setShowTooltip(false);
      setShowProfile(true);
    }
  };

  const badgeContent = (
    <span
      ref={badgeRef}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={isInputOverlay ? undefined : handleClick}
      role={isInputOverlay ? "presentation" : "button"}
      tabIndex={isInputOverlay ? -1 : 0}
      className={cn(
        "relative rounded px-1 font-medium transition-colors cursor-pointer",
        member
          ? "bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30"
          : "bg-rm-text-muted/10 text-rm-text-muted",
        isInputOverlay && "pointer-events-auto text-transparent bg-transparent hover:bg-transparent"
      )}
    >
      @{username}

      {/* Hover Tooltip */}
      {showTooltip && member && !showProfile && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 flex flex-col items-center animate-in fade-in zoom-in-95 duration-100 z-[60] pointer-events-none">
          <div className="flex items-center gap-2 rounded-lg bg-rm-bg-popover border border-rm-border px-3 py-1.5 shadow-xl min-w-max">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rm-bg-surface text-[8px] font-bold text-rm-text-muted border border-rm-border">
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
          {/* Tooltip caret */}
          <div className="h-1.5 w-3 -mt-[1px]">
            <svg viewBox="0 0 12 6" className="fill-rm-bg-popover stroke-rm-border drop-shadow-sm h-full w-full">
              <path d="M0 0l6 6 6-6H0z" />
            </svg>
          </div>
        </div>
      )}
    </span>
  );

  return (
    <>
      {badgeContent}
      {showProfile && member && badgeRef.current && !isInputOverlay && (
        <UserProfilePopover
          userId={member.user.id}
          username={member.user.username}
          avatarUrl={member.user.avatar_url}
          anchorEl={badgeRef.current}
          onClose={() => setShowProfile(false)}
          side="top"
        />
      )}
    </>
  );
}
