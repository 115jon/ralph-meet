
import { getDisplayInitial } from "@/lib/display-name";
import { useContextMenu } from "@/hooks/useContextMenu";
import { useUserResolution } from "@/hooks/useUserResolution";
import { getAttachmentUrl } from "@/lib/attachment-url";
import type { Message } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatActions } from "@/stores/chat-store";

import { getFileIcon } from "@/lib/file-icons";
import { createAttachmentGifFavorite } from "@/lib/gif-favorite-item";
import { isAnimatedMedia, isPlayableVideo } from "@/lib/media";
import { getAuthAssetUrl, getDownloadUrl, getMediaUrl, isDesktop } from "@/lib/platform";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { ContextMenuItem } from "./ContextMenu";
import ContextMenu from "./ContextMenu";
import { Copy, Download, Edit2, MessageSquare, Pin, Share2, Smile, Trash2, User as UserIcon } from "./Icons";
import { ImageGrid } from "./ImageGrid";
import { GifFavoriteButton } from "./GifFavoriteButton";
import { LinkEmbed } from "./LinkEmbed";
import { MarkdownRenderer } from "./MarkdownRenderer";
import MessageShareModal from "./MessageShareModal";
import UserProfilePopover from "./UserProfilePopover";
import VideoAttachment from "./VideoAttachment";
import { ReplyPreviewContent, getReplyPreviewText } from "./ReplyPreviewContent";

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
  onManageShares?: () => void;
  onVisible?: () => void;
  onHeightChange?: () => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) {
    return `Today at ${formatTime(iso)}`;
  }
  if (d.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${formatTime(iso)}`;
  }
  return d.toLocaleDateString([], {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }) + ` ${formatTime(iso)}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getAttachmentSourceUrl(att: { url?: string; file_key: string }) {
  return att.url || getAttachmentUrl(att.file_key);
}

async function openExternalLink(url: string) {
  if (isDesktop()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}


const MessageItem = memo(({ id, message, showHeader, onReply, onPin, onUnpin, onJump, onBan, onThread, currentUserId, canPin: propCanPin, canDeleteMessages = false, hideReplyConnector = false, onMediaPlay, onManageShares, onVisible, onHeightChange }: Props) => {
  const { addReaction, removeReaction, editMessage, deleteMessage, setProfileUser, removeEmbeds, createMessageShare } = useChatActions();
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [editInput, setEditInput] = useState("");
  const [authorNameEl, setAuthorNameEl] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const visibilityReportedRef = useRef(false);
  const editTextAreaRef = useRef<HTMLTextAreaElement>(null);
  const { menu, openMenu, closeMenu } = useContextMenu();

  const authorInfo = useUserResolution(message.author_id, message.author);
  const replyInfo = useUserResolution(message.reply_to?.author_id, message.reply_to?.author);

  const handleTextareaRef = useCallback((el: HTMLTextAreaElement | null) => {
    editTextAreaRef.current = el;
    if (el && editing) {
      el.focus();
      const length = el.value.length;
      el.setSelectionRange(length, length);
    }
  }, [editing]);

  // Listen for external edit trigger (↑ arrow key in MessageInput)
  useEffect(() => {
    const handler = () => {
      setEditing(true);
      setEditInput(message.content);
    };
    window.addEventListener(`edit-message-${message.id}`, handler);
    return () => window.removeEventListener(`edit-message-${message.id}`, handler);
  }, [message.id, message.content]);

  const onHeightChangeRef = useRef(onHeightChange);
  useEffect(() => {
    onHeightChangeRef.current = onHeightChange;
  }, [onHeightChange]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !onHeightChange) return;

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
  }, [onHeightChange]);

  useEffect(() => {
    if (!onVisible || visibilityReportedRef.current) return;

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
      { threshold: 0.3 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [onVisible]);

  const handleContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const hoveredAnchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
    const hoveredEmbed = target?.closest?.("[data-embed-url]") as HTMLElement | null;
    const hoveredUrl = hoveredAnchor?.href || hoveredEmbed?.dataset.embedUrl || null;
    const items: ContextMenuItem[] = [
      {
        label: "Profile",
        icon: <UserIcon className="h-4 w-4" />,
        onClick: () => message.author && setProfileUser(message.author as any),
      },
      {
        label: "Reply",
        icon: <MessageSquare className="h-4 w-4" />,
        onClick: () => onReply?.(message),
      },
      {
        label: message.is_pinned ? "Unpin Message" : "Pin Message",
        icon: <Pin className="h-4 w-4" />,
        onClick: () => handlePinToggle(e),
      },
      {
        label: "Copy Text",
        icon: <Copy className="h-4 w-4" />,
        onClick: () => navigator.clipboard.writeText(message.content),
      },
      ...(hoveredUrl ? [{
        label: "Copy Link",
        icon: <Copy className="h-4 w-4" />,
        onClick: () => navigator.clipboard.writeText(hoveredUrl),
      }, {
        label: "Open Link",
        icon: <Share2 className="h-4 w-4" />,
        onClick: () => {
          void openExternalLink(hoveredUrl);
        },
      }] : []),
      ...(message.channel_id && !message.pending ? [{
        label: "Share Message",
        icon: <Share2 className="h-4 w-4" />,
        onClick: () => setShowShareModal(true),
      }] : []),
      {
        label: "Copy ID",
        icon: <Copy className="h-4 w-4" />,
        onClick: () => navigator.clipboard.writeText(message.id),
        divider: isOwnMessage,
      },
    ];

    if (isOwnMessage) {
      items.push({
        label: "Edit Message",
        icon: <Edit2 className="h-4 w-4" />,
        onClick: startEditing,
      });
      items.push({
        label: "Delete Message",
        icon: <Trash2 className="h-4 w-4" />,
        onClick: handleDelete,
        variant: "danger",
      });
    } else if (canDeleteMessages) {
      items.push({
        label: "Delete Message",
        icon: <Trash2 className="h-4 w-4" />,
        onClick: handleDelete,
        variant: "danger",
      });
    }

    if (!isOwnMessage && onBan) {
      items.push({
        label: "Ban User",
        icon: <Trash2 className="h-4 w-4" />,
        onClick: () => onBan(message.author_id, authorInfo.username),
        variant: "danger",
      });
    }

    openMenu(e, items);
  };

  const handleReaction = (emoji: string) => {
    if (!message.channel_id) return;
    const hasReacted = message.reactions
      ?.find((r) => r.emoji === emoji)
      ?.users?.includes(currentUserId ?? "");
    if (hasReacted) {
      removeReaction(message.channel_id, message.id, emoji);
    } else {
      addReaction(message.channel_id, message.id, emoji);
    }
  };

  const handlePinToggle = (e: React.MouseEvent) => {
    if (!message.channel_id) return;
    if (message.is_pinned) {
      onUnpin?.(message.id, e.shiftKey);
    } else {
      onPin?.(message);
    }
  };

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
    [cancelEditing, handleEditSubmit]
  );

  const handleDelete = useCallback(() => {
    if (!message.channel_id) return;
    if (window.confirm("Are you sure you want to delete this message?")) {
      deleteMessage(message.channel_id, message.id);
    }
  }, [message.channel_id, message.id, deleteMessage]);

  const isOwnMessage = message.author_id === currentUserId;
  const canPin = propCanPin;

  // Split attachments into image / video / file buckets
  // Only Chromium-playable video formats get the inline player; the rest are files.
  const imageAttachments = message.attachments?.filter((a) => a.content_type?.startsWith("image/")) ?? [];
  const videoAttachments = message.attachments?.filter((a) => isPlayableVideo(a.content_type)) ?? [];
  const fileAttachments = message.attachments?.filter((a) => !a.content_type?.startsWith("image/") && !isPlayableVideo(a.content_type)) ?? [];

  return (
    <div
      ref={rootRef}
      id={id}
      className={cn(
        "group relative flex flex-col transition-all duration-100 hover:bg-rm-bg-hover",
        showHeader && "mt-4",
        message.pending && "opacity-50"
      )}
      onContextMenu={handleContextMenu}
    >
      {/* Reply connector */}
      {message.reply_to && !hideReplyConnector && (
        <div
          className="ml-14 mb-1 flex items-center gap-2 opacity-60 transition-opacity hover:opacity-100 cursor-pointer group/reply outline-none"
          onClick={() => onJump?.(message.reply_to_id!)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onJump?.(message.reply_to_id!);
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={`Reply to ${replyInfo.displayName}: ${getReplyPreviewText(message.reply_to.content, message.reply_to.attachment_count ?? message.reply_to.attachments?.length ?? 0)}`}
        >
          <div className="mt-2 h-4 w-8 shrink-0 rounded-tl-lg border-l-2 border-t-2 border-rm-border group-hover/reply:border-rm-text-muted transition-colors" />
          <div className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rm-bg-elevated text-[9px] font-bold text-rm-text-muted relative">
            {replyInfo.avatarUrl ? (
              <img src={getAuthAssetUrl(replyInfo.avatarUrl)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} className="object-cover" />
            ) : (
              getDisplayInitial({ display_name: replyInfo.displayName, username: replyInfo.username })
            )}
          </div>
          <span className="max-w-[150px] truncate text-[12px] font-bold text-rm-text-muted">
            {replyInfo.displayName}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium italic text-rm-text-muted">
            <ReplyPreviewContent
              content={message.reply_to.content}
              attachmentsCount={message.reply_to.attachment_count ?? message.reply_to.attachments?.length ?? 0}
            />
          </span>
        </div>
      )}

      <div className={cn("relative flex gap-4 px-4", showHeader ? "pt-0.5 pb-1" : "py-0.5")}>
        {/* Avatar or time hover */}
        {showHeader ? (
          <div
            className="mt-0.5 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-primary/10 text-sm font-bold text-primary transition-all hover:opacity-80 relative"
            onClick={() => setShowProfile(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setShowProfile(true);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={`View ${authorInfo.displayName}'s profile`}
          >
            {authorInfo.avatarUrl ? (
              <img src={getAuthAssetUrl(authorInfo.avatarUrl)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} className="object-cover" />
            ) : (
              getDisplayInitial({ display_name: authorInfo.displayName, username: authorInfo.username })
            )}
          </div>
        ) : (
          <div className="flex w-10 shrink-0 items-start justify-center pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="select-none text-[10.5px] font-medium text-rm-text-muted">
              {formatTime(message.created_at)}
            </span>
          </div>
        )}

        {/* Message body */}
        <div className="min-w-0 flex-1">
          {showHeader && (
            <div className="mb-0.5 flex items-center gap-2">
              <span
                ref={setAuthorNameEl}
                className="cursor-pointer text-[15px] font-bold text-rm-text transition-colors hover:underline outline-none"
                onClick={() => setShowProfile(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setShowProfile(true);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                {authorInfo.displayName}
              </span>
              <span className="text-[11.5px] font-medium text-rm-text-muted ml-0.5 mt-0.5">
                {formatDate(message.created_at)}
              </span>
              {message.is_pinned && (
                <div className="flex items-center gap-1 rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                  <Pin className="h-2.5 w-2.5 fill-current" />
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
                className="w-full bg-rm-bg-elevated border border-primary/50 rounded-lg p-3 text-rm-text text-[15px] outline-none min-h-[60px] resize-none font-medium focus:border-primary transition-colors"
              />
              <div className="mt-1 text-[11px] text-rm-text-muted flex gap-2">
                <span>escape to <button type="button" onClick={cancelEditing} className="text-primary hover:underline">cancel</button></span>
                <span className="opacity-50">•</span>
                <span>enter to <button type="button" onClick={handleEditSubmit} className="text-primary hover:underline">save</button></span>
              </div>
            </div>
          ) : (
            <div className="whitespace-pre-wrap text-[15px] font-medium leading-[1.375rem] text-rm-text">
              <MarkdownRenderer content={message.content} />
              {message.updated_at && (
                <span className="ml-1 text-[10px] text-rm-text-muted" title={`Edited ${formatDate(message.updated_at)}`}>(edited)</span>
              )}
            </div>
          )}

          {/* Social media embeds */}
          {!editing && message.embeds?.map((embed, i) => (
            <div key={i} data-embed-url={embed.url}>
              <LinkEmbed
                embed={embed}
                messageId={message.id}
                onJumpToMessage={onJump}
                onRemoveEmbeds={isOwnMessage && message.channel_id ? () => removeEmbeds(message.channel_id!, message.id) : undefined}
                onMediaPlay={onMediaPlay}
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
                createdAt={message.created_at}
                messageId={message.id}
                onJumpToMessage={onJump}
              />
            </div>
          )}

          {/* Video attachments */}
          {videoAttachments.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              {videoAttachments.map((att) => (
                (() => {
                  const sourceUrl = getAttachmentSourceUrl(att);
                  const isGif = isAnimatedMedia(att.content_type, att.isGif, att.url || att.file_key);
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
                    : null;

                  return (
                    <div key={att.id} className="relative w-fit max-w-full">
                      <VideoAttachment
                        src={getMediaUrl(sourceUrl)}
                        filename={att.filename}
                        brandingKey={att.file_key || att.url}
                      />
                      {favorite && <GifFavoriteButton gif={favorite} />}
                    </div>
                  );
                })()
              ))}
            </div>
          )}

          {/* File attachments */}
          {fileAttachments.length > 0 && (
            <div className="mt-2 flex flex-col gap-2 max-w-sm">
              {fileAttachments.map((att) => {
                const { Icon: TypeIcon, colorClass } = getFileIcon(att.filename, att.content_type ?? undefined);
                return (
                  <a
                    key={att.id}
                    href={getDownloadUrl(getAttachmentSourceUrl(att))}
                    download={att.filename}
                    className="flex items-center gap-3 rounded-xl border border-rm-border bg-rm-bg-elevated px-4 py-3 transition-all hover:border-rm-text-muted/20 hover:bg-rm-bg-hover group/file"
                  >
                    <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rm-bg-surface border border-rm-border/30", colorClass)}>
                      <TypeIcon size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-primary/80 group-hover/file:underline group-hover/file:text-primary">{att.filename}</p>
                      <p className="text-[11px] text-rm-text-muted">{formatFileSize(att.size_bytes)}</p>
                    </div>
                    <Download className="h-4 w-4 shrink-0 text-rm-text-muted transition-colors group-hover/file:text-rm-text-secondary" />
                  </a>
                );
              })}
            </div>
          )}

          {/* Reactions */}
          {message.reactions && message.reactions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {message.reactions.map((reaction) => {
                const hasReacted = reaction.users?.includes(currentUserId ?? "");
                return (
                  <button
                    key={reaction.emoji}
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[12px] font-bold transition-all",
                      hasReacted
                        ? "border-primary/40 bg-primary/10 text-primary shadow-[0_0_10px_var(--rm-glow)]"
                        : "border-rm-border bg-rm-bg-elevated/50 text-rm-text-muted hover:border-rm-text-muted/20 hover:text-rm-text-secondary"
                    )}
                    onClick={() => handleReaction(reaction.emoji)}
                  >
                    <span>{reaction.emoji}</span>
                    <span className="text-[10px] opacity-60">{reaction.count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Thread badge */}
          {(message.reply_count ?? 0) > 0 && (
            <button
              onClick={() => onThread?.(message.id)}
              className="mt-2 flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1 text-[12px] font-semibold text-primary transition-all hover:bg-primary/10 hover:border-primary/30 outline-none"
            >
              <MessageSquare className="h-3 w-3" />
              {message.reply_count} {message.reply_count === 1 ? "Reply" : "Replies"}
            </button>
          )}
        </div>

        {/* Hover action toolbar */}
        {!message.pending && !editing && (
          <div className="absolute -top-3 right-4 flex origin-bottom scale-95 items-center overflow-hidden rounded-lg border border-rm-border bg-rm-bg-elevated opacity-0 shadow-2xl transition-all group-hover:scale-100 group-hover:opacity-100">
            <button
              onClick={() => onReply?.(message)}
              className="px-3 py-2 text-[10px] font-bold text-rm-text-muted transition-colors hover:bg-rm-bg-hover hover:text-primary"
            >
              REPLY
            </button>
            <div className="my-auto h-4 w-[1px] bg-rm-border" />
            <button
              onClick={() => onThread?.(message.id)}
              className="px-3 py-2 text-[10px] font-bold text-rm-text-muted transition-colors hover:bg-rm-bg-hover hover:text-primary"
            >
              THREAD
            </button>
            <div className="my-auto h-4 w-[1px] bg-rm-border" />
            <button
              onClick={() => setShowShareModal(true)}
              className="p-2 text-rm-text-muted transition-colors hover:bg-rm-bg-hover hover:text-primary"
              title="Share message"
            >
              <Share2 className="h-4 w-4" />
            </button>
            <div className="my-auto h-4 w-[1px] bg-rm-border" />
            <div className="relative">
              <button
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                className={cn(
                  "p-2 transition-colors hover:bg-primary/10",
                  showEmojiPicker ? "bg-primary/10 text-primary" : "text-rm-text-muted hover:text-primary"
                )}
              >
                <Smile className="h-4 w-4" />
              </button>
              {showEmojiPicker && (
                <div className="absolute bottom-full right-0 z-50 mb-2 flex origin-bottom-right animate-in fade-in zoom-in gap-1 rounded-xl border border-rm-border bg-rm-bg-elevated p-2 shadow-2xl duration-200">
                  {['🚀', '✨', '🔥', '❤️', '😂', '👍', '👀'].map(emoji => (
                    <button
                      key={emoji}
                      onClick={() => {
                        handleReaction(emoji);
                        setShowEmojiPicker(false);
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-colors hover:bg-rm-bg-hover"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {(isOwnMessage || canDeleteMessages) && (
              <>
                <div className="my-auto h-4 w-[1px] bg-rm-border" />
                {isOwnMessage && (
                  <button
                    onClick={startEditing}
                    className="px-3 py-2 text-[10px] font-bold text-rm-text-muted transition-colors hover:bg-rm-bg-hover hover:text-rm-text-secondary"
                  >
                    EDIT
                  </button>
                )}
                <button
                  onClick={handleDelete}
                  className="px-3 py-2 text-[10px] font-bold text-destructive/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  DEL
                </button>
              </>
            )}
            {canPin && (
              <>
                <div className="my-auto h-4 w-[1px] bg-rm-border" />
                <button
                  onClick={handlePinToggle}
                  className={cn(
                    "rounded p-1 text-rm-text-muted transition-colors hover:bg-rm-bg-hover hover:text-rm-text",
                    message.is_pinned && "text-primary opacity-100"
                  )}
                  title={message.is_pinned ? "Unpin (Shift-click to bypass)" : "Pin"}
                >
                  <Pin className="h-4 w-4 rotate-45" />
                </button>
              </>
            )}
          </div>
        )}

        {/* User profile popover */}
        {showProfile && authorNameEl && (
          <UserProfilePopover
            userId={message.author_id}
            username={authorInfo.username}
            displayName={authorInfo.displayName}
            avatarUrl={authorInfo.avatarUrl}
            anchorEl={authorNameEl}
            onClose={() => setShowProfile(false)}
          />
        )}
      </div>

      {menu.isOpen && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={closeMenu}
        />
      )}

      {showShareModal && (
        <MessageShareModal
          message={message}
          onClose={() => setShowShareModal(false)}
          onCreateShare={createMessageShare}
          onManageShares={onManageShares ?? (() => {
            window.dispatchEvent(new CustomEvent("open-shared-messages-settings"));
            setShowShareModal(false);
          })}
        />
      )}
    </div>
  );
});

export default MessageItem;
