import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { formatMessageDate } from "@/components/chat/MessageItem";
import { MiniAvatar } from "@/components/chat/MiniAvatar";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import { Icon } from "@/components/ui/icon";
import { Num } from "@/components/ui/num";
import { useUserResolution } from "@/hooks/useUserResolution";
import {
  useClientDateFormatter,
  useClientReferenceTime,
  type ClientDateFormatter,
} from "@/lib/client-date-format";
import { getFileIcon } from "@/lib/file-icons";
import {
  excerptAroundMatch,
  highlightSegments,
  type SearchResultMessage,
} from "@/lib/message-search";
import { cn } from "@/lib/utils";
import { memo, useId, useMemo, type CSSProperties } from "react";

const MENTION_RE = /(@[a-zA-Z0-9_]+)/g;
// Markdown markers read as noise in a plain excerpt; the jump shows the real
// render.
const MARKDOWN_RE = /\*\*|__|~~|`/g;

function TextWithMentions({ text }: { text: string }) {
  const parts = text.split(MENTION_RE);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="font-medium text-accent-ink">
            {part}
          </span>
        ) : part ? (
          <InlineEmojiText key={i} text={part} />
        ) : null,
      )}
    </>
  );
}

export function HighlightedExcerpt({
  content,
  terms,
}: {
  content: string;
  terms: readonly string[];
}) {
  const segments = useMemo(() => {
    const plain = content.replace(MARKDOWN_RE, "");
    return highlightSegments(excerptAroundMatch(plain, terms), terms);
  }, [content, terms]);
  return (
    <>
      {segments.map((segment, i) =>
        segment.match ? (
          <mark
            key={i}
            className="rounded-xs bg-accent-tint px-px text-ink-1 [box-decoration-break:clone]"
          >
            {segment.text}
          </mark>
        ) : (
          <TextWithMentions key={i} text={segment.text} />
        ),
      )}
    </>
  );
}

const ATTACHMENT_PILL =
  "inline-flex h-6 max-w-[200px] items-center gap-1.5 rounded-sm border border-line bg-ply-2 px-1.5 text-ui-xs text-ink-2";

/**
 * The visible stamp: the time today, the date and time otherwise (the year
 * only when it isn't this one). Numbers, so it sets in Num; the aria-label
 * keeps the spoken "Today at" form.
 */
function shortStamp(
  iso: string,
  formatDate: ClientDateFormatter,
  referenceTime: number | null,
): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const time = formatDate(date, { hour: "numeric", minute: "2-digit" });
  if (referenceTime === null) return time;
  const ref = new Date(referenceTime);
  if (date.toDateString() === ref.toDateString()) return time;
  const sameYear = date.getFullYear() === ref.getFullYear();
  const day = formatDate(date, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${day}, ${time}`;
}

function attachmentKind(contentType: string | null): string {
  if (!contentType) return "File";
  if (contentType.startsWith("image/")) return "Image";
  if (contentType.startsWith("video/")) return "Video";
  if (contentType.startsWith("audio/")) return "Audio";
  return "File";
}

export interface SearchResultItemProps {
  message: SearchResultMessage;
  terms: readonly string[];
  roleColor: string | null;
  active: boolean;
  onJump: (message: SearchResultMessage) => void;
}

/**
 * One hit, drawn like a message row: avatar, name in role colour, time,
 * excerpt with the matches marked, then what it carries. The whole row is the
 * jump target.
 */
