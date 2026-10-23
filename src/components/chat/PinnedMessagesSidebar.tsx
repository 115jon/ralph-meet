import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { REVEAL } from "@/components/ui/interaction";
import { SidePanel, type SidePanelMode } from "@/components/ui/side-panel";
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
  open: boolean;
  messages: Message[];
  isLoading: boolean;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
  onUnpin: (messageId: string, skipConfirm: boolean) => void;
  canUnpin: boolean;
  /** Force one panel form (fixtures, tests). */
  forceMode?: SidePanelMode;
}

/**
 * Pinned messages as a side panel (design-system 12.10, 13.1): docked at
 * `lg`, a sheet below, a right drawer on phones. The panel owns Escape, the
 * back button, outside dismissal and focus return.
 */
export const PinnedMessagesSidebar: React.FC<PinnedMessagesSidebarProps> = ({
  open,
  messages,
  isLoading,
  onClose,
  onJumpToMessage,
  onUnpin,
  canUnpin,
  forceMode,
}) => {
  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Pinned messages"
      forceMode={forceMode}
    >
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 custom-scrollbar"
        aria-busy={isLoading || undefined}
      >
        {isLoading ? (
          <div className="flex flex-col gap-4">
            <span className="sr-only">Loading</span>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                aria-hidden="true"
                className="h-24 animate-pulse rounded-lg bg-rm-tint-1"
              />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <Icon
              name="pin"
              size="3xl"
              className="text-rm-text-muted max-md:size-8"
            />
            <p className="text-ui-md font-semibold text-rm-text">
              No pinned messages
            </p>
            <p className="max-w-[36ch] text-ui-sm text-pretty text-rm-text-secondary">
              Pin important messages to see them here.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {messages.map((msg) => (
              <li key={msg.id}>
                <PinnedMessageItem
                  msg={msg}
                  onJumpToMessage={onJumpToMessage}
                  onUnpin={onUnpin}
                  canUnpin={canUnpin}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </SidePanel>
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
    <article className="group relative flex flex-col gap-3 rounded-lg border border-rm-border bg-rm-bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center overflow-visible rounded-full bg-rm-tint-2 text-ui-sm font-semibold text-rm-text">
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
          <div className="flex min-w-0 flex-col">
            <div className="mb-0.5 flex items-baseline gap-2">
              <span className="truncate text-ui-base font-medium text-rm-text">
                {authorInfo.displayName}
              </span>
              <span className="shrink-0 text-ui-xs text-rm-text-muted">
                {formatDate(msg.created_at, {
                  year: "numeric",
                  month: "numeric",
                  day: "numeric",
                })}
              </span>
            </div>

            {msg.content && (
              <div className="text-ui-sm break-words text-rm-text-secondary">
                <MarkdownRenderer content={msg.content} />
                {msg.updated_at && (
                  <span
                    className="ml-1.5 text-ui-xs text-rm-text-muted"
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
              <div className="mt-2 flex flex-col gap-2">
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
                      className="group/file flex max-w-[280px] items-center gap-3 rounded-md border border-rm-border p-3 transition-colors pointer-fine:hover:bg-rm-tint-1"
                    >
                      <div
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-md bg-rm-tint-1",
                          colorClass,
                        )}
                      >
                        <Icon name={typeIcon} size="md" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-ui-sm font-medium text-rm-accent-ink pointer-fine:group-hover/file:underline">
                          {att.filename}
                        </p>
                        <p className="text-ui-xs text-rm-text-muted">
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

        <div className={cn("flex shrink-0 items-center gap-1", REVEAL)}>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => onJumpToMessage(msg.id)}
          >
            Jump
          </Button>
          {canUnpin && (
            <IconButton
              icon="close"
              size="xs"
              variant="destructive"
              aria-label="Unpin message"
              tooltip="Unpin (Shift-click to skip the confirmation)"
              onClick={(e) => {
                e.stopPropagation();
                onUnpin(msg.id, e.shiftKey);
              }}
            />
          )}
        </div>
      </div>
    </article>
  );
};
