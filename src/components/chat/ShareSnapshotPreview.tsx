import React from "react";
import type { Attachment, EmbedInfo } from "@/lib/types";
import { shouldBlurSensitiveAttachment } from "@/lib/media-safety";
import { isPlayableVideo } from "@/lib/media";
import { cn } from "@/lib/utils";
import { extractCustomEmojiIds } from "@/lib/emoji";
import { useCustomEmojiLookup } from "@/hooks/useCustomEmojiLookup";
import { useMediaSafetySettingsStore } from "@/stores/useMediaSafetySettingsStore";
import { ImageIcon, MessageSquare, Paperclip } from "lucide-react";
import { GifProviderBranding } from "./GifProviderBranding";
import { LinkEmbed } from "./LinkEmbed";
import { MarkdownRenderer } from "./MarkdownRenderer";
import SensitiveMediaFrame from "./SensitiveMediaFrame";
import VideoAttachment from "./VideoAttachment";
import EmojiToken from "./EmojiToken";

interface SharePreviewAuthor {
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
}

interface ShareSnapshotPreviewProps {
  content: string;
  author: SharePreviewAuthor;
  createdAt?: string;
  attachments?: Attachment[];
  omittedAttachmentCount?: number;
  embeds?: EmbedInfo[];
  reactions?: Array<{ emoji: string; count: number }>;
  replyCount?: number;
  source?: { server_name: string | null; channel_name: string | null };
  originalEdited?: boolean;
  avatarUrl?: string | null;
  mediaUrlForAttachment: (attachment: Attachment) => string;
  className?: string;
  compact?: boolean;
  previewMedia?: boolean;
}

