import { LONG_PRESS_TARGET, useLongPressMenu } from "@/hooks/useLongPress";
import { copyToClipboard, toast } from "@/components/ui/toast";
import { AvatarImage } from "@/components/chat/AvatarImage";
import { avatarShape } from "@/components/ui/avatar-shape";
import { openSettings } from "@/components/chat/settings/settings-links";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import { DeleteMessageDialog } from "@/components/chat/DeleteMessageDialog";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { Kbd } from "@/components/ui/kbd";
import { Num } from "@/components/ui/num";
import { useAnimateEnter } from "@/components/ui/tree";
import { HIT, PRESS, REVEAL } from "@/components/ui/interaction";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getDisplayInitial } from "@/lib/display-name";
import { useContextMenu } from "@/hooks/useContextMenu";
import { useCustomEmojiLookup } from "@/hooks/useCustomEmojiLookup";
import { useEmojiDataReady } from "@/hooks/useEmojiDataReady";
import { useUserResolution } from "@/hooks/useUserResolution";
import { isMessageListScrolling } from "./message-list-scroll";
import { getAttachmentUrl } from "@/lib/attachment-url";
import type { ClientDateFormatter } from "@/lib/client-date-format";
import { extractCustomEmojiIds, type EmojiRecentItem } from "@/lib/emoji";
import {
  formatReactionUserNames,
  getReactionEmojiLabel,
} from "@/lib/reaction-tooltip";
import {
  getQuickReactionItems,
  rememberRecentReaction,
} from "@/lib/message-reaction-recents";
import { createAttachmentClipFavorite } from "@/lib/gif-favorite-item";
import type { Message, Reaction } from "@/lib/types";
import { shouldBlurSensitiveAttachment } from "@/lib/media-safety";
import { cn } from "@/lib/utils";
import { useChatActions, useChatStore } from "@/stores/chat-store";
import { COMPOSER_RESTORE_EVENT, useFailedSend } from "@/stores/chat-actions";
import { useMediaSafetySettingsStore } from "@/stores/useMediaSafetySettingsStore";
import { useExternalLinkConfirmation } from "@/hooks/useExternalLinkConfirmation";
import {
  copyMediaLink,
  getPublicMediaUrl,
  saveMedia,
} from "@/lib/media-actions";

import { getFileIcon } from "@/lib/file-icons";
import { createAttachmentGifFavorite } from "@/lib/gif-favorite-item";
import { isAnimatedMedia, isPlayableVideo } from "@/lib/media";
import { getAuthAssetUrl, getDownloadUrl, getMediaUrl } from "@/lib/platform";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContextMenuItem } from "./ContextMenu";
import ContextMenu from "./ContextMenu";
import EmojiPicker from "./EmojiPicker";
import EmojiToken from "./EmojiToken";
import { MessageReactionSubmenu } from "./MessageReactionSubmenu";
import { Icon } from "@/components/ui/icon";
import { ImageGrid } from "./ImageGrid";
import { GifFavoriteButton } from "./GifFavoriteButton";
import { LinkEmbed } from "./LinkEmbed";
import { MarkdownRenderer } from "./MarkdownRenderer";
import MessageShareModal from "./MessageShareModal";
import ReactionDetailsModal from "./ReactionDetailsModal";
import SensitiveMediaFrame from "./SensitiveMediaFrame";
import UserProfilePopover from "./UserProfilePopover";
import VideoAttachment from "./VideoAttachment";
import {
  ReplyPreviewContent,
  getReplyPreviewText,
} from "./ReplyPreviewContent";
import { mentionsViewer, roleInk, topRoleColor } from "./message-author";
import { ensureShiftAttribute, isShiftHeld } from "./message-shift";
import { useMessageTimeFormat } from "./message-time";

interface Props {
  id?: string;
  message: Message;
  showHeader: boolean;
  onReply?: (message: Message) => void;
  onPin?: (message: Message) => void;
  onUnpin?: (messageId: string, skipConfirm?: boolean) => void;
  onJump?: (messageId: string) => void;
  onBan?: (userId: string, username: string) => void;
  onThread?: (messageId: string) => void;
  currentUserId?: string;
  canPin?: boolean;
  canDeleteMessages?: boolean;
  hideReplyConnector?: boolean;
  onMediaPlay?: () => void;
  onMediaStop?: () => void;
  onManageShares?: () => void;
  onVisible?: () => void;
  onHeightChange?: () => void;
  previewOnly?: boolean;
}

const MESSAGE_DAY_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
};

function formatLegacyTime(iso: string, formatDate: ClientDateFormatter) {
  return formatDate(iso, { hour: "numeric", minute: "2-digit", hour12: true });
}

/**
 * Search results still print "Today at 8:12 PM" style dates (rows now show
 * the time only, under day dividers). Kept for `SearchResultItem`.
 */
export function formatMessageDate(
  iso: string,
  formatClientDate: ClientDateFormatter,
  referenceTime: number | null,
): string {
  const messageDate = new Date(iso);
  if (!Number.isFinite(messageDate.getTime())) {
    return formatClientDate(iso, MESSAGE_DAY_OPTIONS);
  }

  const messageDay = formatClientDate(messageDate, MESSAGE_DAY_OPTIONS);

  if (referenceTime !== null) {
    const today = formatClientDate(referenceTime, MESSAGE_DAY_OPTIONS);
    const yesterdayDate = new Date(referenceTime);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = formatClientDate(yesterdayDate, MESSAGE_DAY_OPTIONS);

    if (messageDay === today) {
      return `Today at ${formatLegacyTime(iso, formatClientDate)}`;
    }
    if (messageDay === yesterday) {
      return `Yesterday at ${formatLegacyTime(iso, formatClientDate)}`;
    }
  }

  return `${messageDay} ${formatLegacyTime(iso, formatClientDate)}`;
}

/** Taps on these keep their own meaning and don't toggle the row's time. */
const TAP_INTERACTIVE =
  "a, button, input, textarea, select, video, audio, [role='button'], [contenteditable='true']";

function isCoarsePointer() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const QUICK_REACTION_BUTTON_LIMIT = 4;
const RECENT_REACTION_MENU_LIMIT = 5;
/** The hover bar unmounts this long after the pointer leaves (exit fade). */
const BAR_UNMOUNT_MS = 200;
/** Delete: the row fades for this long, then collapses in one frame. */
const DELETE_FADE_MS = 140;

function buildRecentEmojiTokenMap(
  items: EmojiRecentItem[],
): Record<string, { image_url?: string | null }> {
  return items.reduce<Record<string, { image_url?: string | null }>>(
    (map, item) => {
      if (item.type === "custom" && item.imageUrl) {
        map[item.id] = { image_url: item.imageUrl };
      }
      return map;
    },
    {},
  );
}

function getAttachmentSourceUrl(att: { url?: string; file_key: string }) {
  return att.url || getAttachmentUrl(att.file_key);
}

function buildMessageLink(
  serverId: string | null,
  channelId: string,
  messageId: string,
): string {
  if (typeof window === "undefined") return "";
  const serverSegment = encodeURIComponent(serverId || "@me");
  return `${window.location.origin}/chat/${serverSegment}/${encodeURIComponent(channelId)}?message=${encodeURIComponent(messageId)}`;
}

// ── Hover bar pieces ────────────────────────────────────────────────────────

