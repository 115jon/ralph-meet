import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { IconButton } from "@/components/ui/IconButton";
import { REVEAL } from "@/components/ui/interaction";
import { Num } from "@/components/ui/num";
import { useUserResolution } from "@/hooks/useUserResolution";
import { getNextReactionEmoji } from "@/lib/reaction-details";
import type { Message, Reaction } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import EmojiToken from "./EmojiToken";
import InlineEmojiText from "./InlineEmojiText";
import { PreviewAvatar } from "./MessagePreviewCard";

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

/** 36px row: avatar 24, name 13/18 at 500, @handle ink-3, remove on hover. */
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
    <li className="group relative flex h-9 items-center gap-2.5 rounded-sm px-2 pointer-fine:hover:bg-tint-1">
      <PreviewAvatar
        name={displayName}
        src={avatarUrl}
        display={avatarDisplay}
        size={24}
      />
      <p className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="min-w-0 truncate text-ui-sm font-medium text-ink-1">
          <InlineEmojiText text={displayName} />
        </span>
        <span className="min-w-0 shrink truncate text-ui-xs text-ink-3">
          @{username}
        </span>
      </p>
      {canManageReactions && (
        <IconButton
          icon="close"
          size={24}
          variant="destructive"
          type="button"
          onClick={onRemove}
          className={cn("shrink-0", REVEAL)}
          aria-label={`Remove reaction from ${displayName}`}
        />
      )}
    </li>
  );
}

/** One emoji tab: emoji 20 plus its count in `Num`, underline when selected. */
function ReactionTab({
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
        "relative flex h-9 shrink-0 items-center gap-1.5 rounded-sm px-2 transition-colors duration-(--dur-1) ease-out focus-visible:-outline-offset-2",
        "after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full after:bg-ink-1 after:opacity-0 after:transition-opacity after:duration-(--dur-2)",
        selected
          ? "text-ink-1 after:opacity-100"
          : "text-ink-3 pointer-fine:hover:bg-tint-1 pointer-fine:hover:text-ink-1",
      )}
    >
      <EmojiToken
        value={reaction.emoji}
        customEmojiMap={customEmojiMap}
        className="size-5 shrink-0"
        fallbackClassName="max-w-24 truncate text-ui-sm leading-none"
      />
      <Num className={selected ? "font-semibold" : undefined}>
        {reaction.count}
      </Num>
    </button>
  );
}

/**
 * Who reacted (messages audit flows 8 and 9): a compact 400px dialog (a
 * drawer on phones) with emoji tabs across the top and 36px people rows
 * below. When the server sent fewer user ids than the count, the list says
 * "and N others" instead of silently looking complete.
 */
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
  const others = selectedReaction
    ? Math.max(0, selectedReaction.count - selectedUsers.length)
    : 0;

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
      <ResponsiveDialogContent
        size="sm"
        initialFocus="surface"
        className="gap-3"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Reactions</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div
          role="group"
          aria-label="Reactions by emoji"
          className="-mx-5 flex gap-0.5 overflow-x-auto overscroll-contain border-b border-line px-4 [scrollbar-width:none] max-md:-mx-4 max-md:px-3"
        >
          {reactions.map((reaction) => (
            <ReactionTab
              key={reaction.emoji}
              reaction={reaction}
              selected={reaction.emoji === activeSelectedEmoji}
              customEmojiMap={customEmojiMap}
              onClick={() => setSelectedEmoji(reaction.emoji)}
            />
          ))}
        </div>

        {selectedReaction ? (
          <div className="-mx-3 max-h-[min(324px,50dvh)] min-h-0 overflow-y-auto overscroll-contain px-1 py-1">
            {selectedUsers.length > 0 ? (
              <ul className="flex flex-col">
                {selectedUsers.map((userId) => (
                  <ReactionUserRow
                    key={userId}
                    userId={userId}
                    canManageReactions={canManageReactions}
                    onRemove={() =>
                      onRemoveReaction(selectedReaction.emoji, userId)
                    }
                  />
                ))}
              </ul>
            ) : null}
            {others > 0 ? (
              <p className="flex h-9 items-center px-2 text-ui-sm text-ink-3">
                <span>
                  {selectedUsers.length > 0 ? "and " : ""}
                  <Num className="text-ink-2">{others}</Num>
                  {selectedUsers.length > 0
                    ? others === 1
                      ? " other"
                      : " others"
                    : others === 1
                      ? " person reacted"
                      : " people reacted"}
                </span>
              </p>
            ) : null}
          </div>
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
