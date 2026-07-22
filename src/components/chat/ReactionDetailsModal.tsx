import { AvatarImage } from "@/components/chat/AvatarImage";
import { BaseModal } from "@/components/ui/BaseModal";
import { useUserResolution } from "@/hooks/useUserResolution";
import { getDisplayInitial } from "@/lib/display-name";
import { getNextReactionEmoji } from "@/lib/reaction-details";
import type { Message, Reaction } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import EmojiToken from "./EmojiToken";
import { X } from "./Icons";

type CustomEmojiMap = Record<string, { image_url?: string | null }>;
const EMPTY_REACTIONS: Reaction[] = [];

interface ReactionDetailsModalProps {
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
    <div className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-rm-bg-hover">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rm-bg-surface text-sm font-bold text-rm-text-muted">
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
        <p className="truncate text-sm font-semibold text-rm-text">
          {displayName}
        </p>
        <p className="truncate text-xs text-rm-text-muted">@{username}</p>
      </div>
      {canManageReactions && (
        <button
          type="button"
          onClick={onRemove}
          className="pointer-events-none flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-rm-text-muted opacity-0 transition-[background-color,color,opacity,transform] group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 active:scale-[0.96]"
          aria-label={`Remove reaction from ${displayName}`}
        >
          <X className="h-4 w-4" />
        </button>
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
        "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-[background-color,color,transform] active:scale-[0.96]",
        selected
          ? "bg-primary/10 text-primary"
          : "text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text",
      )}
    >
      <EmojiToken
        value={reaction.emoji}
        customEmojiMap={customEmojiMap}
        size="large"
        className="h-8 w-8 shrink-0"
        fallbackClassName="text-2xl leading-none"
      />
      <span className="tabular-nums text-sm font-semibold">
        {reaction.count}
      </span>
    </button>
  );
}

export default function ReactionDetailsModal({
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
    <BaseModal onClose={onClose} aria-labelledby="reaction-details-title">
      <div
        className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-5"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
        role="presentation"
      >
        <dialog
          open
          className="relative m-0 flex h-[min(640px,calc(100dvh-24px))] min-h-[340px] w-full max-w-[720px] flex-col overflow-hidden rounded-xl border border-rm-border bg-rm-bg-primary p-0 shadow-2xl outline-none animate-in fade-in zoom-in-95 duration-200 sm:h-[min(640px,calc(100dvh-48px))]"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-rm-border px-5 py-4">
            <h2
              id="reaction-details-title"
              className="text-base font-bold text-rm-text"
            >
              Reactions
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-md text-rm-text-muted transition-[background-color,color,transform] hover:bg-rm-bg-hover hover:text-rm-text active:scale-[0.96]"
              aria-label="Close reactions"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-[112px_minmax(0,1fr)] sm:grid-cols-[150px_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto border-r border-rm-border p-3 custom-scrollbar">
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

            <section className="min-h-0 overflow-y-auto p-4 custom-scrollbar">
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
                    <p className="py-4 text-center text-sm text-rm-text-muted">
                      No users found for this reaction.
                    </p>
                  )}
                </div>
              ) : null}
            </section>
          </div>
        </dialog>
      </div>
    </BaseModal>
  );
}