function ToolbarSeparator() {
  return (
    <div aria-hidden className="mx-0.5 my-auto h-4 w-px shrink-0 bg-line" />
  );
}

/** A quick reaction in the hover bar: 28px, an 18px emoji, like its siblings. */
function ToolbarEmojiButton({
  item,
  customEmojiMap,
  onClick,
}: {
  item: EmojiRecentItem;
  customEmojiMap: Record<string, { image_url?: string | null }>;
  onClick: (item: EmojiRecentItem) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onClick(item)}
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-sm",
            PRESS,
            "enabled:active:scale-(--motion-press-icon)",
          )}
          aria-label={`React with ${item.label}`}
        >
          <EmojiToken
            value={item.insertText}
            customEmojiMap={customEmojiMap}
            className="size-4.5"
            fallbackClassName="text-ui-md leading-none"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Text only: interactive content inside a tooltip can't be reached by keyboard. */
function ReactionTooltipText({
  emoji,
  count,
  users,
}: {
  emoji: string;
  count: number;
  users: string[];
}) {
  const visibleUsers = users.slice(0, 3);
  const firstUser = useUserResolution(visibleUsers[0]);
  const secondUser = useUserResolution(visibleUsers[1]);
  const thirdUser = useUserResolution(visibleUsers[2]);
  const userNames = [
    firstUser.displayName,
    secondUser.displayName,
    thirdUser.displayName,
  ].slice(0, visibleUsers.length);

  return (
    <span className="block max-w-64 text-pretty">
      {formatReactionUserNames(userNames, count)} reacted with{" "}
      {getReactionEmojiLabel(emoji)}
    </span>
  );
}

// ── Reactions ───────────────────────────────────────────────────────────────

interface ReactionStripProps {
  reactions: Reaction[];
  currentUserId?: string;
  customEmojiMap: Record<string, { image_url?: string | null }>;
  previewOnly: boolean;
  onToggle: (emoji: string) => void;
  onOpenDetails: (emoji: string) => void;
  addButton?: React.ReactNode;
}

/**
 * C1 square chips: 28px, 2px corners, a line-strong edge, the count in
 * Martian (`Num`); yours in accent tint/ink with an accent edge. New chips
 * use list-enter (only after this strip has painted, so history never
 * animates); removing your own last reaction fades the chip before it goes.
 * Right-click a chip for the full list of who reacted.
 */
