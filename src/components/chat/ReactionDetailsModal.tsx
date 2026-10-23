import { AvatarImage } from "@/components/chat/AvatarImage";
import { DialogPortal, DialogSurface } from "@/components/ui/dialog";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { IconButton } from "@/components/ui/IconButton";
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
    <div className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors pointer-fine:hover:bg-rm-bg-hover">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rm-bg-surface text-ui-sm font-semibold text-rm-text-muted">
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
        "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-[background-color,color,transform] active:scale-[0.97]",
        selected
          ? "bg-rm-accent-tint text-rm-accent-ink"
          : "text-rm-text-muted pointer-fine:hover:bg-rm-tint-1 pointer-fine:hover:text-rm-text",
      )}
    >
      <EmojiToken
        value={reaction.emoji}
        customEmojiMap={customEmojiMap}
        size="large"
        className="h-8 w-8 shrink-0"
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
  const isMobile = useIsMobile();
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

  const body = (
    <div
      className={cn(
        "grid min-h-0 flex-1 grid-cols-[112px_minmax(0,1fr)] sm:grid-cols-[150px_minmax(0,1fr)]",
        isMobile && "h-[min(420px,55dvh)] flex-none",
      )}
    >
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
              <p className="py-4 text-center text-ui-sm text-rm-text-muted">
                No users found for this reaction.
              </p>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
    >
      {isMobile ? (
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Reactions</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          {body}
        </ResponsiveDialogContent>
      ) : (
        <DialogPortal>
          <div
            data-state={open ? "open" : "closed"}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 transition-opacity duration-200 data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0 sm:p-5"
            onClick={(event) => {
              if (event.target === event.currentTarget) onClose();
            }}
            role="presentation"
          >
            <DialogSurface
              showCloseButton={false}
              className="relative m-0 flex h-[min(640px,calc(100dvh-24px))] min-h-[340px] w-full max-w-[720px] flex-col overflow-hidden rounded-xl border border-rm-border bg-rm-bg-surface dark:bg-rm-bg-elevated p-0 shadow-[var(--rm-shadow-3)] outline-none animate-in fade-in zoom-in-95 duration-200 sm:h-[min(640px,calc(100dvh-48px))]"
            >
              <header className="flex shrink-0 items-center justify-between border-b border-rm-border px-5 py-4">
                <h2
                  id="reaction-details-title"
                  className="text-ui-lg font-semibold text-rm-text"
                >
                  Reactions
                </h2>
                <IconButton
                  icon="close"
                  type="button"
                  onClick={onClose}
                  aria-label="Close reactions"
                />
              </header>

              {body}
            </DialogSurface>
          </div>
        </DialogPortal>
      )}
    </ResponsiveDialog>
  );
}
