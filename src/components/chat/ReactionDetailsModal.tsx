import { AvatarImage } from "@/components/chat/AvatarImage";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { IconButton } from "@/components/ui/IconButton";
import { PRESS } from "@/components/ui/interaction";
import { useUserResolution } from "@/hooks/useUserResolution";
import { getDisplayInitial } from "@/lib/display-name";
import { getNextReactionEmoji } from "@/lib/reaction-details";
import type { Message, Reaction } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import EmojiToken from "./EmojiToken";
import InlineEmojiText from "./InlineEmojiText";

type CustomEmojiMap = Record<string, { image_url?: string | null }>;
const EMPTY_REACTIONS: Reaction[] = [];

interface ReactionDetailsModalProps {
  open?: boolean;
  message: Message;
  initialEmoji: string | null;
  canManageReactions: boolean;
  customEmojiMap: CustomEmojiMap;
  onRemoveReaction: (emoji: string, userId: string) => void;
  onClose: () => void;
}

function ReactionUserRow({
  userId,
  canManageReactions,
  onRemove,
}: {
  userId: string;
  canManageReactions: boolean;
  onRemove: () => void;
}) {
  const { username, displayName, avatarUrl, avatarDisplay } =
    useUserResolution(userId);

  return (
    <div className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors pointer-fine:hover:bg-rm-tint-1">
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rm-bg-surface text-ui-sm font-semibold text-rm-text-muted">
        {avatarUrl ? (
          <AvatarImage
            src={avatarUrl}
            alt={`${displayName} avatar`}
            display={avatarDisplay}
          />
        ) : (
          getDisplayInitial({ display_name: displayName, username })
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui-sm font-semibold text-rm-text">
          <InlineEmojiText text={displayName} />
        </p>
        <p className="truncate text-ui-xs text-rm-text-muted">@{username}</p>
      </div>
      {canManageReactions && (
        <IconButton
          icon="close"
          iconSize="sm"
          variant="destructive"
          type="button"
          onClick={onRemove}
          className="pointer-fine:pointer-events-none pointer-fine:opacity-0 pointer-fine:group-hover:pointer-events-auto pointer-fine:group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
          aria-label={`Remove reaction from ${displayName}`}
        />
      )}
    </div>
  );
}

function ReactionGroupButton({
  reaction,
  selected,
  customEmojiMap,
  onClick,
}: {
  reaction: Reaction;
  selected: boolean;
  customEmojiMap: CustomEmojiMap;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`${reaction.emoji} ${reaction.count}`}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left",
        PRESS,
        selected
          ? "bg-rm-accent-tint text-rm-accent-ink"
          : "text-rm-text-muted pointer-fine:hover:text-rm-text",
      )}
    >
      <EmojiToken
        value={reaction.emoji}
        customEmojiMap={customEmojiMap}
        size="large"
        className="size-8 shrink-0"
        fallbackClassName="text-ui-2xl leading-none"
      />
      <span className="tabular-nums text-ui-sm font-semibold">
        {reaction.count}
      </span>
    </button>
  );
}

export default function ReactionDetailsModal({
  open = true,
  message,
  initialEmoji,
  canManageReactions,
  customEmojiMap,
  onRemoveReaction,
  onClose,
}: ReactionDetailsModalProps) {
  const reactions = message.reactions ?? EMPTY_REACTIONS;
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(
    initialEmoji,
  );
  const activeSelectedEmoji = getNextReactionEmoji(reactions, selectedEmoji);
  const selectedReaction =
    reactions.find((reaction) => reaction.emoji === activeSelectedEmoji) ??
    null;
  const selectedUsers = selectedReaction?.users ?? [];

  useEffect(() => {
    if (!activeSelectedEmoji) {
      onClose();
    }
  }, [activeSelectedEmoji, onClose]);

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Reactions</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="grid h-[min(420px,55dvh)] min-h-0 grid-cols-[112px_minmax(0,1fr)] md:grid-cols-[148px_minmax(0,1fr)]">
          <aside className="custom-scrollbar min-h-0 overflow-y-auto overscroll-contain border-r border-rm-border pr-3">
            <div className="space-y-1">
              {reactions.map((reaction) => (
                <ReactionGroupButton
                  key={reaction.emoji}
                  reaction={reaction}
                  selected={reaction.emoji === activeSelectedEmoji}
                  customEmojiMap={customEmojiMap}
                  onClick={() => setSelectedEmoji(reaction.emoji)}
                />
              ))}
            </div>
          </aside>

          <section className="custom-scrollbar min-h-0 overflow-y-auto overscroll-contain pl-3">
            {selectedReaction ? (
              <div className="space-y-1">
                {selectedUsers.length > 0 ? (
                  selectedUsers.map((userId) => (
                    <ReactionUserRow
                      key={userId}
                      userId={userId}
                      canManageReactions={canManageReactions}
                      onRemove={() =>
                        onRemoveReaction(selectedReaction.emoji, userId)
                      }
                    />
                  ))
                ) : (
                  <p className="py-4 text-center text-ui-sm text-rm-text-muted">
                    No users found for this reaction.
                  </p>
                )}
              </div>
            ) : null}
          </section>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