function ReactionStrip({
  reactions,
  currentUserId,
  customEmojiMap,
  previewOnly,
  onToggle,
  onOpenDetails,
  addButton,
}: ReactionStripProps) {
  const animateEnter = useAnimateEnter(!previewOnly);
  const [leaving, setLeaving] = useState<string | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    },
    [],
  );

  return (
    <TooltipProvider>
      <div
        className="mt-1.5 flex flex-wrap items-center gap-1.5"
        data-animate-enter={animateEnter || undefined}
      >
        {reactions.map((reaction) => {
          const reactionUsers = reaction.users ?? [];
          const hasReacted = reactionUsers.includes(currentUserId ?? "");
          const isLeaving = leaving === reaction.emoji;
          const handleClick = () => {
            if (previewOnly) return;
            if (hasReacted && reaction.count <= 1) {
              setLeaving(reaction.emoji);
              leaveTimer.current = setTimeout(() => {
                setLeaving(null);
                onToggle(reaction.emoji);
              }, 100);
              return;
            }
            onToggle(reaction.emoji);
          };
          return (
            <Tooltip key={reaction.emoji}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-pressed={hasReacted}
                  aria-label={`${hasReacted ? "Remove" : "Add"} ${getReactionEmojiLabel(reaction.emoji)} reaction, ${reaction.count}`}
                  data-leaving={isLeaving || undefined}
                  className={cn(
                    "rm-list-enter inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[2px] border px-2",
                    PRESS,
                    HIT,
                    "transition-[opacity,scale,background-color,color] duration-(--dur-1) ease-out",
                    "data-leaving:scale-90 data-leaving:opacity-0 data-leaving:duration-(--dur-2-exit)",
                    previewOnly && "cursor-default",
                    hasReacted
                      ? "border-accent-ink bg-accent-tint text-accent-ink"
                      : "border-line-strong text-ink-2 pointer-fine:hover:border-ink-2 pointer-fine:hover:text-ink-1",
                  )}
                  onClick={previewOnly ? undefined : handleClick}
                  onContextMenu={
                    previewOnly
                      ? undefined
                      : (event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onOpenDetails(reaction.emoji);
                        }
                  }
                >
                  <EmojiToken
                    value={reaction.emoji}
                    customEmojiMap={customEmojiMap}
                    size="reaction"
                    className="size-4"
                    fallbackClassName="max-w-20 truncate text-ui-xs"
                  />
                  <Num className="font-semibold">{reaction.count}</Num>
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={6}
                className="hidden md:block"
              >
                <ReactionTooltipText
                  emoji={reaction.emoji}
                  count={reaction.count}
                  users={reactionUsers}
                />
              </TooltipContent>
            </Tooltip>
          );
        })}
        {addButton}
      </div>
    </TooltipProvider>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────────

const MessageItem = memo(
  ({
    id,
    message,
    showHeader,
    onReply,
    onPin,
    onUnpin,
    onJump,
    onBan,
    onThread,
    currentUserId,
    canPin: propCanPin,
    canDeleteMessages = false,
    hideReplyConnector = false,
    onMediaPlay,
    onMediaStop,
    onManageShares,
    onVisible,
    onHeightChange,
    previewOnly = false,
  }: Props) => {
    const time = useMessageTimeFormat();
    const {
      addReaction,
      removeReaction,
      editMessage,
      deleteMessage,
      markChannelUnread,
      setProfileUser,
      removeEmbeds,
      createMessageShare,
    } = useChatActions();
    const activeServerId = useChatStore((state) => state.activeServerId);
    const viewerUsername = useChatStore((state) => state.user?.username);
    const roleColor = useChatStore((state) =>
      topRoleColor(state.members, message.author_id),
    );
    const failedSend = useFailedSend(
      message.pending ? message.nonce : undefined,
    );
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [showReactionEmojiPicker, setShowReactionEmojiPicker] =
      useState(false);
    const [showReactionDetails, setShowReactionDetails] = useState(false);
    const [reactionDetailsEmoji, setReactionDetailsEmoji] = useState<
      string | null
    >(null);
    const [showProfile, setShowProfile] = useState(false);
    const [editing, setEditing] = useState(false);
    const [showShareModal, setShowShareModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    // Touch has no hover: a tap on a grouped row (one without its own header)
    // reveals its time in the gutter until the next tap.
    const [timeRevealed, setTimeRevealed] = useState(false);
    const [editInput, setEditInput] = useState("");
    // Optimistic edit: the saved text shows at once; `(edited)` stays dim
    // until the server echo carries the same content.
    const [savingContent, setSavingContent] = useState<string | null>(null);
    // Optimistic delete: fade, then collapse; restored if the server refuses.
    const [deleting, setDeleting] = useState<"fading" | "gone" | null>(null);
    const [toolbarQuickReactions, setToolbarQuickReactions] = useState<
      EmojiRecentItem[]
    >([]);
    // The hover bar exists only while the row is hovered or focused (plus a
    // short exit), so a session doesn't pile up mounted bars.
    const [interactive, setInteractive] = useState(false);
    const [authorNameEl, setAuthorNameEl] = useState<HTMLElement | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const visibilityReportedRef = useRef(false);
    const editTextAreaRef = useRef<HTMLTextAreaElement>(null);
    const emojiBtnRef = useRef<HTMLButtonElement>(null);
    const reactionEmojiBtnRef = useRef<HTMLButtonElement>(null);
    const contextEmojiPickerAnchorRef = useRef<HTMLSpanElement>(null);
    const barTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { menu, openMenu, closeMenu, shouldRender, isClosing } =
      useContextMenu();
    const { requestOpen: requestOpenExternalLink, confirmation } =
      useExternalLinkConfirmation();
    const [contextEmojiPickerAnchor, setContextEmojiPickerAnchor] = useState<{
      x: number;
      y: number;
    } | null>(null);

    useEffect(() => {
      if (!previewOnly) ensureShiftAttribute();
    }, [previewOnly]);

    useEffect(
      () => () => {
        if (barTimerRef.current) clearTimeout(barTimerRef.current);
        if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      },
      [],
    );

    // Reaction labels and the fallback quick reactions resolve emoji during
    // render; re-run both once lazily loaded emoji data lands (desktop).
    const emojiDataReady = useEmojiDataReady();
    useEffect(() => {
      // Load persisted reaction preferences only after the server snapshot exists.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToolbarQuickReactions(getQuickReactionItems(3));
    }, [emojiDataReady]);

    // The echo arrived with the text we saved: drop the optimistic copy.
    useEffect(() => {
      if (savingContent !== null && message.content === savingContent) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSavingContent(null);
      }
    }, [message.content, savingContent]);

    const authorInfo = useUserResolution(message.author_id, message.author);
    const replyInfo = useUserResolution(
      message.reply_to?.author_id,
      message.reply_to?.author,
    );
    const contentFilter = useMediaSafetySettingsStore(
      (state) => state.getSettings(state.currentUser).contentFilter,
    );
    const reactionEmojiIds = useMemo(
      () =>
        extractCustomEmojiIds(
          message.reactions?.map((reaction) => reaction.emoji).join(" ") ?? "",
        ),
      [message.reactions],
    );
    const reactionEmojiMap = useCustomEmojiLookup(reactionEmojiIds);
    const toolbarQuickReactionEmojiMap = useMemo(
      () => buildRecentEmojiTokenMap(toolbarQuickReactions),
      [toolbarQuickReactions],
    );
    const mentionsMe = useMemo(
      () =>
        !previewOnly &&
        mentionsViewer(message, {
          id: currentUserId,
          username: viewerUsername,
        }),
      [currentUserId, message, previewOnly, viewerUsername],
    );

    const handleTextareaRef = useCallback(
      (el: HTMLTextAreaElement | null) => {
        editTextAreaRef.current = el;
        if (el && editing) {
          el.focus();
          const length = el.value.length;
          el.setSelectionRange(length, length);
        }
      },
      [editing],
    );

    // Listen for external edit trigger (↑ arrow key in MessageInput)
    useEffect(() => {
      const handler = () => {
        if (previewOnly) return;
        setEditing(true);
        setEditInput(message.content);
      };
      window.addEventListener(`edit-message-${message.id}`, handler);
      return () =>
        window.removeEventListener(`edit-message-${message.id}`, handler);
    }, [message.id, message.content, previewOnly]);

    const onHeightChangeRef = useRef(onHeightChange);
    useEffect(() => {
      onHeightChangeRef.current = onHeightChange;
    }, [onHeightChange]);

    const hasDynamicMedia =
      (message.attachments?.length ?? 0) > 0 ||
      (message.embeds?.length ?? 0) > 0;

    useEffect(() => {
      const el = rootRef.current;
      if (!el || !onHeightChange || !hasDynamicMedia) return;
      if (isMessageListScrolling()) return;

      let previousHeight = el.clientHeight;

      const observer = new ResizeObserver(() => {
        const actualHeight = el.clientHeight;
        if (actualHeight !== previousHeight) {
          previousHeight = actualHeight;
          onHeightChangeRef.current?.();
        }
      });

      observer.observe(el);
      return () => {
        observer.disconnect();
      };
    }, [hasDynamicMedia, onHeightChange]);

    useEffect(() => {
      if (!onVisible || visibilityReportedRef.current) return;
      if (isMessageListScrolling()) return;

      const el = rootRef.current;
      if (!el) return;
      let observer: IntersectionObserver | null = null;

      const reportVisible = () => {
        if (visibilityReportedRef.current) return;
        visibilityReportedRef.current = true;
        observer?.disconnect();
        onVisible();
      };

      if (typeof IntersectionObserver === "undefined") {
        const rect = el.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top < window.innerHeight) {
          reportVisible();
        }
        return;
      }

      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            reportVisible();
          }
        },
        { threshold: 0.3 },
      );

      observer.observe(el);
      return () => observer.disconnect();
    }, [onVisible]);

    const toggleReaction = useCallback(
      (emoji: string) => {
        if (!message.channel_id) return;
        const hasReacted = message.reactions
          ?.find((r) => r.emoji === emoji)
          ?.users?.includes(currentUserId ?? "");
        if (hasReacted) {
          removeReaction(message.channel_id, message.id, emoji);
        } else {
          addReaction(message.channel_id, message.id, emoji);
        }
      },
      [
        addReaction,
        currentUserId,
        message.channel_id,
        message.id,
        message.reactions,
        removeReaction,
      ],
    );

    const closeToolbarEmojiPicker = useCallback(() => {
      setShowEmojiPicker(false);
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => emojiBtnRef.current?.focus());
      }
    }, []);

    const closeInlineEmojiPicker = useCallback(() => {
      setShowReactionEmojiPicker(false);
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() =>
          reactionEmojiBtnRef.current?.focus(),
        );
      }
    }, []);

    const openReactionDetails = useCallback((emoji: string) => {
      setShowEmojiPicker(false);
      setShowReactionEmojiPicker(false);
      setContextEmojiPickerAnchor(null);
      setReactionDetailsEmoji(emoji);
      setShowReactionDetails(true);
    }, []);

    const closeReactionDetails = useCallback(() => {
      setShowReactionDetails(false);
      setReactionDetailsEmoji(null);
    }, []);

    const handleRemoveReactionForUser = useCallback(
      (emoji: string, userId: string) => {
        if (!message.channel_id) return;
        void removeReaction(message.channel_id, message.id, emoji, userId);
      },
      [message.channel_id, message.id, removeReaction],
    );

    const handleQuickReaction = useCallback(
      (item: EmojiRecentItem) => {
        if (!message.channel_id) return;

        const hasReacted = message.reactions
          ?.find((reaction) => reaction.emoji === item.insertText)
          ?.users?.includes(currentUserId ?? "");

        if (!hasReacted) {
          rememberRecentReaction(item);
          setToolbarQuickReactions(getQuickReactionItems(3));
        }

        toggleReaction(item.insertText);
        closeMenu();
      },
      [
        closeMenu,
        currentUserId,
        message.channel_id,
        message.reactions,
        toggleReaction,
      ],
    );

    const handleEmojiPickerSelect = useCallback(
      (emoji: string) => {
        toggleReaction(emoji);
        setShowEmojiPicker(false);
        setShowReactionEmojiPicker(false);
        setContextEmojiPickerAnchor(null);
        setToolbarQuickReactions(getQuickReactionItems(3));
      },
      [toggleReaction],
    );

    const openReactionPickerFromMenu = useCallback(
      (event: React.MouseEvent<HTMLElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setShowEmojiPicker(false);
        setShowReactionEmojiPicker(false);
        setContextEmojiPickerAnchor({
          x: rect.left,
          y: rect.bottom,
        });
        closeMenu();
      },
      [closeMenu],
    );

    const handlePinToggle = useCallback(
      (skipConfirm = false) => {
        if (!message.channel_id) return;
        if (message.is_pinned) {
          onUnpin?.(message.id, skipConfirm);
        } else {
          onPin?.(message);
        }
      },
      [message, onPin, onUnpin],
    );

    const startEditing = useCallback(() => {
      setEditing(true);
      setEditInput(savingContent ?? message.content);
    }, [message.content, savingContent]);

    const cancelEditing = useCallback(() => {
      setEditing(false);
      setEditInput("");
    }, []);

    const performDelete = useCallback(() => {
      if (!message.channel_id) return;
      const channelId = message.channel_id;
      setDeleting("fading");
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(
        () => setDeleting((current) => (current ? "gone" : current)),
        DELETE_FADE_MS,
      );
      deleteMessage(channelId, message.id).catch(() => {
        if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
        setDeleting(null);
        toast.error("Couldn't delete the message", {
          id: `delete-${message.id}`,
          description: "Check your connection and try again.",
        });
      });
    }, [deleteMessage, message.channel_id, message.id]);

    const handleDelete = useCallback(
      (skipConfirm = false) => {
        if (!message.channel_id || previewOnly) return;
        if (skipConfirm) {
          performDelete();
          return;
        }
        setShowDeleteModal(true);
      },
      [message.channel_id, performDelete, previewOnly],
    );

    const handleEditSubmit = useCallback(() => {
      const next = editInput.trim();
      setEditing(false);
      setEditInput("");
      if (!next) {
        // Discord habit: saving an empty edit asks to delete the message.
        handleDelete(false);
        return;
      }
      if (next === (savingContent ?? message.content)) return;
      setSavingContent(next);
      editMessage(message.id, next).catch(() => {
        setSavingContent(null);
        toast.error("Couldn't save your edit", {
          id: `edit-${message.id}`,
          description: "Your message is unchanged. Try editing it again.",
        });
      });
    }, [
      editInput,
      editMessage,
      handleDelete,
      message.content,
      message.id,
      savingContent,
    ]);

    const handleEditKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cancelEditing();
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleEditSubmit();
        }
      },
      [cancelEditing, handleEditSubmit],
    );

    const copyMessageId = useCallback(() => {
      void copyToClipboard(message.id, "Message ID copied");
    }, [message.id]);

    const copyMessageLink = useCallback(() => {
      if (!message.channel_id) return;
      void copyToClipboard(
        buildMessageLink(activeServerId, message.channel_id, message.id),
        "Message link copied",
      );
    }, [activeServerId, message.channel_id, message.id]);

    const handleMarkUnread = useCallback(() => {
      if (!message.channel_id) return;
      void markChannelUnread(
        message.channel_id,
        message.id,
        message.created_at,
      );
    }, [markChannelUnread, message.channel_id, message.created_at, message.id]);

    const handleDiscardFailed = useCallback(() => {
      if (!failedSend) return;
      const { channelId, content } = failedSend;
      failedSend.discard();
      if (content.trim() && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(COMPOSER_RESTORE_EVENT, {
            detail: { channelId, content },
          }),
        );
      }
    }, [failedSend]);

    const isOwnMessage = message.author_id === currentUserId;
    const canPin = propCanPin;
    const isSettled = !message.pending;

    const handleContextMenu = (e: React.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const hoveredAnchor = target?.closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      const hoveredEmbed = target?.closest?.(
        "[data-embed-url]",
      ) as HTMLElement | null;
      const hoveredMedia = target?.closest?.(
        "[data-media-element='true']",
      ) as HTMLElement | null;
      const hoveredUrl =
        hoveredAnchor?.href || hoveredEmbed?.dataset.embedUrl || null;
      const mediaUrl = hoveredMedia?.dataset.mediaUrl || null;
      const publicMediaUrl = mediaUrl ? getPublicMediaUrl(mediaUrl) : null;
      const mediaDownloadUrl = hoveredMedia?.dataset.mediaDownloadUrl || null;
      const mediaFilename = hoveredMedia?.dataset.mediaFilename || undefined;
      const quickReactions = getQuickReactionItems(RECENT_REACTION_MENU_LIMIT);
      const quickReactionButtons = isSettled
        ? quickReactions.slice(0, QUICK_REACTION_BUTTON_LIMIT)
        : [];
      const quickReactionEmojiMap = buildRecentEmojiTokenMap(quickReactions);
      const hasReactions = (message.reactions?.length ?? 0) > 0;

      setShowEmojiPicker(false);
      setShowReactionEmojiPicker(false);
      setContextEmojiPickerAnchor(null);

      const reactionSubmenu = (
        <MessageReactionSubmenu
          items={quickReactions}
          customEmojiMap={quickReactionEmojiMap}
          onReact={handleQuickReaction}
          onViewMore={openReactionPickerFromMenu}
        />
      );

      const items: ContextMenuItem[] = [
        ...(isSettled
          ? [
              {
                key: "add-reaction",
                label: "Add reaction",
                onClick: () => undefined,
                icon: <Icon name="react" size="sm" />,
                submenu: reactionSubmenu,
                closeOnClick: false,
                divider: !hasReactions,
              },
            ]
          : []),
        ...(isSettled && hasReactions
          ? [
              {
                label: "View reactions",
                icon: <Icon name="emoji" size="sm" />,
                onClick: () =>
                  openReactionDetails(message.reactions![0]!.emoji),
                divider: true,
              },
            ]
          : []),
        ...(isOwnMessage && isSettled
          ? [
              {
                label: "Edit message",
                icon: <Icon name="edit" size="sm" />,
                onClick: startEditing,
              },
            ]
          : []),
        ...(isSettled
          ? [
              {
                label: "Reply",
                icon: <Icon name="reply" size="sm" />,
                onClick: () => onReply?.(message),
              },
            ]
          : []),
        ...(onThread && isSettled
          ? [
              {
                label:
                  (message.reply_count ?? 0) > 0
                    ? "View thread"
                    : "Create thread",
                icon: <Icon name="thread" size="sm" />,
                onClick: () => onThread(message.id),
              },
            ]
          : []),
        ...(canPin && isSettled
          ? [
              {
                label: message.is_pinned ? "Unpin message" : "Pin message",
                icon: <Icon name="pin" size="sm" />,
                onClick: () => handlePinToggle(isShiftHeld()),
                divider: true,
              },
            ]
          : []),
        {
          label: "Copy text",
          icon: <Icon name="copy" size="sm" />,
          onClick: () => void copyToClipboard(message.content, "Text copied"),
        },
        // The hover bar keeps this behind Shift; touch reaches it here.
        ...(message.channel_id && isSettled
          ? [
              {
                label: "Mark unread",
                icon: <Icon name="markUnread" size="sm" />,
                onClick: handleMarkUnread,
              },
            ]
          : []),
        ...(hoveredUrl
          ? [
              {
                label: "Copy link",
                icon: <Icon name="link" size="sm" />,
                onClick: () => void copyToClipboard(hoveredUrl, "Link copied"),
              },
              {
                label: "Open link",
                icon: <Icon name="externalLink" size="sm" />,
                onClick: () => {
                  requestOpenExternalLink(hoveredUrl);
                },
              },
            ]
          : []),
        ...(message.channel_id && isSettled
          ? [
              {
                label: "Share message",
                icon: <Icon name="share" size="sm" />,
                onClick: () => setShowShareModal(true),
              },
            ]
          : []),
        {
          label: "Profile",
          icon: <Icon name="account" size="sm" />,
          onClick: () =>
            message.author && setProfileUser(message.author as any),
        },
        ...(isSettled
          ? [
              {
                label: "Copy ID",
                icon: <Icon name="copyId" size="sm" />,
                onClick: () =>
                  void copyToClipboard(message.id, "Message ID copied"),
                divider: isOwnMessage || canDeleteMessages || Boolean(onBan),
              },
            ]
          : []),
      ];

      if ((isOwnMessage || canDeleteMessages) && isSettled) {
        items.push({
          label: "Delete message",
          icon: <Icon name="trash" size="sm" />,
          onClick: () => handleDelete(isShiftHeld()),
          variant: "danger",
        });
      }

      if (!isOwnMessage && onBan) {
        items.push({
          label: "Ban user",
          icon: <Icon name="ban" size="sm" />,
          onClick: () => onBan(message.author_id, authorInfo.username),
          variant: "danger",
        });
      }

      if (publicMediaUrl) {
        if (items.length > 0) {
          items[items.length - 1] = {
            ...items[items.length - 1],
            divider: true,
          };
        }

        items.push(
          {
            label: "Save image",
            icon: <Icon name="download" size="sm" />,
            onClick: () => {
              void saveMedia({
                url: publicMediaUrl,
                downloadUrl: mediaDownloadUrl || undefined,
                filename: mediaFilename,
              });
            },
            divider: true,
          },
          {
            label: "Copy media link",
            icon: <Icon name="copy" size="sm" />,
            onClick: () => {
              void copyMediaLink(publicMediaUrl);
            },
          },
          {
            label: "Open media link",
            icon: <Icon name="externalLink" size="sm" />,
            onClick: () => requestOpenExternalLink(publicMediaUrl),
          },
        );
      }

      openMenu(e, items, {
        topContent:
          quickReactionButtons.length > 0 ? (
            <div className="flex items-center gap-1 px-1">
              {quickReactionButtons.map((item) => (
                <button
                  key={`${item.type}:${item.id}`}
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleQuickReaction(item);
                  }}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-sm bg-tint-1 text-ink-1",
                    PRESS,
                  )}
                  title={item.label}
                  aria-label={`React with ${item.label}`}
                >
                  <EmojiToken
                    value={item.insertText}
                    customEmojiMap={quickReactionEmojiMap}
                    className="size-5"
                    fallbackClassName="text-ui-md leading-none"
                  />
                </button>
              ))}
            </div>
          ) : undefined,
      });
    };

    // Touch has no hover toolbar and iOS never fires contextmenu: a long
    // press opens the same menu, as an action sheet on phones.
    const messageLongPress = useLongPressMenu(
      previewOnly ? undefined : handleContextMenu,
    );

    const keepBar = showEmojiPicker;
    const showBar =
      !previewOnly && (interactive || keepBar) && isSettled && !editing;

    const handlePointerEnter = useCallback(() => {
      if (barTimerRef.current) {
        clearTimeout(barTimerRef.current);
        barTimerRef.current = null;
      }
      setInteractive(true);
    }, []);

    const handlePointerLeave = useCallback(() => {
      if (barTimerRef.current) clearTimeout(barTimerRef.current);
      barTimerRef.current = setTimeout(() => {
        barTimerRef.current = null;
        if (rootRef.current?.contains(document.activeElement)) return;
        setInteractive(false);
      }, BAR_UNMOUNT_MS);
    }, []);

    const handleBlurCapture = useCallback(
      (event: React.FocusEvent<HTMLDivElement>) => {
        const next = event.relatedTarget as Node | null;
        if (next && event.currentTarget.contains(next)) return;
        if (event.currentTarget.matches(":hover")) return;
        handlePointerLeave();
      },
      [handlePointerLeave],
    );

    // Split attachments into image / video / file buckets
    // Only Chromium-playable video formats get the inline player; the rest are files.
    const imageAttachments =
      message.attachments?.filter((a) =>
        a.content_type?.startsWith("image/"),
      ) ?? [];
    const videoAttachments =
      message.attachments?.filter((a) => isPlayableVideo(a.content_type)) ?? [];
    const fileAttachments =
      message.attachments?.filter(
        (a) =>
          !a.content_type?.startsWith("image/") &&
          !isPlayableVideo(a.content_type),
      ) ?? [];

    const savingEdit =
      savingContent !== null && savingContent !== message.content;
    const displayedContent = savingEdit ? savingContent : message.content;
    const authorInk = roleInk(roleColor);
    const fullTime = time.full(message.created_at);
    const pending = message.pending && !failedSend;
    const replyPreviewText = message.reply_to
      ? getReplyPreviewText(
          message.reply_to.content,
          message.reply_to.attachment_count ??
            message.reply_to.attachments?.length ??
            0,
        )
      : "";

    const addReactionButton = !previewOnly ? (
      <div className="relative">
        <IconButton
          ref={reactionEmojiBtnRef}
          icon="react"
          size={28}
          tooltip="Add reaction"
          aria-label="Add another reaction"
          aria-haspopup="dialog"
          aria-expanded={showReactionEmojiPicker}
          variant="muted"
          tone={showReactionEmojiPicker ? "toggled" : "idle"}
          className={cn(!showReactionEmojiPicker && REVEAL)}
          onClick={() => {
            setShowEmojiPicker(false);
            setContextEmojiPickerAnchor(null);
            setShowReactionEmojiPicker((current) => !current);
          }}
        />
        {showReactionEmojiPicker && (
          <EmojiPicker
            open={showReactionEmojiPicker}
            placement="right"
            onSelect={handleEmojiPickerSelect}
            onClose={closeInlineEmojiPicker}
            markerRef={reactionEmojiBtnRef}
          />
        )}
      </div>
    ) : null;

    const reactButton = (
      <div className="relative">
        <IconButton
          ref={emojiBtnRef}
          icon="react"
          size={28}
          tooltip="Add reaction"
          aria-haspopup="dialog"
          aria-expanded={showEmojiPicker}
          tone={showEmojiPicker ? "toggled" : "idle"}
          onClick={() => {
            setShowReactionEmojiPicker(false);
            setContextEmojiPickerAnchor(null);
            setShowEmojiPicker((current) => !current);
          }}
        />
        {showEmojiPicker && (
          <EmojiPicker
            open={showEmojiPicker}
            placement="left"
            onSelect={handleEmojiPickerSelect}
            onClose={closeToolbarEmojiPicker}
            markerRef={emojiBtnRef}
          />
        )}
      </div>
    );

    return (
      <div
        ref={rootRef}
        id={id}
        data-message-row=""
        data-mention={mentionsMe || undefined}
        data-pending={pending || undefined}
        data-failed={failedSend ? "" : undefined}
        data-deleting={deleting ?? undefined}
        className={cn(
          "group/row group relative flex flex-col",
          "transition-[background-color,opacity] duration-(--dur-1) ease-out",
          // Pending dims only after 400ms, so a normal send never flickers.
          "data-pending:opacity-60 data-pending:delay-400 data-pending:duration-(--dur-2)",
          // Jump highlight: tint at once, hold, then a 300ms fade (the cue).
          "data-[highlight=on]:bg-accent-tint data-[highlight=off]:duration-300",
          deleting === "fading" &&
            "pointer-events-none opacity-0 duration-(--dur-3-exit)",
          deleting === "gone" && "hidden",
          !previewOnly &&
            (mentionsMe ? "bg-accent-tint" : "pointer-fine:hover:bg-tint-1"),
          !previewOnly && LONG_PRESS_TARGET,
          showHeader && !previewOnly && "mt-4",
        )}
        onContextMenu={previewOnly ? undefined : handleContextMenu}
        {...messageLongPress}
        data-time-revealed={timeRevealed || undefined}
        onClick={
          previewOnly || showHeader
            ? undefined
            : (e) => {
                if (!isCoarsePointer()) return;
                const target = e.target as HTMLElement;
                if (target.closest(TAP_INTERACTIVE)) return;
                setTimeRevealed((v) => !v);
              }
        }
        onPointerEnter={previewOnly ? undefined : handlePointerEnter}
        onPointerLeave={previewOnly ? undefined : handlePointerLeave}
        onFocusCapture={previewOnly ? undefined : handlePointerEnter}
        onBlurCapture={previewOnly ? undefined : handleBlurCapture}
      >
        {/* Reply: a guide stroke rises from the avatar's centre and turns
            into the quoted line, which starts on the text column. */}
        {message.reply_to && !hideReplyConnector && (
          <div className="relative flex h-5 items-center pr-6 pl-17">
            <button
              type="button"
              className={cn(
                "peer/reply relative flex min-w-0 max-w-[72ch] cursor-pointer items-center gap-1.5 rounded-xs border-0 bg-transparent p-0 text-left text-ui-xs text-ink-3 outline-none transition-colors duration-(--dur-1) ease-out pointer-fine:hover:text-ink-2",
                HIT,
              )}
              onClick={() => onJump?.(message.reply_to_id!)}
              aria-label={`Reply to ${replyInfo.displayName}: ${replyPreviewText}`}
            >
              <span
                className={cn(
                  "relative flex size-4 shrink-0 items-center justify-center bg-tint-3 font-display-tuned text-ui-2xs font-extrabold text-ink-2",
                  avatarShape(replyInfo.avatarUrl && replyInfo.avatarDisplay),
                )}
              >
                {replyInfo.avatarUrl ? (
                  <AvatarImage
                    src={getAuthAssetUrl(replyInfo.avatarUrl)}
                    alt=""
                    display={replyInfo.avatarDisplay}
                  />
                ) : (
                  getDisplayInitial({
                    display_name: replyInfo.displayName,
                    username: replyInfo.username,
                  })
                )}
              </span>
              <ProfileDisplayName
                text={replyInfo.displayName}
                displayNameStyle={replyInfo.displayNameStyle}
                className="block max-w-40 shrink-0 truncate text-ui-xs font-semibold text-ink-2 [&_*]:[animation-play-state:paused]"
              />
              <span className="min-w-0 flex-1 truncate">
                <ReplyPreviewContent
                  content={message.reply_to.content}
                  attachmentsCount={
                    message.reply_to.attachment_count ??
                    message.reply_to.attachments?.length ??
                    0
                  }
                />
              </span>
            </button>
            <span
              aria-hidden
              className="pointer-events-none absolute top-2.5 -bottom-1 left-9 w-7 rounded-tl-sm border-t border-l border-guide transition-colors duration-(--dur-1) ease-out peer-hover/reply:border-line-strong peer-focus-visible/reply:border-line-strong"
            />
          </div>
        )}

        <div
          className={cn(
            "relative flex gap-3 pr-6 pl-4",
            showHeader ? "pt-0.5 pb-0.5" : "py-0.5",
          )}
        >
          {/* Avatar, or the time in the gutter for grouped follow-ups */}
          {showHeader ? (
            <button
              type="button"
              className={cn(
                "relative mt-0.5 flex size-10 shrink-0 cursor-pointer items-center justify-center border-0 bg-tint-3 p-0 font-display-tuned text-[18px] leading-none font-extrabold text-ink-1 transition-opacity duration-(--dur-1) pointer-fine:hover:opacity-85",
                // No clip: HIT's pseudo-element extends the target outward.
                avatarShape(authorInfo.avatarUrl && authorInfo.avatarDisplay, {
                  clip: false,
                }),
                HIT,
              )}
              onClick={() => setShowProfile(true)}
              aria-label={`View ${authorInfo.displayName}'s profile`}
            >
              {authorInfo.avatarUrl ? (
                <AvatarImage
                  src={getAuthAssetUrl(authorInfo.avatarUrl)}
                  alt=""
                  display={authorInfo.avatarDisplay}
                />
              ) : (
                getDisplayInitial({
                  display_name: authorInfo.displayName,
                  username: authorInfo.username,
                })
              )}
            </button>
          ) : (
            <div className="flex w-10 shrink-0 items-start justify-end pt-1 opacity-0 transition-opacity duration-(--dur-1) pointer-fine:group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-data-time-revealed/row:opacity-100">
              <time
                dateTime={message.created_at}
                title={fullTime}
                className="select-none whitespace-nowrap"
              >
                <Num className="text-ink-3">
                  {time.clock(message.created_at)}
                </Num>
              </time>
            </div>
          )}

          {/* Message body */}
          <div className="min-w-0 flex-1">
            {showHeader && (
              <div className="flex min-w-0 items-baseline gap-2">
                <button
                  type="button"
                  ref={setAuthorNameEl}
                  className={cn(
                    "min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-display-tuned text-[15px] leading-5 font-bold outline-none underline-offset-3 pointer-fine:hover:underline",
                    !authorInk && "text-ink-1",
                    // Name effects are static in the list and play while the
                    // row is hovered or focused (spec §6).
                    "[&_*]:[animation-play-state:paused] pointer-fine:group-hover/row:[&_*]:[animation-play-state:running] group-focus-within/row:[&_*]:[animation-play-state:running]",
                  )}
                  style={authorInk ? { color: authorInk } : undefined}
                  onClick={() => setShowProfile(true)}
                >
                  <ProfileDisplayName
                    text={authorInfo.displayName}
                    displayNameStyle={authorInfo.displayNameStyle}
                    className="block max-w-full truncate font-display-tuned text-[15px] leading-5 font-bold"
                  />
                </button>
                <MessageHeaderTime iso={message.created_at} full={fullTime}>
                  {time.time(message.created_at)}
                </MessageHeaderTime>
                {message.is_pinned && (
                  <span
                    className="inline-flex shrink-0 self-center text-ink-3"
                    title="Pinned"
                  >
                    <Icon name="pin" state="active" size="xs" />
                    <span className="sr-only">Pinned</span>
                  </span>
                )}
              </div>
            )}

            {/* Editing mode: the composer's recipe, so text doesn't move */}
            {editing ? (
              <div className="mt-0.5 max-w-[72ch]">
                <textarea
                  ref={handleTextareaRef}
                  value={editInput}
                  onChange={(e) => setEditInput(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  aria-label="Edit message"
                  rows={Math.min(8, Math.max(1, editInput.split("\n").length))}
                  className="-mx-3 block w-[calc(100%+1.5rem)] resize-none rounded-lg border border-line-field bg-ply-2 px-3 py-2 text-ui-base font-normal text-ink-1 outline-none transition-colors duration-(--dur-1) focus:border-focus"
                />
                <p className="mt-1 flex items-center gap-1.5 text-ui-xs text-ink-3">
                  <Kbd>Esc</Kbd>
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    onClick={cancelEditing}
                    className="text-ui-xs"
                  >
                    to cancel
                  </Button>
                  <span aria-hidden>·</span>
                  <Kbd>Enter</Kbd>
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    onClick={handleEditSubmit}
                    className="text-ui-xs"
                  >
                    to save
                  </Button>
                </p>
              </div>
            ) : (
              <div className="max-w-[72ch] whitespace-pre-wrap break-words text-ui-base text-ink-1">
                <MarkdownRenderer content={displayedContent} />
                {(message.updated_at || savingEdit) && (
                  <>
                    {" "}
                    <span
                      className={cn(
                        "whitespace-nowrap text-ui-xs text-ink-3 transition-opacity duration-(--dur-2)",
                        savingEdit && "opacity-60",
                      )}
                      title={
                        savingEdit
                          ? "Saving…"
                          : `Edited ${time.full(message.updated_at!)}`
                      }
                    >
                      (edited)
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Failed send: the row stays, with a way forward */}
            {failedSend && (
              <p
                role="status"
                className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-ui-xs"
              >
                <Icon name="warning" size="xs" className="text-danger-ink" />
                {failedSend.retrying ? (
                  <span className="text-ink-3">Sending…</span>
                ) : (
                  <>
                    <span className="font-medium text-danger-ink">
                      Not sent.
                    </span>
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      className="text-ui-xs"
                      onClick={() => void failedSend.retry()}
                    >
                      Retry
                    </Button>
                    <span aria-hidden className="text-ink-3">
                      ·
                    </span>
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      className="text-ui-xs text-ink-2"
                      onClick={handleDiscardFailed}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </p>
            )}

            {/* Social media embeds */}
            {!editing &&
              message.embeds?.map((embed, i) => (
                <div key={i} data-embed-url={embed.url}>
                  <LinkEmbed
                    embed={embed}
                    messageId={message.id}
                    onJumpToMessage={onJump}
                    onRemoveEmbeds={
                      !previewOnly && isOwnMessage && message.channel_id
                        ? () => removeEmbeds(message.channel_id!, message.id)
                        : undefined
                    }
                    onMediaPlay={onMediaPlay}
                    onMediaStop={onMediaStop}
                  />
                </div>
              ))}

            {/* Image attachments */}
            {imageAttachments.length > 0 && (
              <div className="mt-2">
                <ImageGrid
                  attachments={imageAttachments}
                  username={authorInfo.username}
                  displayName={authorInfo.displayName}
                  avatarUrl={authorInfo.avatarUrl}
                  avatarDisplay={authorInfo.avatarDisplay}
                  createdAt={message.created_at}
                  messageId={message.id}
                  onJumpToMessage={onJump}
                />
              </div>
            )}

            {/* Video attachments */}
            {videoAttachments.length > 0 && (
              <div className="mt-2 flex flex-col gap-2">
                {videoAttachments.map((att) =>
                  (() => {
                    const sourceUrl = getAttachmentSourceUrl(att);
                    const isGif = isAnimatedMedia(
                      att.content_type,
                      att.isGif,
                      att.url || att.file_key,
                    );
                    const favorite = isGif
                      ? createAttachmentGifFavorite({
                          id: att.id || sourceUrl,
                          filename: att.filename,
                          fileKeyOrUrl: att.file_key || att.url,
                          title: att.filename,
                          sourceUrl,
                          previewUrl: sourceUrl,
                          sendUrl: sourceUrl,
                          contentType: att.content_type,
                          sizeBytes: att.size_bytes,
                        })
                      : att.content_type === "video/mp4"
                        ? createAttachmentClipFavorite({
                            id: att.id || sourceUrl,
                            filename: att.filename,
                            fileKeyOrUrl: att.file_key || att.url,
                            title: att.filename,
                            sourceUrl,
                            previewUrl: att.thumbnailUrl || sourceUrl,
                            sendUrl: sourceUrl,
                            width: undefined,
                            height: undefined,
                            sizeBytes: att.size_bytes,
                          })
                        : null;

                    return (
                      <SensitiveMediaFrame
                        key={att.id}
                        attachmentId={att.id}
                        blur={shouldBlurSensitiveAttachment(att, contentFilter)}
                        className="relative w-fit max-w-full"
                        dataMediaProps={{
                          "data-media-element": "true",
                          "data-media-url": sourceUrl,
                          "data-media-download-url": getMediaUrl(sourceUrl),
                          "data-media-filename": att.filename,
                        }}
                      >
                        <VideoAttachment
                          src={getMediaUrl(sourceUrl)}
                          filename={att.filename}
                          brandingKey={att.file_key || att.url}
                          onPlay={onMediaPlay}
                          onStop={onMediaStop}
                        />
                        {favorite && <GifFavoriteButton gif={favorite} />}
                      </SensitiveMediaFrame>
                    );
                  })(),
                )}
              </div>
            )}

            {/* File attachments: the embed card anatomy at the 400 width */}
            {fileAttachments.length > 0 && (
              <div className="mt-2 flex max-w-100 flex-col gap-2">
                {fileAttachments.map((att) => {
                  const { icon: typeIcon } = getFileIcon(
                    att.filename,
                    att.content_type ?? undefined,
                  );
                  return (
                    <a
                      key={att.id}
                      href={getDownloadUrl(getAttachmentSourceUrl(att))}
                      download={att.filename}
                      className="group/file flex items-center gap-3 rounded-lg border border-line bg-ply-2 py-2 pr-3 pl-2 transition-colors duration-(--dur-1) pointer-fine:hover:border-line-strong"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-tint-2 text-ink-2">
                        <Icon name={typeIcon} size="lg" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ui-sm font-medium text-accent-ink underline-offset-3 pointer-fine:group-hover/file:underline">
                          {att.filename}
                        </span>
                        <Num size="sm" className="block text-ink-3">
                          {formatFileSize(att.size_bytes)}
                        </Num>
                      </span>
                      <Icon
                        name="download"
                        size="sm"
                        className="shrink-0 text-ink-3 transition-colors duration-(--dur-1) pointer-fine:group-hover/file:text-ink-1"
                      />
                    </a>
                  );
                })}
              </div>
            )}

            {/* Reactions */}
            {message.reactions && message.reactions.length > 0 && (
              <ReactionStrip
                reactions={message.reactions}
                currentUserId={currentUserId}
                customEmojiMap={reactionEmojiMap}
                previewOnly={previewOnly}
                onToggle={toggleReaction}
                onOpenDetails={openReactionDetails}
                addButton={addReactionButton}
              />
            )}

            {/* Thread summary */}
            {(message.reply_count ?? 0) > 0 && (
              <button
                type="button"
                onClick={previewOnly ? undefined : () => onThread?.(message.id)}
                disabled={previewOnly}
                className={cn(
                  "mt-1 inline-flex h-7 items-center gap-1.5 rounded-md bg-tint-1 px-2 text-ui-xs font-medium text-ink-2 pointer-fine:hover:text-ink-1",
                  PRESS,
                  HIT,
                )}
              >
                <Icon name="thread" size="sm" />
                <Num>{message.reply_count}</Num>
                {message.reply_count === 1 ? "reply" : "replies"}
                <Icon name="chevronRight" size="xs" className="text-ink-3" />
              </button>
            )}
          </div>

          {/* Hover action bar: a ply-3 float, radius 8, 28px buttons. It
              mounts on pointerenter/focus and fades in from scale .97 over
              100ms; keyboard focus gets the fade only. Shift swaps the
              variant through CSS (data-shift on <html>), never React state. */}
          {showBar && (
            <TooltipProvider>
              <div
                role="toolbar"
                aria-label="Message actions"
                data-open={keepBar || undefined}
                className={cn(
                  "pointer-events-none absolute -top-4 right-6 z-20 flex max-w-[calc(100vw-96px)] origin-bottom-right items-center gap-0.5 overflow-x-auto rounded-md border border-line bg-ply-3 p-0.5 shadow-float",
                  "scale-97 opacity-0 transition-[opacity,scale] duration-(--dur-1) ease-out",
                  "starting:scale-97 starting:opacity-0",
                  "pointer-fine:group-hover/row:pointer-events-auto pointer-fine:group-hover/row:scale-100 pointer-fine:group-hover/row:opacity-100",
                  "group-focus-within/row:pointer-events-auto group-focus-within/row:scale-100 group-focus-within/row:opacity-100 group-focus-within/row:transition-opacity",
                  "data-open:pointer-events-auto data-open:scale-100 data-open:opacity-100",
                )}
              >
                {/* Default variant: quick reactions */}
                <div className="flex items-center gap-0.5 [:root[data-shift]_&]:hidden">
                  {toolbarQuickReactions.map((item) => (
                    <ToolbarEmojiButton
                      key={`${item.type}:${item.id}`}
                      item={item}
                      customEmojiMap={toolbarQuickReactionEmojiMap}
                      onClick={handleQuickReaction}
                    />
                  ))}
                  {toolbarQuickReactions.length > 0 && <ToolbarSeparator />}
                </div>
                {/* Shift variant: power actions */}
                <div className="hidden items-center gap-0.5 [:root[data-shift]_&]:flex">
                  <IconButton
                    icon="copyId"
                    size={28}
                    tooltip="Copy message ID"
                    onClick={copyMessageId}
                  />
                  <IconButton
                    icon="link"
                    size={28}
                    tooltip="Copy message link"
                    onClick={copyMessageLink}
                  />
                  <IconButton
                    icon="markUnread"
                    size={28}
                    tooltip="Mark unread"
                    onClick={handleMarkUnread}
                  />
                  {canPin && (
                    <IconButton
                      icon="pin"
                      size={28}
                      tooltip={
                        message.is_pinned ? "Unpin message" : "Pin message"
                      }
                      tone={message.is_pinned ? "toggled" : "idle"}
                      onClick={() => handlePinToggle(true)}
                    />
                  )}
                  {onThread && (
                    <IconButton
                      icon="thread"
                      size={28}
                      tooltip={
                        (message.reply_count ?? 0) > 0
                          ? "View thread"
                          : "Create thread"
                      }
                      onClick={() => onThread(message.id)}
                    />
                  )}
                  <ToolbarSeparator />
                </div>

                {reactButton}
                <IconButton
                  icon="reply"
                  size={28}
                  tooltip="Reply"
                  onClick={() => onReply?.(message)}
                />
                {isOwnMessage && (
                  <IconButton
                    icon="edit"
                    size={28}
                    tooltip="Edit message"
                    onClick={startEditing}
                  />
                )}

                <div className="flex items-center gap-0.5 [:root[data-shift]_&]:hidden">
                  <IconButton
                    icon="more"
                    size={28}
                    tooltip="More"
                    onClick={handleContextMenu}
                  />
                </div>
                {(isOwnMessage || canDeleteMessages) && (
                  <div className="hidden items-center [:root[data-shift]_&]:flex">
                    <IconButton
                      icon="trash"
                      size={28}
                      variant="destructive"
                      tooltip="Delete message"
                      onClick={() => handleDelete(true)}
                    />
                  </div>
                )}
              </div>
            </TooltipProvider>
          )}

          {/* User profile popover */}
          {!previewOnly && showProfile && authorNameEl && (
            <UserProfilePopover
              userId={message.author_id}
              username={authorInfo.username}
              displayName={authorInfo.displayName}
              avatarUrl={authorInfo.avatarUrl}
              avatarDisplay={authorInfo.avatarDisplay}
              anchorEl={authorNameEl}
              onClose={() => setShowProfile(false)}
            />
          )}
        </div>

        {!previewOnly && shouldRender && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menu.items}
            topContent={menu.topContent}
            onClose={closeMenu}
            isClosing={isClosing}
          />
        )}

        {!previewOnly && confirmation}

        {!previewOnly && showReactionDetails && (
          <ReactionDetailsModal
            message={message}
            open={showReactionDetails}
            initialEmoji={reactionDetailsEmoji}
            canManageReactions={canDeleteMessages}
            customEmojiMap={reactionEmojiMap}
            onRemoveReaction={handleRemoveReactionForUser}
            onClose={closeReactionDetails}
          />
        )}

        {!previewOnly && contextEmojiPickerAnchor && (
          <>
            <span
              ref={contextEmojiPickerAnchorRef}
              aria-hidden="true"
              className="fixed h-0 w-0"
              style={{
                left: contextEmojiPickerAnchor.x,
                top: contextEmojiPickerAnchor.y,
                pointerEvents: "none",
              }}
            />
            <EmojiPicker
              open
              placement="bottom-end"
              markerRef={contextEmojiPickerAnchorRef}
              onSelect={handleEmojiPickerSelect}
              onClose={() => setContextEmojiPickerAnchor(null)}
            />
          </>
        )}

        {!previewOnly && showShareModal && (
          <MessageShareModal
            open={showShareModal}
            message={message}
            onClose={() => setShowShareModal(false)}
            onCreateShare={createMessageShare}
            onManageShares={
              onManageShares ??
              (() => {
                openSettings({ panel: "shares" });
                setShowShareModal(false);
              })
            }
          />
        )}

        {!previewOnly && showDeleteModal && (
          <DeleteMessageDialog
            open={showDeleteModal}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) setShowDeleteModal(false);
            }}
            onConfirm={() => {
              performDelete();
              setShowDeleteModal(false);
            }}
            message={message}
          />
        )}
      </div>
    );
  },
);

/**
 * The header time: `8:12 PM` in mono ink-3, the full date in a tooltip. The
 * tooltip mounts only when the time itself is hovered or focused, so a long
 * list doesn't carry a Radix root per row.
 */
function MessageHeaderTime({
  iso,
  full,
  children,
}: {
  iso: string;
  full: string;
  children: React.ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  const stamp = (
    <time
      dateTime={iso}
      aria-label={full}
      tabIndex={-1}
      className="shrink-0 cursor-default select-none whitespace-nowrap"
      onPointerEnter={() => setArmed(true)}
    >
      <Num className="text-ink-3">{children}</Num>
    </time>
  );
  if (!armed) return stamp;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{stamp}</TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {full}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default MessageItem;
