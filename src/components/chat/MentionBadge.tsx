
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useState } from "react";
import UserProfilePopover from "./UserProfilePopover";

interface Props {
  username: string;
  isInputOverlay?: boolean;
}

export function MentionBadge({ username, isInputOverlay }: Props) {
  const members = useChatStore(s => s.members);
  const [showProfile, setShowProfile] = useState(false);
  const [badgeEl, setBadgeEl] = useState<HTMLButtonElement | null>(null);

  // Find the user by username (case-insensitive)
  const member = members.find(
    (m: any) => m.user.username.toLowerCase() === username.toLowerCase()
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
        "relative rounded px-1 font-medium transition-colors bg-transparent hover:bg-transparent text-transparent pointer-events-auto cursor-pointer"
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
        "relative rounded border-0 bg-transparent px-1 font-medium transition-colors cursor-pointer",
        member
          ? "bg-rm-accent/20 text-rm-accent hover:bg-rm-accent/30"
          : "bg-rm-text-muted/10 text-rm-text-muted"
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
          anchorEl={badgeEl}
          onClose={() => setShowProfile(false)}
          side="right"
        />
      )}
    </>
  );
}