const EMPTY_ATTACHMENTS: Attachment[] = [];
const EMPTY_EMBEDS: EmbedInfo[] = [];
const EMPTY_REACTIONS: Array<{ emoji: string; count: number }> = [];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ShareSnapshotPreview({
  content,
  author,
  createdAt,
  attachments = EMPTY_ATTACHMENTS,
  omittedAttachmentCount = 0,
  embeds = EMPTY_EMBEDS,
  reactions = EMPTY_REACTIONS,
  replyCount = 0,
  source,
  originalEdited,
  avatarUrl,
  mediaUrlForAttachment,
  className,
  compact = false,
  previewMedia = false,
}: ShareSnapshotPreviewProps) {
  const displayName = author.display_name || author.username || "Unknown";
  const initial = (displayName[0] || "?").toUpperCase();
  const imageAttachments = attachments.filter((attachment) => attachment.content_type?.startsWith("image/"));
  const videoAttachments = attachments.filter((attachment) => isPlayableVideo(attachment.content_type));
  const contentFilter = useMediaSafetySettingsStore((state) => state.getSettings(state.currentUser).contentFilter);
  const hasContent = content.trim().length > 0;
  const reactionEmojiIds = React.useMemo(
    () => extractCustomEmojiIds(reactions.map((reaction) => reaction.emoji).join(" ")),
    [reactions],
  );
  const reactionEmojiMap = useCustomEmojiLookup(reactionEmojiIds);

  return (
    <article
      className={cn(
        "rounded-lg border border-rm-border bg-rm-bg-surface p-4",
        !compact && "shadow-xl shadow-black/20",
        className
      )}
    >
      {originalEdited && (
        <div className="mb-4 rounded-lg border border-amber-500/25 dark:border-amber-400/20 bg-amber-500/5 dark:bg-amber-400/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          Original message has since been edited.
        </div>
      )}

      <div className="mb-3 flex items-start gap-3">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-sm font-bold text-primary">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            initial
          )}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-bold text-rm-text">{displayName}</h3>
            {createdAt && <time className="text-xs text-rm-text-muted">{formatDate(createdAt)}</time>}
          </div>
          {source && (
            <p className="mt-0.5 truncate text-xs text-rm-text-muted">
              {source.server_name} / #{source.channel_name}
            </p>
          )}
        </div>
      </div>

      {hasContent ? (
        <div className="whitespace-pre-wrap text-[15px] font-medium leading-[1.25] text-rm-text">
          <MarkdownRenderer content={content} />
        </div>
      ) : (
        <p className="text-sm italic text-rm-text-muted">(attachment only)</p>
      )}

      {embeds.length > 0 && (
        <div className="mt-3 flex flex-col items-start gap-2">
          {embeds.map((embed, index) => (
            <LinkEmbed key={embed.id || `${embed.url}-${index}`} embed={embed} />
          ))}
        </div>
      )}

      {imageAttachments.length > 0 && (
        <div className="mt-3 grid max-w-[560px] grid-cols-1 gap-2 sm:grid-cols-2">
          {imageAttachments.map((attachment) => {
            const url = mediaUrlForAttachment(attachment);
            return (
              <SensitiveMediaFrame
                key={attachment.id}
                attachmentId={attachment.id}
                blur={shouldBlurSensitiveAttachment(attachment, contentFilter)}
                className="group/image relative overflow-hidden rounded-lg border border-rm-border bg-rm-bg-elevated"
              >
                {({ revealed }) => {
                  const interactive = !shouldBlurSensitiveAttachment(attachment, contentFilter) || revealed;
                  return (
                    <a
                      href={interactive ? url : undefined}
                      target={interactive ? "_blank" : undefined}
                      rel={interactive ? "noreferrer" : undefined}
                      className="block"
                    >
                      <img
                        src={url}
                        alt={attachment.filename}
                        className={cn(
                          "h-full w-full object-contain transition group-hover/image:brightness-105",
                          previewMedia ? "max-h-[220px]" : "max-h-[360px]"
                        )}
                        loading="lazy"
                      />
                      <GifProviderBranding fileKeyOrUrl={attachment.file_key || attachment.url} />
                      <span className="sr-only">Open {attachment.filename}</span>
                    </a>
                  );
                }}
              </SensitiveMediaFrame>
            );
          })}
        </div>
      )}

      {videoAttachments.length > 0 && (
        <div className="mt-3 flex max-w-[560px] flex-col gap-2">
          {videoAttachments.map((attachment) => (
            <SensitiveMediaFrame
              key={attachment.id}
              attachmentId={attachment.id}
              blur={shouldBlurSensitiveAttachment(attachment, contentFilter)}
              className="w-fit max-w-full"
            >
              <VideoAttachment
                src={mediaUrlForAttachment(attachment)}
                filename={attachment.filename}
                maxWidth={560}
                maxHeight={previewMedia ? 240 : 420}
                showDownload={false}
                brandingKey={attachment.file_key || attachment.url}
              />
            </SensitiveMediaFrame>
          ))}
        </div>
      )}

      {omittedAttachmentCount > 0 && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-rm-border bg-rm-bg-elevated px-3 py-2 text-sm text-rm-text-muted">
          {imageAttachments.length > 0 || videoAttachments.length > 0 ? (
            <Paperclip className="h-4 w-4 shrink-0" />
          ) : (
            <ImageIcon className="h-4 w-4 shrink-0" />
          )}
          <span>
            {omittedAttachmentCount} attachment{omittedAttachmentCount === 1 ? "" : "s"} not included in public share.
          </span>
        </div>
      )}

      {(reactions.length > 0 || replyCount > 0) && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-rm-border pt-4">
          {reactions.map((reaction) => (
            <span key={reaction.emoji} className="rounded-lg border border-rm-border bg-rm-bg-elevated px-2 py-1 text-xs font-bold text-rm-text-secondary">
              <span className="inline-flex items-center gap-1.5">
                <EmojiToken
                  value={reaction.emoji}
                  customEmojiMap={reactionEmojiMap}
                  className="h-4 w-4"
                  fallbackClassName="max-w-[84px] truncate text-[11px]"
                />
                <span>{reaction.count}</span>
              </span>
            </span>
          ))}
          {replyCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-rm-border bg-rm-bg-elevated px-2 py-1 text-xs font-bold text-rm-text-secondary">
              <MessageSquare className="h-3 w-3" />
              {replyCount}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
