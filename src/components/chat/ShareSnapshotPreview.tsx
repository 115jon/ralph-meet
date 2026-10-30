import React from "react";
import type { AvatarDisplay } from "@/lib/avatar-display";
import type { Attachment, EmbedInfo } from "@/lib/types";
import { shouldBlurSensitiveAttachment } from "@/lib/media-safety";
import { isPlayableVideo } from "@/lib/media";
import { cn } from "@/lib/utils";
import { extractCustomEmojiIds } from "@/lib/emoji";
import { useCustomEmojiLookup } from "@/hooks/useCustomEmojiLookup";
import { useMediaSafetySettingsStore } from "@/stores/useMediaSafetySettingsStore";
import { Icon } from "@/components/ui/icon";
import { Num } from "@/components/ui/num";
import { useMessageTimeFormat } from "./message-time";
import { GifProviderBranding } from "./GifProviderBranding";
import { LinkEmbed } from "./LinkEmbed";
import { MarkdownRenderer } from "./MarkdownRenderer";
import SensitiveMediaFrame from "./SensitiveMediaFrame";
import VideoAttachment from "./VideoAttachment";
import EmojiToken from "./EmojiToken";
import { PreviewAvatar } from "./MessagePreviewCard";
import InlineEmojiText from "./InlineEmojiText";

interface SharePreviewAuthor {
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_display?: AvatarDisplay | string | null;
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
  /** Kept for callers; the card is flat at every size now. */
  compact?: boolean;
  previewMedia?: boolean;
}

const EMPTY_ATTACHMENTS: Attachment[] = [];
const EMPTY_EMBEDS: EmbedInfo[] = [];
const EMPTY_REACTIONS: Array<{ emoji: string; count: number }> = [];

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
  previewMedia = false,
}: ShareSnapshotPreviewProps) {
  const displayName = author.display_name || author.username || "Unknown";
  const { time, full, shortDate, today } = useMessageTimeFormat();
  const imageAttachments = attachments.filter((attachment) =>
    attachment.content_type?.startsWith("image/"),
  );
  const videoAttachments = attachments.filter((attachment) =>
    isPlayableVideo(attachment.content_type),
  );
  const contentFilter = useMediaSafetySettingsStore(
    (state) => state.getSettings(state.currentUser).contentFilter,
  );
  const hasContent = content.trim().length > 0;
  const reactionEmojiIds = React.useMemo(
    () =>
      extractCustomEmojiIds(
        reactions.map((reaction) => reaction.emoji).join(" "),
      ),
    [reactions],
  );
  const reactionEmojiMap = useCustomEmojiLookup(reactionEmojiIds);

  return (
    <article
      className={cn(
        "flex gap-3 rounded-lg border border-line bg-ply-2 p-4",
        className,
      )}
    >
      <PreviewAvatar
        name={displayName}
        src={avatarUrl}
        display={author.avatar_display ?? null}
        size={32}
      />
      <div className="min-w-0 flex-1">
        {originalEdited && (
          <p className="mb-3 flex items-start gap-2 rounded-md bg-warning-tint px-3 py-2 text-ui-sm text-warning-ink">
            <Icon name="edit" size="sm" className="mt-px shrink-0" />
            <span>The original message was edited after this was shared.</span>
          </p>
        )}

        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h3 className="min-w-0 truncate text-ui-row font-semibold text-ink-1">
            <InlineEmojiText text={displayName} />
          </h3>
          {createdAt && (
            <time
              dateTime={createdAt}
              title={full(createdAt)}
              className="shrink-0 whitespace-nowrap text-ink-3"
            >
              {shortDate(createdAt) === time(createdAt) || today === null ? (
                <Num>{time(createdAt)}</Num>
              ) : (
                <>
                  <span className="text-ui-xs">{shortDate(createdAt)}</span>{" "}
                  <Num>{time(createdAt)}</Num>
                </>
              )}
            </time>
          )}
        </div>
        {source && (
          <p className="truncate text-ui-xs text-ink-3">
            <InlineEmojiText
              text={`${source.server_name ?? ""} / #${source.channel_name ?? ""}`}
            />
          </p>
        )}

        {hasContent ? (
          <div className="max-w-[72ch] whitespace-pre-wrap break-words text-ui-base font-normal text-ink-1">
            <MarkdownRenderer content={content} />
          </div>
        ) : (
          <p className="text-ui-sm text-ink-3">Attachments only</p>
        )}

        {embeds.length > 0 && (
          <div className="mt-3 flex flex-col items-start gap-2">
            {embeds.map((embed, index) => (
              <LinkEmbed
                key={embed.id || `${embed.url}-${index}`}
                embed={embed}
              />
            ))}
          </div>
        )}

        {imageAttachments.length > 0 && (
          <div className="mt-3 grid max-w-[560px] grid-cols-1 gap-2 md:grid-cols-2">
            {imageAttachments.map((attachment) => {
              const url = mediaUrlForAttachment(attachment);
              return (
                <SensitiveMediaFrame
                  key={attachment.id}
                  attachmentId={attachment.id}
                  blur={shouldBlurSensitiveAttachment(
                    attachment,
                    contentFilter,
                  )}
                  className="group/image relative overflow-hidden rounded-xl border border-line bg-tint-1"
                >
                  {({ revealed }) => {
                    const interactive =
                      !shouldBlurSensitiveAttachment(
                        attachment,
                        contentFilter,
                      ) || revealed;
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
                            "h-full w-full object-contain",
                            previewMedia ? "max-h-[220px]" : "max-h-[360px]",
                          )}
                          loading="lazy"
                        />
                        <GifProviderBranding
                          fileKeyOrUrl={attachment.file_key || attachment.url}
                        />
                        <span className="sr-only">
                          Open {attachment.filename}
                        </span>
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
          <p className="mt-3 flex items-start gap-1.5 text-ui-xs text-pretty text-ink-3">
            <Icon
              name={
                imageAttachments.length > 0 || videoAttachments.length > 0
                  ? "paperclip"
                  : "image"
              }
              size="xs"
              className="mt-px shrink-0"
            />
            <span>
              {omittedAttachmentCount === 1
                ? "1 attachment isn't included in this public share."
                : `${omittedAttachmentCount} attachments aren't included in this public share.`}
            </span>
          </p>
        )}

        {reactions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {reactions.map((reaction) => (
              <span
                key={reaction.emoji}
                className="inline-flex h-6 items-center gap-1 rounded-sm bg-tint-1 px-1.5 text-ink-2"
              >
                <EmojiToken
                  value={reaction.emoji}
                  customEmojiMap={reactionEmojiMap}
                  className="size-4"
                  fallbackClassName="max-w-24 truncate text-ui-xs"
                />
                <Num>{reaction.count}</Num>
              </span>
            ))}
          </div>
        )}

        {replyCount > 0 && (
          <p className="mt-2 text-ui-xs text-ink-3">
            <Num>{replyCount}</Num> {replyCount === 1 ? "reply" : "replies"}
          </p>
        )}
      </div>
    </article>
  );
}
