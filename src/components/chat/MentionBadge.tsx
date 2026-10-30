import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useState } from "react";
import UserProfilePopover from "./UserProfilePopover";

interface Props {
  username: string;
  isInputOverlay?: boolean;
}

export function MentionBadge({ username, isInputOverlay }: Props) {
  const members = useChatStore((s) => s.members);
  const [showProfile, setShowProfile] = useState(false);
  const [badgeEl, setBadgeEl] = useState<HTMLButtonElement | null>(null);

  // Find the user by username (case-insensitive)
  const member = members.find(
    (m: any) => m.user.username.toLowerCase() === username.toLowerCase(),
  );

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (member) {
      setShowProfile(true);
    }
  };

  const badgeContent = isInputOverlay ? (
    <span
      className={cn(
        "relative rounded-xs px-0.5 font-medium bg-transparent text-transparent pointer-events-auto cursor-pointer",
      )}
    >
      @{username}
    </span>
  ) : (
    <button
      type="button"
      ref={setBadgeEl}
      onClick={handleClick}
      className={cn(
        "relative rounded-xs border-0 px-0.5 font-medium transition-colors duration-(--dur-1) ease-out",
        member
          ? "cursor-pointer bg-accent-tint text-accent-ink underline-offset-3 pointer-fine:hover:underline"
          : "cursor-default bg-tint-1 text-ink-2",
      )}
    >
      @{username}
    </button>
  );

  return (
    <>
      {badgeContent}
      {showProfile && member && badgeEl && !isInputOverlay && (
        <UserProfilePopover
          userId={member.user.id}
          username={member.user.username}
          displayName={member.user.display_name}
          avatarUrl={member.user.avatar_url}
          avatarDisplay={member.user.avatar_display}
          anchorEl={badgeEl}
          onClose={() => setShowProfile(false)}
          side="right"
        />
      )}
    </>
  );
}