export const SearchResultItem = memo(function SearchResultItem({
  message,
  terms,
  roleColor,
  active,
  onJump,
}: SearchResultItemProps) {
  const author = useUserResolution(message.author_id, message.author);
  const formatDate = useClientDateFormatter();
  const referenceTime = useClientReferenceTime();
  const excerptId = useId();
  const when = formatMessageDate(message.created_at, formatDate, referenceTime);
  const shortWhen = shortStamp(message.created_at, formatDate, referenceTime);
  const attachments = message.attachments;
  const shownAttachments = attachments.slice(0, 2);
  const hiddenAttachments = attachments.length - shownAttachments.length;
  const hasText = message.content.trim().length > 0;
  const nameColor =
    roleColor && !author.displayNameStyle ? roleColor : undefined;

  return (
    <button
      type="button"
      data-search-result=""
      onClick={() => onJump(message)}
      aria-label={`Jump to message from ${author.displayName}, ${when}`}
      aria-describedby={excerptId}
      aria-current={active ? "true" : undefined}
      className={cn(
        "group/result relative flex w-full gap-2.5 rounded-sm px-2 py-2 text-left outline-none select-none [-webkit-tap-highlight-color:transparent]",
        "transition-colors duration-(--dur-1) ease-out focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
        active ? "bg-tint-2" : "pointer-fine:hover:bg-tint-1 active:bg-tint-2",
      )}
    >
      <MiniAvatar
        avatarUrl={author.avatarUrl}
        avatarDisplay={author.avatarDisplay}
        displayName={author.displayName}
        username={author.username}
        size={24}
        className="max-md:size-8"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex h-5 min-w-0 items-center gap-2 pr-12 pointer-coarse:pr-0">
          <ProfileDisplayName
            text={author.displayName}
            displayNameStyle={author.displayNameStyle}
            className={cn(
              "block min-w-0 truncate text-ui-sm font-semibold text-ink-1 max-md:text-ui-base",
              nameColor && "rm-role-name",
            )}
            style={
              nameColor
                ? ({
                    color: nameColor,
                    "--rm-role-color": nameColor,
                  } as CSSProperties)
                : undefined
            }
          />
          <Num className="shrink-0 text-ink-3">
            <time dateTime={message.created_at}>{shortWhen}</time>
          </Num>
          {message.is_pinned && (
            <Icon
              name="pin"
              state="active"
              size="xs"
              label="Pinned"
              className="shrink-0 text-ink-3"
            />
          )}
        </span>
        <span
          id={excerptId}
          className={cn(
            "block text-ui-sm text-ink-2 [overflow-wrap:anywhere] line-clamp-4 max-md:text-ui-base",
            !hasText && "text-ink-3",
          )}
        >
          {hasText ? (
            <HighlightedExcerpt content={message.content} terms={terms} />
          ) : attachments.length > 0 ? (
            "Sent an attachment"
          ) : (
            "No text"
          )}
        </span>
        {(attachments.length > 0 || message.embed_count > 0) && (
          <span className="mt-1.5 flex flex-wrap gap-1">
            {shownAttachments.map((attachment) => {
              const { icon } = getFileIcon(
                attachment.filename,
                attachment.content_type ?? undefined,
              );
              return (
                <span key={attachment.id} className={ATTACHMENT_PILL}>
                  <Icon name={icon} size="xs" className="shrink-0 text-ink-3" />
                  <span className="sr-only">
                    {attachmentKind(attachment.content_type)}:
                  </span>
                  <span className="truncate">{attachment.filename}</span>
                </span>
              );
            })}
            {hiddenAttachments > 0 && (
              <span className={cn(ATTACHMENT_PILL, "text-ink-3")}>
                <Num>+{hiddenAttachments}</Num> more
              </span>
            )}
            {message.embed_count > 0 && (
              <span className={ATTACHMENT_PILL}>
                <Icon name="link" size="xs" className="shrink-0 text-ink-3" />
                {message.embed_count === 1 ? (
                  "Link preview"
                ) : (
                  <>
                    <Num>{message.embed_count}</Num> link previews
                  </>
                )}
              </span>
            )}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1.5 right-1.5 hidden h-6 items-center rounded-sm bg-tint-2 px-2 text-ui-xs font-medium text-ink-1 opacity-0 transition-opacity duration-(--dur-1) ease-out pointer-fine:inline-flex pointer-fine:group-hover/result:opacity-100 pointer-fine:group-focus-visible/result:opacity-100"
      >
        Jump
      </span>
    </button>
  );
});
