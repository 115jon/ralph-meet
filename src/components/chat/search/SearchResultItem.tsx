import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { formatMessageDate } from "@/components/chat/MessageItem";
import { MiniAvatar } from "@/components/chat/MiniAvatar";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import { Icon } from "@/components/ui/icon";
import { useUserResolution } from "@/hooks/useUserResolution";
import {
  useClientDateFormatter,
  useClientReferenceTime,
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
          <span
            key={i}
            className="rounded-[4px] bg-rm-accent-dim px-0.5 font-medium text-rm-accent-ink"
          >
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
            className="rounded-[3px] bg-[color-mix(in_oklab,var(--rm-accent)_30%,transparent)] px-px text-rm-text [box-decoration-break:clone]"
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
        "group/result relative flex w-full gap-3 rounded-lg px-3 py-2.5 text-left outline-none select-none [-webkit-tap-highlight-color:transparent]",
        "transition-[background-color] duration-150 ease-(--rm-ease-out)",
        "bg-rm-tint-1 pointer-fine:hover:bg-rm-tint-2 active:bg-rm-tint-2",
        active && "bg-rm-tint-2 ring-1 ring-inset ring-rm-border-strong",
      )}
    >
      <MiniAvatar
        avatarUrl={author.avatarUrl}
        avatarDisplay={author.avatarDisplay}
        displayName={author.displayName}
        username={author.username}
        size={36}
        className="mt-0.5 max-md:size-10"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2 pr-12 pointer-coarse:pr-0">
          <ProfileDisplayName
            text={author.displayName}
            displayNameStyle={author.displayNameStyle}
            className={cn(
              "block min-w-0 truncate text-ui-sm font-semibold text-rm-text max-md:text-ui-base",
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
          <time
            dateTime={message.created_at}
            className="shrink-0 text-ui-2xs text-rm-text-muted tabular-nums max-md:text-ui-xs"
          >
            {when}
          </time>
          {message.is_pinned && (
            <Icon
              name="pin"
              state="active"
              size="xs"
              label="Pinned"
              className="shrink-0 self-center text-rm-text-muted"
            />
          )}
        </span>
        <span
          id={excerptId}
          className={cn(
            "mt-0.5 block text-ui-sm leading-[1.45] text-rm-text-secondary [overflow-wrap:anywhere] line-clamp-5 max-md:text-ui-base max-md:leading-[1.4]",
            !hasText && "italic text-rm-text-muted",
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
          <span className="mt-2 flex flex-wrap gap-1.5">
            {shownAttachments.map((attachment) => {
              const { icon } = getFileIcon(
                attachment.filename,
                attachment.content_type ?? undefined,
              );
              return (
                <span
                  key={attachment.id}
                  className="inline-flex h-6 max-w-[200px] items-center gap-1.5 rounded-md border border-rm-border bg-rm-bg-primary px-1.5 text-ui-xs text-rm-text-secondary"
                >
                  <Icon
                    name={icon}
                    size="xs"
                    className="shrink-0 text-rm-text-muted"
                  />
                  <span className="sr-only">
                    {attachmentKind(attachment.content_type)}:
                  </span>
                  <span className="truncate">{attachment.filename}</span>
                </span>
              );
            })}
            {hiddenAttachments > 0 && (
              <span className="inline-flex h-6 items-center rounded-md border border-rm-border bg-rm-bg-primary px-1.5 text-ui-xs text-rm-text-muted tabular-nums">
                +{hiddenAttachments} more
              </span>
            )}
            {message.embed_count > 0 && (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-rm-border bg-rm-bg-primary px-1.5 text-ui-xs text-rm-text-secondary">
                <Icon
                  name="link"
                  size="xs"
                  className="shrink-0 text-rm-text-muted"
                />
                {message.embed_count === 1
                  ? "Link preview"
                  : `${message.embed_count} link previews`}
              </span>
            )}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-2 right-2 hidden h-6 items-center rounded-md bg-rm-bg-primary px-2 text-ui-xs font-medium text-rm-text-secondary opacity-0 shadow-[var(--rm-shadow-1)] transition-opacity duration-150 ease-(--rm-ease-out) pointer-fine:inline-flex pointer-fine:group-hover/result:opacity-100 pointer-fine:group-focus-visible/result:opacity-100"
      >
        Jump
      </span>
    </button>
  );
});
