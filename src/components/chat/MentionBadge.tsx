
import { cn } from "@/lib/utils";
import { useChatState } from "@/stores/chat-store";
import { useState } from "react";
import UserProfilePopover from "./UserProfilePopover";

interface Props {
  username: string;
  isInputOverlay?: boolean;
}

export function MentionBadge({ username, isInputOverlay }: Props) {
  const state = useChatState();
  const [showProfile, setShowProfile] = useState(false);
  const [badgeEl, setBadgeEl] = useState<HTMLSpanElement | null>(null);

  // Find the user by username (case-insensitive)
  const member = state.members.find(
    (m) => m.user.username.toLowerCase() === username.toLowerCase()
  );

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (member) {
      setShowProfile(true);
    }
  };

  const badgeContent = (
    <span
      ref={setBadgeEl}
      onClick={isInputOverlay ? undefined : handleClick}
      onKeyDown={isInputOverlay ? undefined : (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick(e as any);
        }
      }}
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
    </span>
  );

  return (
    <>
      {badgeContent}
      {showProfile && member && badgeEl && !isInputOverlay && (
        <UserProfilePopover
          userId={member.user.id}
          username={member.user.username}
          avatarUrl={member.user.avatar_url}
          anchorEl={badgeEl}
          onClose={() => setShowProfile(false)}
          side="right"
        />
      )}
    </>
  );
}
