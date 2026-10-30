import type * as React from "react";

import { Avatar, type AvatarSize } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icon";
import { Num } from "@/components/ui/num";
import type { AvatarDisplay } from "@/lib/avatar-display";
import { getDisplayName } from "@/lib/display-name";
import { isPlayableVideo } from "@/lib/media";
import { shouldBlurSensitiveAttachment } from "@/lib/media-safety";
import { getAuthAssetUrl } from "@/lib/platform";
import type { Attachment, Message } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useMediaSafetySettingsStore } from "@/stores/useMediaSafetySettingsStore";
import { AvatarImage } from "./AvatarImage";
import { avatarShape } from "@/components/ui/avatar-shape";
import InlineEmojiText from "./InlineEmojiText";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { useMessageTimeFormat } from "./message-time";

const AVATAR_BOX: Partial<Record<AvatarSize, string>> = {
  20: "size-5",
  24: "size-6",
  32: "size-8",
};

/**
 * A round avatar that honours the person's saved crop (`avatar_display`)
 * when they have an image, and falls back to the Talk Tree initial on a tint.
 */
export function PreviewAvatar({
  name,
  src,
  display,
  size = 32,
}: {
  name: string;
  src?: string | null;
  display?: AvatarDisplay | string | null;
  size?: 20 | 24 | 32;
}) {
  if (!src) return <Avatar name={name} size={size} aria-hidden="true" />;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 bg-tint-3",
        avatarShape(display),
        AVATAR_BOX[size],
      )}
    >
      <AvatarImage src={src} alt="" display={display ?? null} />
    </span>
  );
}

const MAX_THUMBS = 4;

function attachmentSrc(attachment: Attachment): string {
  return getAuthAssetUrl(attachment.url || `/api/${attachment.file_key}`);
}

/**
 * Attachments as one compact line under the body: up to four 40px media
 * cells (an image, or a play glyph for a video), then a count of
 * the rest and of files. Never the full media; this is a preview.
 */
function PreviewAttachments({ attachments }: { attachments: Attachment[] }) {
  const contentFilter = useMediaSafetySettingsStore(
    (state) => state.getSettings(state.currentUser).contentFilter,
  );
  const media = attachments.filter(
    (attachment) =>
      attachment.content_type?.startsWith("image/") ||
      isPlayableVideo(attachment.content_type),
  );
  const files = attachments.length - media.length;
  const shown = media.slice(0, MAX_THUMBS);
  const extraMedia = media.length - shown.length;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {shown.map((attachment) => {
        const video = isPlayableVideo(attachment.content_type);
        const blur = shouldBlurSensitiveAttachment(attachment, contentFilter);
        return (
          <span
            key={attachment.id}
            className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-tint-2 text-ink-2"
          >
            {video ? (
              <Icon name="play" size="sm" state="active" />
            ) : (
              <img
                src={attachmentSrc(attachment)}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                data-rm-preserve-blur={blur ? "true" : undefined}
                className={cn(
                  "size-full object-cover",
                  blur && "scale-110 blur-sm",
                )}
              />
            )}
          </span>
        );
      })}
      {extraMedia > 0 || files > 0 ? (
        <span className="ml-1 inline-flex items-center gap-1 text-ui-xs text-ink-3">
          <Icon name="paperclip" size="xs" />
          {extraMedia > 0 ? (
            <span>
              <Num>+{extraMedia}</Num>
            </span>
          ) : null}
          {files > 0 ? (
            <span>
              <Num>{files}</Num> {files === 1 ? "file" : "files"}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export interface MessagePreviewCardProps {
  message: Message;
  /** Body line clamp. Default 4. */
  clamp?: 2 | 3 | 4 | 6;
  /** Extra lines under the preview (a share notice, for example). */
  children?: React.ReactNode;
  className?: string;
}

const CLAMP = {
  2: "line-clamp-2",
  3: "line-clamp-3",
  4: "line-clamp-4",
  6: "line-clamp-6",
} as const;

/**
 * The one compact message preview for dialogs (pin, unpin, delete, share):
 * avatar 32, author 13/18 at 600, time-only in `Num` ink-3 with the full date
 * in a title, body 13/20 clamped, an attachment line. `rounded-lg bg-tint-1
 * p-3`, no border, no card-in-card. Inert to pointer and assistive tech is the
 * caller's choice; the card itself has no interactive content.
 */
export function MessagePreviewCard({
  message,
  clamp = 4,
  children,
  className,
}: MessagePreviewCardProps) {
  const { time, full } = useMessageTimeFormat();
  const author = message.author;
  const name = getDisplayName(author);
  const avatarSrc = author?.avatar_url
    ? getAuthAssetUrl(author.avatar_url)
    : null;
  const attachments = message.attachments ?? [];
  const embeds = message.embeds?.length ?? 0;
  const hasBody = message.content.trim().length > 0;

  return (
    <div
      data-slot="message-preview-card"
      className={cn("flex gap-3 rounded-lg bg-tint-1 p-3", className)}
    >
      <PreviewAvatar
        name={name}
        src={avatarSrc}
        display={author?.avatar_display}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate text-ui-sm font-semibold text-ink-1">
            <InlineEmojiText text={name} />
          </span>
          <time
            dateTime={message.created_at}
            title={full(message.created_at)}
            className="shrink-0 text-ink-3"
          >
            <Num>{time(message.created_at)}</Num>
          </time>
        </div>
        {hasBody ? (
          <div
            className={cn(
              "mt-0.5 text-ui-sm/5 font-normal wrap-break-word text-ink-2 [&_*]:my-0",
              CLAMP[clamp],
            )}
          >
            <MarkdownRenderer content={message.content} />
            {message.updated_at ? (
              <span className="text-ui-xs whitespace-nowrap text-ink-3">
                {" "}(edited)
              </span>
            ) : null}
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <PreviewAttachments attachments={attachments} />
        ) : null}
        {!hasBody && attachments.length === 0 && embeds > 0 ? (
          <p className="mt-0.5 inline-flex items-center gap-1 text-ui-xs text-ink-3">
            <Icon name="link" size="xs" />
            {embeds === 1 ? "Link preview" : "Link previews"}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}
