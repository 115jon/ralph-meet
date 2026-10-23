import { HIT, PRESS } from "@/components/ui/interaction";
import { getDisplayInitial } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { useUserResolution } from "@/hooks/useUserResolution";
import { getFileIcon } from "@/lib/file-icons";
import { isPlayableVideo } from "@/lib/media";
import { getDownloadUrl } from "@/lib/platform";
import { useClientDateFormatter } from "@/lib/client-date-format";
import type { Message } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

import React from "react";
import { AvatarImage } from "./AvatarImage";
import { ImageGrid } from "./ImageGrid";
import { MarkdownRenderer } from "./MarkdownRenderer";
import VideoAttachment from "./VideoAttachment";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface PinnedMessagesSidebarProps {
  messages: Message[];
  isLoading: boolean;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
  onUnpin: (messageId: string, skipConfirm: boolean) => void;
  canUnpin: boolean;
}

export const PinnedMessagesSidebar: React.FC<PinnedMessagesSidebarProps> = ({
  messages,
  isLoading,
  onClose,
  onJumpToMessage,
  onUnpin,
  canUnpin,
}) => {
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onClose]);

  return (
    <div className="w-full h-full sm:w-[420px] sm:max-h-[calc(100vh-120px)] sm:rounded-lg sm:border border-rm-border bg-rm-bg-surface shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right-4 sm:fade-in sm:zoom-in-95 duration-200 pointer-events-auto">
      <header
        className="flex min-h-16 flex-none items-center gap-3 border-b border-rm-border bg-transparent px-6 pb-2"
        style={{ paddingTop: "max(0px, var(--safe-area-top, 0px))" }}
      >
        <Icon name="pin" size="lg" className="text-rm-text-muted" />
        <h2 className="font-semibold text-ui-lg text-rm-text">
          Pinned Messages
        </h2>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close pinned messages"
          className={cn(
            "w-8 h-8 flex items-center justify-center rounded-full bg-rm-bg-elevated pointer-fine:hover:bg-rm-bg-hover text-rm-text-muted pointer-fine:hover:text-rm-text transition-ui outline-none",
            PRESS,
            HIT,
          )}
        >
          <Icon name="close" size="sm" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto bg-transparent p-4 pb-[max(16px,var(--safe-area-bottom,0px))] custom-scrollbar">
        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-rm-text-muted">
            <Icon
              name="loader"
              size="2xl"
              className="animate-spin text-primary/50"
            />
            <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em]">
              Loading Pins...
            </span>
          </div>
        ) : messages.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center gap-4 text-center px-4">
            <div className="w-16 h-16 rounded-3xl bg-rm-bg-elevated/40 flex items-center justify-center border border-rm-border shadow-xl rotate-12">
              <Icon
                name="pin"
                size="2xl"
                className="opacity-10 text-rm-text-muted"
              />
            </div>
            <div>
              <p className="text-rm-text-secondary font-bold mb-1">
                No pinned messages
              </p>
              <p className="text-ui-2xs text-rm-text-muted leading-relaxed">
                Pin important messages to see them here.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            {messages.map((msg) => (
              <PinnedMessageItem
                key={msg.id}
                msg={msg}
                onJumpToMessage={onJumpToMessage}
                onUnpin={onUnpin}
                canUnpin={canUnpin}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const PinnedMessageItem = ({
  msg,
  onJumpToMessage,
  onUnpin,
  canUnpin,
}: {
  msg: Message;
  onJumpToMessage: (id: string) => void;
  onUnpin: (id: string, skipConfirm: boolean) => void;
  canUnpin: boolean;
}) => {
  const authorInfo = useUserResolution(msg.author_id, msg.author);
  const formatDate = useClientDateFormatter();
  const attachments = msg.attachments ?? [];
  const imageAttachments: Message["attachments"] = [];
  const videoAttachments: Message["attachments"] = [];
  const otherAttachments: Message["attachments"] = [];

  for (const attachment of attachments) {
    if (attachment.content_type?.startsWith("image/")) {
      imageAttachments.push(attachment);
    } else if (isPlayableVideo(attachment.content_type)) {
      videoAttachments.push(attachment);
    } else {
      otherAttachments.push(attachment);
    }
  }

  return (
    <div className="group p-5 rounded-2xl border border-rm-border bg-rm-bg-elevated/40 pointer-fine:hover:bg-rm-bg-elevated/80 transition-ui relative overflow-hidden flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-4 min-w-0">
          <div className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center overflow-visible rounded-full bg-primary/10 text-ui-md font-semibold text-primary border border-rm-border transition-transform duration-200">
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
          </div>
          <div className="flex flex-col min-w-0 pt-0.5">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-ui-base text-rm-text truncate">
                {authorInfo.displayName}
              </span>
              <span className="text-ui-2xs text-rm-text-muted font-medium shrink-0">
                {formatDate(msg.created_at, {
                  year: "numeric",
                  month: "numeric",
                  day: "numeric",
                })}
              </span>
            </div>

            {msg.content && (
              <div className="text-ui-sm text-rm-text-secondary leading-[1.4] break-words">
                <MarkdownRenderer content={msg.content} />
                {msg.updated_at && (
                  <span
                    className="ml-1.5 text-ui-2xs text-rm-text-muted font-medium"
                    title={`Edited ${formatDate(msg.updated_at, {
                      year: "numeric",
                      month: "numeric",
                      day: "numeric",
                      hour: "numeric",
                      minute: "numeric",
                      second: "numeric",
                    })}`}
                  >
                    (edited)
                  </span>
                )}
              </div>
            )}

            {attachments.length > 0 && (
              <div className="mt-3 space-y-2.5">
                {/* Images first */}
                {imageAttachments.length > 0 && (
                  <div className="max-w-full">
                    <ImageGrid
                      attachments={imageAttachments}
                      username={authorInfo.username}
                      displayName={authorInfo.displayName}
                      avatarUrl={authorInfo.avatarUrl}
                      avatarDisplay={authorInfo.avatarDisplay}
                      createdAt={msg.created_at}
                    />
                  </div>
                )}

                {/* Videos */}
                {videoAttachments.map((att) => (
                  <VideoAttachment
                    key={att.id}
                    src={att.url || `/api/${att.file_key}`}
                    filename={att.filename}
                    maxWidth={280}
                    maxHeight={200}
                  />
                ))}

                {/* Other files */}
                {otherAttachments.map((att) => {
                  const { icon: typeIcon, colorClass } = getFileIcon(
                    att.filename,
                    att.content_type ?? undefined,
                  );
                  return (
                    <a
                      key={att.id}
                      href={getDownloadUrl(att.url || `/api/${att.file_key}`)}
                      download={att.filename}
                      className="flex items-center gap-3 rounded-xl border border-rm-border bg-rm-bg-primary/20 px-4 py-3 transition-ui pointer-fine:hover:border-rm-border pointer-fine:hover:bg-rm-bg-hover group/file max-w-[280px]"
                    >
                      <div
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rm-bg-surface border border-rm-border/30",
                          colorClass,
                        )}
                      >
                        <Icon name={typeIcon} size="md" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-ui-xs font-semibold text-primary pointer-fine:group-hover/file:underline">
                          {att.filename}
                        </p>
                        <p className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted">
                          {formatFileSize(att.size_bytes)}
                        </p>
                      </div>
                      <Icon
                        name="download"
                        size="sm"
                        className="shrink-0 text-rm-text-muted transition-colors pointer-fine:group-hover/file:text-rm-text-secondary"
                      />
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 transition-ui">
          <button
            onClick={() => onJumpToMessage(msg.id)}
            className="px-4 py-1.5 bg-primary pointer-fine:hover:brightness-110 text-primary-foreground font-bold text-ui-2xs rounded-lg transition-ui shadow-lg shadow-primary/10"
          >
            Jump
          </button>
          {canUnpin && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUnpin(msg.id, e.shiftKey);
              }}
              className="p-1.5 pointer-fine:hover:bg-destructive/10 text-rm-text-muted pointer-fine:hover:text-destructive transition-ui rounded-lg outline-none"
              title="Unpin (Shift-click to bypass confirmation)"
            >
              <Icon name="close" size="md" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
