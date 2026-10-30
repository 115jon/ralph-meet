import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/IconButton";
import { REVEAL } from "@/components/ui/interaction";
import { Num } from "@/components/ui/num";
import { SidePanel, type SidePanelMode } from "@/components/ui/side-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthAssetUrl, getDownloadUrl } from "@/lib/platform";
import { useUserResolution } from "@/hooks/useUserResolution";
import { getFileIcon } from "@/lib/file-icons";
import { isPlayableVideo } from "@/lib/media";
import type { Message } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

import React from "react";
import { ImageGrid } from "./ImageGrid";
import InlineEmojiText from "./InlineEmojiText";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { PreviewAvatar } from "./MessagePreviewCard";
import { useMessageTimeFormat, type MessageTimeFormat } from "./message-time";
import VideoAttachment from "./VideoAttachment";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * What a pin's Jump and Unpin keys are named after: its author plus a short
 * snippet, so a list of identical "Jump" buttons is told apart by screen
 * readers and voice control.
 */
function pinnedRowLabel(
  verb: string,
  author: string,
  msg: Pick<Message, "content" | "attachments">,
): string {
  const text = (msg.content ?? "").replace(/\s+/g, " ").trim();
  const snippet =
    text.length > 60
      ? `${text.slice(0, 60).trimEnd()}...`
      : text || ((msg.attachments?.length ?? 0) > 0 ? "attachment" : "");
  return snippet
    ? `${verb} from ${author}: ${snippet}`
    : `${verb} from ${author}`;
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

/** Placeholder rows in the row anatomy: avatar 32, a name line, two body lines. */
function PinsLoading() {
  return (
    <div role="status" className="flex flex-col">
      <span className="sr-only">Loading</span>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          className="flex gap-3 border-b border-line px-4 py-3"
        >
          <Skeleton className="size-8 shrink-0 rounded-avatar" />
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className={i === 1 ? "h-3 w-1/3" : "h-3 w-2/3"} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Pinned messages as a side panel (design-system 12.10, 13.1): docked at
 * `lg`, a sheet below, a right drawer on phones. The panel owns Escape, the
 * back button, outside dismissal and focus return. Pins are rows on the
 * panel ply with `--line` seams, not cards; Jump and Unpin overlay the row
 * on hover or focus instead of reserving space.
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
  const timeFormat = useMessageTimeFormat();
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
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        aria-busy={isLoading || undefined}
      >
        {isLoading ? (
          <PinsLoading />
        ) : messages.length === 0 ? (
          <EmptyState
            size="sm"
            className="py-12"
            title="No pinned messages"
            description="Pin a message from its menu and it shows up here for everyone in the channel."
          />
        ) : (
          <ul className="flex flex-col">
            {messages.map((msg) => (
              <li key={msg.id} className="border-b border-line">
                <PinnedMessageItem
                  msg={msg}
                  timeFormat={timeFormat}
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
  timeFormat,
  onJumpToMessage,
  onUnpin,
  canUnpin,
}: {
  msg: Message;
  timeFormat: MessageTimeFormat;
  onJumpToMessage: (id: string) => void;
  onUnpin: (id: string, skipConfirm: boolean) => void;
  canUnpin: boolean;
}) => {
  const authorInfo = useUserResolution(msg.author_id, msg.author);
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

  const shortDate = timeFormat.shortDate(msg.created_at);
  const time = timeFormat.time(msg.created_at);
  const isToday = shortDate === time;

  return (
    <article className="group relative flex gap-3 px-4 py-3 transition-colors duration-(--dur-1) ease-out pointer-fine:hover:bg-tint-1">
      <PreviewAvatar
        name={authorInfo.displayName}
        src={
          authorInfo.avatarUrl ? getAuthAssetUrl(authorInfo.avatarUrl) : null
        }
        display={authorInfo.avatarDisplay}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate text-ui-row font-semibold text-ink-1">
            <InlineEmojiText text={authorInfo.displayName} />
          </span>
          <time
            dateTime={msg.created_at}
            title={timeFormat.full(msg.created_at)}
            className="shrink-0 text-ui-xs text-ink-3"
          >
            {isToday ? <Num>{time}</Num> : shortDate}
          </time>
        </div>

        {msg.content && (
          <div className="text-ui-sm/5 wrap-break-word text-ink-1">
            <MarkdownRenderer content={msg.content} />
            {msg.updated_at && (
              <span
                className="text-ui-xs whitespace-nowrap text-ink-3"
                title={`Edited ${timeFormat.full(msg.updated_at)}`}
              >
                {" "}(edited)
              </span>
            )}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
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

            {videoAttachments.map((att) => (
              <VideoAttachment
                key={att.id}
                src={att.url || `/api/${att.file_key}`}
                filename={att.filename}
                maxWidth={280}
                maxHeight={200}
              />
            ))}

            {otherAttachments.map((att) => {
              const { icon: typeIcon } = getFileIcon(
                att.filename,
                att.content_type ?? undefined,
              );
              return (
                <a
                  key={att.id}
                  href={getDownloadUrl(att.url || `/api/${att.file_key}`)}
                  download={att.filename}
                  className="group/file flex max-w-[280px] items-center gap-3 rounded-lg border border-line bg-ply-2 p-2 transition-colors duration-(--dur-1) pointer-fine:hover:bg-tint-1"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-tint-2 text-ink-2">
                    <Icon name={typeIcon} size="md" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ui-sm font-medium text-ink-1 pointer-fine:group-hover/file:underline">
                      {att.filename}
                    </span>
                    <Num size="sm" className="text-ink-3">
                      {formatFileSize(att.size_bytes)}
                    </Num>
                  </span>
                  <Icon
                    name="download"
                    size="sm"
                    className="shrink-0 text-ink-3 pointer-fine:group-hover/file:text-ink-1"
                  />
                </a>
              );
            })}
          </div>
        )}
      </div>

      <div
        className={cn(
          "absolute top-2 right-3 flex items-center gap-0.5 rounded-md border border-line bg-ply-3 p-0.5 shadow-float",
          // Touch has no hover to reveal them, so they never float over the
          // text: they take their own column at the row's end.
          "pointer-coarse:static pointer-coarse:-my-1 pointer-coarse:shrink-0 pointer-coarse:self-start pointer-coarse:border-0 pointer-coarse:bg-transparent pointer-coarse:p-0 pointer-coarse:shadow-none",
          REVEAL,
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          aria-label={pinnedRowLabel(
            "Jump to message",
            authorInfo.displayName,
            msg,
          )}
          onClick={() => onJumpToMessage(msg.id)}
        >
          Jump
        </Button>
        {canUnpin && (
          <IconButton
            icon="close"
            size={28}
            variant="destructive"
            aria-label={pinnedRowLabel(
              "Unpin message",
              authorInfo.displayName,
              msg,
            )}
            tooltip="Unpin (Shift-click skips the confirm)"
            onClick={(e) => {
              e.stopPropagation();
              onUnpin(msg.id, e.shiftKey);
            }}
          />
        )}
      </div>
    </article>
  );
};
