import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { HIT } from "@/components/ui/interaction";
import { Led } from "@/components/ui/led";
import { cn } from "@/lib/utils";
import { useMessageTimeFormat } from "../message-time";

/**
 * Shared header pieces for the one embed anatomy (talk-tree-spec §8,
 * Messages): a provider LED-dot plus the provider name, the post's short
 * date, and one open-external control.
 */

/**
 * The provider dot: the `Led` primitive at 6px, unlit. When the server sends
 * the embed's own colour (data, not theme) the dot takes it, which is where
 * the old 4px leading stripe went; otherwise it is the unlit `--line-strong`
 * dot. It never glows: a lit halo means call state, and this is identity.
 */
function EmbedProviderDot({ color }: { color?: string | null }) {
  return (
    <Led
      state="off"
      size={6}
      data-embed-dot=""
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

/**
 * A provider's post date: the short form from `message-time` (`8:12 PM`
 * today, `Yesterday`, `Oct 22`, `Oct 22, 2025`) with the full date in the
 * title. Renders nothing for a missing or unreadable date.
 */
export function EmbedDate({
  value,
  className,
}: {
  value?: string | null;
  className?: string;
}) {
  const time = useMessageTimeFormat();
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <time
      dateTime={date.toISOString()}
      title={time.full(date)}
      className={cn("shrink-0 text-ui-xs text-ink-3", className)}
    >
      {time.shortDate(date)}
    </time>
  );
}

/**
 * The one open-external control: a ghost icon button at 28 (spec §7) drawn
 * as a link, so it opens in a new tab and middle-clicks like one. Pressing
 * scales to .96 on pointer only (`:active`); hover is an ink tint.
 */
export function EmbedOpenButton({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-ink-3 outline-none",
        "transition-[scale,color,background-color] duration-(--dur-1) ease-out pointer-fine:hover:bg-tint-1 pointer-fine:hover:text-ink-1 active:scale-(--motion-press-icon)",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        HIT,
        className,
      )}
    >
      <Icon name="externalLink" size="sm" />
    </a>
  );
}

/**
 * The header row every provider card starts with:
 *
 *   ● Provider · date                                    [open]
 *
 * 20px tall; the 28px open button overhangs it by 4px each side so the row
 * height does not depend on whether a card can open externally.
 */
export function EmbedHeader({
  provider,
  color,
  timestamp,
  openHref,
  openLabel,
  className,
}: {
  provider?: ReactNode;
  color?: string | null;
  timestamp?: string | null;
  openHref?: string;
  openLabel?: string;
  className?: string;
}) {
  return (
    <div
      data-embed-header=""
      className={cn("flex min-h-5 min-w-0 items-center gap-2", className)}
    >
      <EmbedProviderDot color={color} />
      {provider ? (
        <span className="min-w-0 truncate text-ui-xs font-medium text-ink-2">
          {provider}
        </span>
      ) : null}
      {timestamp ? (
        <>
          <span aria-hidden="true" className="text-ui-xs text-ink-3">
            ·
          </span>
          <EmbedDate value={timestamp} />
        </>
      ) : null}
      {openHref ? (
        <EmbedOpenButton
          href={openHref}
          label={openLabel ?? "Open in a new tab"}
          className="-my-1 -mr-1 ml-auto"
        />
      ) : null}
    </div>
  );
}
