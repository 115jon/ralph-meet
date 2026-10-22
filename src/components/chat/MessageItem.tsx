import { AvatarImage } from "@/components/chat/AvatarImage";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import { Dialog, DialogPortal, DialogSurface } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getDisplayInitial } from "@/lib/display-name";
import { useContextMenu } from "@/hooks/useContextMenu";
import { useCustomEmojiLookup } from "@/hooks/useCustomEmojiLookup";
import { useShiftPressed } from "@/hooks/useShiftPressed";
import { useUserResolution } from "@/hooks/useUserResolution";
import { isMessageListScrolling } from "./message-list-scroll";
import { getAttachmentUrl } from "@/lib/attachment-url";
import {
  useClientDateFormatter,
  useClientReferenceTime,
  type ClientDateFormatter,
} from "@/lib/client-date-format";
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
import type { Message } from "@/lib/types";
import { shouldBlurSensitiveAttachment } from "@/lib/media-safety";
import { cn } from "@/lib/utils";
import {
  MENU_ICON,
  MENU_ITEM,
  MENU_ITEM_DEFAULT,
  MENU_SEPARATOR,
} from "@/components/ui/menu";
import { useChatActions, useChatStore } from "@/stores/chat-store";
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

function formatMessageTime(
  iso: string,
  formatDate: ClientDateFormatter,
): string {
  return formatDate(iso, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

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
      return `Today at ${formatMessageTime(iso, formatClientDate)}`;
    }
    if (messageDay === yesterday) {
      return `Yesterday at ${formatMessageTime(iso, formatClientDate)}`;
    }
  }

  return `${messageDay} ${formatMessageTime(iso, formatClientDate)}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const QUICK_REACTION_BUTTON_LIMIT = 4;
const RECENT_REACTION_MENU_LIMIT = 5;

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

function ToolbarSeparator() {
  return <div className="my-auto h-4 w-px shrink-0 bg-rm-border" />;
}

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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onClick(item)}
          className="text-rm-text-muted pointer-fine:hover:text-rm-text"
          aria-label={`React with ${item.label}`}
        >
          <EmojiToken
            value={item.insertText}
            customEmojiMap={customEmojiMap}
            className="h-5 w-5"
            fallbackClassName="text-base"
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        <p>{item.label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function ReactionTooltipContent({
  emoji,
  count,
  users,
  customEmojiMap,
  onOpenDetails,
}: {
  emoji: string;
  count: number;
  users: string[];
  customEmojiMap: Record<string, { image_url?: string | null }>;
  onOpenDetails?: () => void;
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
    <div className="max-w-[320px] leading-normal">
      <div className="flex items-start gap-2">
        {onOpenDetails ? (
          <button
            type="button"
            onClick={onOpenDetails}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rm-bg-surface transition-[background-color,transform] hover:bg-rm-bg-hover active:scale-[0.96]"
            aria-label={`View all reactions for ${getReactionEmojiLabel(emoji)}`}
          >
            <EmojiToken
              value={emoji}
              customEmojiMap={customEmojiMap}
              size="large"
              className="h-8 w-8"
              fallbackClassName="text-2xl leading-none"
            />
          </button>
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rm-bg-surface">
            <EmojiToken
              value={emoji}
              customEmojiMap={customEmojiMap}
              size="large"
              className="h-8 w-8"
              fallbackClassName="text-2xl leading-none"
            />
          </div>
        )}
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">
            {getReactionEmojiLabel(emoji)} reacted by
          </p>
          <p className="text-rm-text-secondary">
            {formatReactionUserNames(userNames, count)}
          </p>
        </div>
      </div>
    </div>
  );
}

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
    const formatClientDate = useClientDateFormatter();
    const referenceTime = useClientReferenceTime();
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
    const [editInput, setEditInput] = useState("");
    const [toolbarQuickReactions, setToolbarQuickReactions] = useState<
      EmojiRecentItem[]
    >([]);
    const isShiftPressed = useShiftPressed();
    const [interactive, setInteractive] = useState(false);
    const [authorNameEl, setAuthorNameEl] = useState<HTMLElement | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const visibilityReportedRef = useRef(false);
    const editTextAreaRef = useRef<HTMLTextAreaElement>(null);
    const emojiBtnRef = useRef<HTMLButtonElement>(null);
    const reactionEmojiBtnRef = useRef<HTMLButtonElement>(null);
    const contextEmojiPickerAnchorRef = useRef<HTMLSpanElement>(null);
    const { menu, openMenu, closeMenu, shouldRender, isClosing } =
      useContextMenu();
    const { requestOpen: requestOpenExternalLink, confirmation } =
      useExternalLinkConfirmation();
    const [contextEmojiPickerAnchor, setContextEmojiPickerAnchor] = useState<{
      x: number;
      y: number;
    } | null>(null);

    useEffect(() => {
      // Load persisted reaction preferences only after the server snapshot exists.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToolbarQuickReactions(getQuickReactionItems(3));
    }, []);

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
      (event: React.MouseEvent<HTMLButtonElement>) => {
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
      const quickReactionButtons = quickReactions.slice(
        0,
        QUICK_REACTION_BUTTON_LIMIT,
      );
      const quickReactionEmojiMap = buildRecentEmojiTokenMap(quickReactions);

      setShowEmojiPicker(false);
      setShowReactionEmojiPicker(false);
      setContextEmojiPickerAnchor(null);

      const reactionSubmenu = (
        <div className="flex flex-col gap-0.5">
          {quickReactions.map((item) => (
            <button
              key={`${item.type}:${item.id}`}
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                handleQuickReaction(item);
              }}
              className={cn(MENU_ITEM, MENU_ITEM_DEFAULT, "justify-between")}
            >
              <span className="truncate">{item.label}</span>
              <EmojiToken
                value={item.insertText}
                customEmojiMap={quickReactionEmojiMap}
                className="h-5 w-5"
                fallbackClassName="text-base"
              />
            </button>
          ))}
          <div className={MENU_SEPARATOR} />
          <button
            type="button"
            role="menuitem"
            onClick={openReactionPickerFromMenu}
            className={cn(MENU_ITEM, MENU_ITEM_DEFAULT, "justify-between")}
          >
            <span>View More</span>
            <Icon name="react" size="sm" className={MENU_ICON} />
          </button>
        </div>
      );

      const items: ContextMenuItem[] = [
        {
          key: "add-reaction",
          label: "Add Reaction",
          onClick: () => undefined,
          rightIcon: <Icon name="chevronRight" size="xs" />,
          submenu: reactionSubmenu,
          closeOnClick: false,
          divider: true,
        },
        ...(isOwnMessage
          ? [
              {
                label: "Edit Message",
                rightIcon: <Icon name="edit" size="sm" />,
                onClick: startEditing,
              },
            ]
          : []),
        {
          label: "Reply",
          rightIcon: <Icon name="reply" size="sm" />,
          onClick: () => onReply?.(message),
        },
        ...(onThread
          ? [
              {
                label:
                  (message.reply_count ?? 0) > 0
                    ? "View Thread"
                    : "Create Thread",
                rightIcon: <Icon name="thread" size="sm" />,
                onClick: () => onThread(message.id),
              },
            ]
          : []),
        ...(canPin
          ? [
              {
                label: message.is_pinned ? "Unpin Message" : "Pin Message",
                rightIcon: <Icon name="pin" size="sm" />,
                onClick: () => handlePinToggle(isShiftPressed),
                divider: true,
              },
            ]
          : []),
        {
          label: "Copy Text",
          rightIcon: <Icon name="copy" size="sm" />,
          onClick: () => navigator.clipboard.writeText(message.content),
        },
        ...(hoveredUrl
          ? [
              {
                label: "Copy Link",
                rightIcon: <Icon name="link" size="sm" />,
                onClick: () => navigator.clipboard.writeText(hoveredUrl),
              },
              {
                label: "Open Link",
                rightIcon: <Icon name="externalLink" size="sm" />,
                onClick: () => {
                  requestOpenExternalLink(hoveredUrl);
                },
              },
            ]
          : []),
        ...(message.channel_id && !message.pending
          ? [
              {
                label: "Share Message",
                rightIcon: <Icon name="share" size="sm" />,
                onClick: () => setShowShareModal(true),
              },
            ]
          : []),
        {
          label: "Profile",
          rightIcon: <Icon name="account" size="sm" />,
          onClick: () =>
            message.author && setProfileUser(message.author as any),
        },
        {
          label: "Copy ID",
          rightIcon: (
            <span className="rounded-md bg-rm-bg-surface px-1 py-0.5 text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted">
              ID
            </span>
          ),
          onClick: () => navigator.clipboard.writeText(message.id),
          divider: isOwnMessage || canDeleteMessages || Boolean(onBan),
        },
      ];

      if (isOwnMessage || canDeleteMessages) {
        items.push({
          label: "Delete Message",
          rightIcon: <Icon name="trash" size="sm" />,
          onClick: () => handleDelete(isShiftPressed),
          variant: "danger",
        });
      }

      if (!isOwnMessage && onBan) {
        items.push({
          label: "Ban User",
          rightIcon: <Icon name="trash" size="sm" />,
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
            label: "Save Image",
            rightIcon: <Icon name="download" size="sm" />,
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
            label: "Copy Media Link",
            rightIcon: <Icon name="copy" size="sm" />,
            onClick: () => {
              void copyMediaLink(publicMediaUrl);
            },
          },
          {
            label: "Open Media Link",
            rightIcon: <Icon name="externalLink" size="sm" />,
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
                  className="flex h-11 w-11 items-center justify-center rounded-lg bg-rm-tint-1 text-rm-text transition-[background-color] duration-150 pointer-fine:hover:bg-rm-tint-3 active:bg-rm-tint-3"
                  title={item.label}
                  aria-label={`React with ${item.label}`}
                >
                  <EmojiToken
                    value={item.insertText}
                    customEmojiMap={quickReactionEmojiMap}
                    className="h-5 w-5"
                    fallbackClassName="text-base"
                  />
                </button>
              ))}
            </div>
          ) : undefined,
      });
    };

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
      setEditInput(message.content);
    }, [message.content]);

    const cancelEditing = useCallback(() => {
      setEditing(false);
      setEditInput("");
    }, []);

    const handleEditSubmit = useCallback(() => {
      if (editInput.trim() && editInput.trim() !== message.content) {
        editMessage(message.id, editInput.trim());
      }
      setEditing(false);
      setEditInput("");
    }, [editInput, message.id, message.content, editMessage]);

    const handleEditKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Escape") {
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
      void navigator.clipboard.writeText(message.id);
    }, [message.id]);

    const copyMessageLink = useCallback(() => {
      if (!message.channel_id) return;
      void navigator.clipboard.writeText(
        buildMessageLink(activeServerId, message.channel_id, message.id),
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

    const performDelete = useCallback(() => {
      if (!message.channel_id) return;
      deleteMessage(message.channel_id, message.id);
    }, [message.channel_id, message.id, deleteMessage]);

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

    const isOwnMessage = message.author_id === currentUserId;
    const canPin = propCanPin;

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

    return (
      <div
        ref={rootRef}
        id={id}
        className={cn(
          "group relative flex flex-col transition-colors duration-100",
          !previewOnly && "hover:bg-rm-bg-hover",
          showHeader && !previewOnly && "mt-4",
          message.pending && "opacity-50",
        )}
        onContextMenu={previewOnly ? undefined : handleContextMenu}
        onMouseEnter={previewOnly ? undefined : () => setInteractive(true)}
        onFocusCapture={previewOnly ? undefined : () => setInteractive(true)}
      >
        {/* Reply connector */}
        {message.reply_to && !hideReplyConnector && (
          <button
            type="button"
            className="ml-14 mb-1 flex border-0 bg-transparent p-0 text-left items-center gap-2 opacity-60 transition-opacity hover:opacity-100 cursor-pointer group/reply outline-none"
            onClick={() => onJump?.(message.reply_to_id!)}
            aria-label={`Reply to ${replyInfo.displayName}: ${getReplyPreviewText(message.reply_to.content, message.reply_to.attachment_count ?? message.reply_to.attachments?.length ?? 0)}`}
          >
            <div className="mt-2 h-4 w-8 shrink-0 rounded-tl-lg border-l-2 border-t-2 border-rm-border group-hover/reply:border-rm-text-muted transition-colors" />
            <div className="flex h-4 w-4 shrink-0 items-center justify-center overflow-visible rounded-full bg-rm-bg-elevated text-ui-2xs font-bold text-rm-text-muted relative">
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
            </div>
            <ProfileDisplayName
              text={replyInfo.displayName}
              displayNameStyle={replyInfo.displayNameStyle}
              className="block max-w-[150px] truncate text-ui-xs font-semibold text-rm-text-muted"
            />
            <span className="min-w-0 flex-1 truncate text-ui-xs font-medium italic text-rm-text-muted">
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
        )}

        <div
          className={cn(
            "relative flex gap-4 px-4",
            showHeader ? "pt-0.5 pb-1" : "py-0.5",
          )}
        >
          {/* Avatar or time hover */}
          {showHeader ? (
            <button
              type="button"
              className="mt-0.5 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center overflow-visible rounded-full border-0 bg-primary/10 p-0 text-sm font-semibold text-primary transition-opacity hover:opacity-80 relative"
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
            <div className="flex w-10 shrink-0 items-start justify-center pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="select-none text-ui-2xs font-medium text-rm-text-muted">
                {formatMessageTime(message.created_at, formatClientDate)}
              </span>
            </div>
          )}

          {/* Message body */}
          <div className="min-w-0 flex-1">
            {showHeader && (
              <div className="mb-0.5 flex items-center gap-2">
                <button
                  type="button"
                  ref={setAuthorNameEl}
                  className="cursor-pointer border-0 bg-transparent p-0 text-ui-base font-semibold text-rm-text transition-colors hover:underline outline-none"
                  onClick={() => setShowProfile(true)}
                >
                  <ProfileDisplayName
                    text={authorInfo.displayName}
                    displayNameStyle={authorInfo.displayNameStyle}
                    className="block max-w-full text-ui-base font-semibold text-rm-text"
                  />
                </button>
                <span className="text-ui-xs text-rm-text-muted ml-0.5 mt-0.5">
                  {formatMessageDate(
                    message.created_at,
                    formatClientDate,
                    referenceTime,
                  )}
                </span>
                {message.is_pinned && (
                  <div className="flex items-center gap-1 rounded-sm border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-ui-2xs font-semibold tracking-[0.04em] text-primary">
                    <Icon name="pin" state="active" size="xs" />
                    PINNED
                  </div>
                )}
              </div>
            )}

            {/* Editing mode */}
            {editing ? (
              <div className="mt-1">
                <textarea
                  ref={handleTextareaRef}
                  value={editInput}
                  onChange={(e) => setEditInput(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  aria-label="Edit message"
                  className="w-full bg-rm-bg-elevated border border-primary/50 rounded-lg p-3 text-rm-text text-ui-base outline-none min-h-[60px] resize-none font-medium focus:border-primary transition-colors"
                />
                <div className="mt-1 text-ui-2xs text-rm-text-muted flex gap-2">
                  <span>
                    escape to{" "}
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      onClick={cancelEditing}
                      className="text-ui-2xs"
                    >
                      cancel
                    </Button>
                  </span>
                  <span className="opacity-50">•</span>
                  <span>
                    enter to{" "}
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      onClick={handleEditSubmit}
                      className="text-ui-2xs"
                    >
                      save
                    </Button>
                  </span>
                </div>
              </div>
            ) : (
              <div className="whitespace-pre-wrap text-ui-base text-rm-text">
                <MarkdownRenderer content={message.content} />
                {message.updated_at && (
                  <span
                    className="ml-1 text-ui-2xs text-rm-text-muted"
                    title={`Edited ${formatMessageDate(
                      message.updated_at,
                      formatClientDate,
                      referenceTime,
                    )}`}
                  >
                    (edited)
                  </span>
                )}
              </div>
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

            {/* File attachments */}
            {fileAttachments.length > 0 && (
              <div className="mt-2 flex flex-col gap-2 max-w-sm">
                {fileAttachments.map((att) => {
                  const { icon: typeIcon, colorClass } = getFileIcon(
                    att.filename,
                    att.content_type ?? undefined,
                  );
                  return (
                    <a
                      key={att.id}
                      href={getDownloadUrl(getAttachmentSourceUrl(att))}
                      download={att.filename}
                      className="flex items-center gap-3 rounded-lg border border-rm-border bg-rm-bg-elevated px-3 py-2.5 transition-ui hover:border-rm-text-muted/20 hover:bg-rm-bg-hover group/file"
                    >
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-rm-bg-surface border border-rm-border",
                          colorClass,
                        )}
                      >
                        <Icon name={typeIcon} size="lg" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-ui-sm font-medium text-primary group-hover/file:underline">
                          {att.filename}
                        </p>
                        <p className="text-ui-2xs text-rm-text-muted">
                          {formatFileSize(att.size_bytes)}
                        </p>
                      </div>
                      <Icon
                        name="download"
                        size="sm"
                        className="shrink-0 text-rm-text-muted transition-colors group-hover/file:text-rm-text-secondary"
                      />
                    </a>
                  );
                })}
              </div>
            )}

            {/* Reactions */}
            {message.reactions && message.reactions.length > 0 && (
              <TooltipProvider delayDuration={180}>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {message.reactions.map((reaction) => {
                    const reactionUsers = reaction.users ?? [];
                    const hasReacted = reactionUsers.includes(
                      currentUserId ?? "",
                    );
                    return (
                      <Tooltip
                        key={reaction.emoji}
                        disableHoverableContent={false}
                      >
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-pressed={hasReacted}
                            aria-label={`${hasReacted ? "Remove" : "Add"} ${getReactionEmojiLabel(reaction.emoji)} reaction`}
                            className={cn(
                              "flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-ui-xs font-semibold transition-ui enabled:active:scale-[0.96]",
                              previewOnly && "cursor-default",
                              hasReacted
                                ? "border-primary/40 bg-primary/10 text-primary shadow-[0_4px_12px_-4px_var(--rm-glow)]"
                                : "border-rm-border bg-rm-bg-elevated/50 text-rm-text-muted hover:border-rm-text-muted/20 hover:bg-rm-bg-hover hover:text-rm-text-secondary",
                            )}
                            onClick={
                              previewOnly
                                ? undefined
                                : () => toggleReaction(reaction.emoji)
                            }
                          >
                            <EmojiToken
                              value={reaction.emoji}
                              customEmojiMap={reactionEmojiMap}
                              size="reaction"
                              className="h-5 w-5"
                              fallbackClassName="max-w-[84px] truncate text-xs"
                            />
                            <span className="tabular-nums text-ui-xs opacity-80">
                              {reaction.count}
                            </span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          sideOffset={8}
                          className={cn(
                            "pointer-events-auto hidden max-w-xs text-xs sm:block",
                          )}
                        >
                          <ReactionTooltipContent
                            emoji={reaction.emoji}
                            count={reaction.count}
                            users={reactionUsers}
                            customEmojiMap={reactionEmojiMap}
                            onOpenDetails={
                              previewOnly
                                ? undefined
                                : () => openReactionDetails(reaction.emoji)
                            }
                          />
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}

                  {!previewOnly && (
                    <div className="relative">
                      <IconButton
                        ref={reactionEmojiBtnRef}
                        icon="react"
                        size="sm"
                        tooltip="Add Reaction"
                        aria-label="Add another reaction"
                        aria-haspopup="dialog"
                        aria-expanded={showReactionEmojiPicker}
                        className={cn(
                          "h-7 w-7 border border-rm-border bg-rm-bg-elevated/60 text-rm-text-muted hover:border-primary/30 hover:bg-primary/10 hover:text-primary",
                          showReactionEmojiPicker &&
                            "border-primary/40 bg-primary/10 text-primary",
                        )}
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
                  )}
                </div>
              </TooltipProvider>
            )}

            {/* Thread badge */}
            {(message.reply_count ?? 0) > 0 && (
              <Button
                variant="secondary"
                size="xs"
                onClick={previewOnly ? undefined : () => onThread?.(message.id)}
                disabled={previewOnly}
                className="mt-2 gap-1.5 bg-rm-accent-tint text-rm-accent-ink"
              >
                <Icon name="thread" size="xs" />
                {message.reply_count}{" "}
                {message.reply_count === 1 ? "Reply" : "Replies"}
              </Button>
            )}
          </div>

          {/* Hover action toolbar */}
          {!previewOnly && interactive && !message.pending && !editing && (
            <TooltipProvider delayDuration={120}>
              <div
                className={cn(
                  "pointer-events-none absolute -top-4 right-4 z-20 flex max-w-[calc(100vw-96px)] origin-bottom-right scale-[0.97] items-center gap-0.5 overflow-x-auto rounded-md border border-rm-border bg-rm-bg-surface p-0.5 opacity-0 shadow-[var(--rm-shadow-1)] transition-[opacity,transform] dark:bg-rm-bg-elevated duration-100 group-hover:pointer-events-auto group-hover:scale-100 group-hover:opacity-100 focus-within:pointer-events-auto focus-within:scale-100 focus-within:opacity-100",
                  showEmojiPicker &&
                    "pointer-events-auto scale-100 opacity-100",
                )}
              >
                {isShiftPressed ? (
                  <>
                    <IconButton
                      icon="copy"
                      size="sm"
                      tooltip="Copy Message ID"
                      onClick={copyMessageId}
                    />
                    <IconButton
                      icon="link"
                      size="sm"
                      tooltip="Copy Message Link"
                      onClick={copyMessageLink}
                    />
                    <IconButton
                      icon="markUnread"
                      size="sm"
                      tooltip="Mark Unread"
                      onClick={handleMarkUnread}
                    />
                    {canPin && (
                      <IconButton
                        icon="pin"
                        size="sm"
                        tooltip={
                          message.is_pinned ? "Unpin Message" : "Pin Message"
                        }
                        iconState={message.is_pinned ? "active" : "idle"}
                        className={
                          message.is_pinned ? "text-rm-accent-ink" : undefined
                        }
                        onClick={(event) =>
                          handlePinToggle(event.shiftKey || isShiftPressed)
                        }
                      />
                    )}
                    {onThread && (
                      <IconButton
                        icon="thread"
                        size="sm"
                        tooltip={
                          (message.reply_count ?? 0) > 0
                            ? "View Thread"
                            : "Create Thread"
                        }
                        onClick={() => onThread(message.id)}
                      />
                    )}
                    <IconButton
                      icon="reply"
                      size="sm"
                      tooltip="Reply"
                      onClick={() => onReply?.(message)}
                    />
                    <div className="relative">
                      <IconButton
                        ref={emojiBtnRef}
                        icon="react"
                        size="sm"
                        tooltip="Add Reaction"
                        aria-haspopup="dialog"
                        aria-expanded={showEmojiPicker}
                        className={
                          showEmojiPicker
                            ? "bg-rm-tint-2 text-rm-text"
                            : undefined
                        }
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
                    {isOwnMessage && (
                      <IconButton
                        icon="edit"
                        size="sm"
                        tooltip="Edit Message"
                        onClick={startEditing}
                      />
                    )}
                    <IconButton
                      icon="forward"
                      size="sm"
                      tooltip="Forward"
                      aria-disabled="true"
                      className="opacity-50"
                      onClick={() => undefined}
                    />
                    {(isOwnMessage || canDeleteMessages) && (
                      <IconButton
                        icon="trash"
                        size="sm"
                        variant="destructive"
                        tooltip="Delete Message"
                        onClick={() => handleDelete(true)}
                      />
                    )}
                  </>
                ) : (
                  <>
                    {toolbarQuickReactions.map((item) => (
                      <ToolbarEmojiButton
                        key={`${item.type}:${item.id}`}
                        item={item}
                        customEmojiMap={toolbarQuickReactionEmojiMap}
                        onClick={handleQuickReaction}
                      />
                    ))}
                    <ToolbarSeparator />
                    <div className="relative">
                      <IconButton
                        ref={emojiBtnRef}
                        icon="react"
                        size="sm"
                        tooltip="Add Reaction"
                        aria-haspopup="dialog"
                        aria-expanded={showEmojiPicker}
                        className={
                          showEmojiPicker
                            ? "bg-rm-tint-2 text-rm-text"
                            : undefined
                        }
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
                    <IconButton
                      icon={isOwnMessage ? "edit" : "reply"}
                      size="sm"
                      tooltip={isOwnMessage ? "Edit Message" : "Reply"}
                      onClick={
                        isOwnMessage ? startEditing : () => onReply?.(message)
                      }
                    />
                    <IconButton
                      icon="forward"
                      size="sm"
                      tooltip="Forward"
                      aria-disabled="true"
                      className="opacity-50"
                      onClick={() => undefined}
                    />
                    <IconButton
                      icon="more"
                      size="sm"
                      tooltip="More"
                      onClick={handleContextMenu}
                    />
                  </>
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
                window.dispatchEvent(
                  new CustomEvent("open-shared-messages-settings"),
                );
                setShowShareModal(false);
              })
            }
          />
        )}

        {!previewOnly && showDeleteModal && (
          <DeleteMessageModal
            open={showDeleteModal}
            message={message}
            currentUserId={currentUserId}
            onClose={() => setShowDeleteModal(false)}
            onConfirm={() => {
              performDelete();
              setShowDeleteModal(false);
            }}
          />
        )}
      </div>
    );
  },
);

function DeleteMessageModal({
  open,
  message,
  currentUserId,
  onClose,
  onConfirm,
}: {
  open: boolean;
  message: Message;
  currentUserId?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const previewRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      node.setAttribute("inert", "");
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogPortal>
        <div
          data-state={open ? "open" : "closed"}
          className={cn(
            "fixed inset-0 z-50 flex items-end justify-center bg-rm-scrim p-0 transition-opacity duration-200 md:items-center md:p-6",
            "animate-in fade-in data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0 data-[state=closed]:animate-out data-[state=closed]:fade-out",
          )}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              onClose();
            }
          }}
          role="presentation"
        >
          <DialogSurface
            showCloseButton={false}
            className={cn(
              "relative m-0 flex max-h-[calc(100dvh-16px)] w-full max-w-[480px] flex-col overflow-hidden rounded-t-xl border border-rm-border bg-rm-bg-primary p-0 shadow-2xl outline-none md:max-h-[min(760px,calc(100dvh-48px))] md:rounded-xl",
              "animate-in fade-in zoom-in-95 duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95",
            )}
            aria-labelledby="delete-message-title"
            aria-describedby="delete-message-description"
          >
            <div className="flex shrink-0 items-start justify-between px-6 pb-3 pt-6">
              <div>
                <h2
                  id="delete-message-title"
                  className="text-lg font-bold text-rm-text"
                >
                  Delete Message
                </h2>
                <p
                  id="delete-message-description"
                  className="mt-1 text-sm text-rm-text-muted"
                >
                  Are you sure you want to delete this message?
                </p>
              </div>
              <IconButton
                icon="close"
                size="sm"
                shape="circle"
                tooltip="Close"
                onClick={onClose}
                className="-mr-1 -mt-1"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3 custom-scrollbar">
              <div className="overflow-hidden rounded-md border border-rm-border bg-rm-bg-secondary py-3">
                <div
                  ref={previewRef}
                  aria-hidden="true"
                  className="pointer-events-none select-none"
                >
                  <MessageItem
                    message={message}
                    showHeader
                    currentUserId={currentUserId}
                    hideReplyConnector={false}
                    previewOnly
                  />
                </div>
              </div>
            </div>

            <div className="shrink-0 border-t border-rm-border/60 px-6 pb-2 pt-4 text-sm leading-tight">
              <p className="text-ui-xs font-bold uppercase text-emerald-400">
                Protip:
              </p>
              <p className="mt-1 text-rm-text-secondary">
                You can hold down Shift when clicking delete message to bypass
                this confirmation entirely.
              </p>
            </div>

            <div className="grid shrink-0 grid-cols-2 gap-2 px-6 pb-6 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-rm-border bg-rm-bg-elevated px-4 py-2.5 text-sm font-bold text-rm-text-secondary transition hover:bg-rm-bg-hover hover:text-rm-text"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="rounded-lg bg-destructive px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
              >
                Delete
              </button>
            </div>
          </DialogSurface>
        </div>
      </DialogPortal>
    </Dialog>
  );
}

export default MessageItem;
