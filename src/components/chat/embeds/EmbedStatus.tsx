import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { LedLabel, type LedState } from "@/components/ui/led";
import { cn } from "@/lib/utils";

/**
 * The one compact state for an embed that has nothing to show: a post that
 * is gone, one its platform only shows to signed-in viewers, a lookup that
 * failed, or one still on its way. Same anatomy for every provider:
 *
 *   [icon]  ● STATUS WORD
 *           Author  @handle
 *           One sentence on what happened.
 *           [Try again]  tiktok.com/@handle/video/123…
 *
 * A 40px tint-1 key with a Phosphor glyph instead of a picture, the status
 * as an LED label (unlit for gone, amber for restricted, red for a failure:
 * colour is light), and the source link so the post is always one click
 * away. "Try again" appears only when another attempt can help. Nothing
 * moves; the loading state says so in words and role=status.
 */

export type EmbedStatusKind = "gone" | "restricted" | "failed" | "loading";

const KIND: Record<
  EmbedStatusKind,
  { icon: IconName; led: LedState; label: string }
> = {
  gone: { icon: "linkBroken", led: "off", label: "Unavailable" },
  restricted: { icon: "lock", led: "idle", label: "Restricted" },
  failed: { icon: "warning", led: "muted", label: "Didn't load" },
  loading: { icon: "clock", led: "off", label: "Loading" },
};

/** What the link points at, for the sentence: "video", "track" or "post". */
function nounFor(provider: string): string {
  const key = provider.toLowerCase();
  if (key === "youtube") return "video";
  if (key === "spotify") return "track";
  return "post";
}

function embedStatusMessage(
  kind: EmbedStatusKind,
  provider: string,
  options?: { transient?: boolean },
): string {
  const noun = nounFor(provider);
  switch (kind) {
    case "gone":
      return `This ${noun} was deleted or made private.`;
    case "restricted":
      return `${provider} only shows this ${noun} to signed-in viewers.`;
    case "failed":
      return options?.transient
        ? `${provider} didn't respond. Try again in a moment.`
        : `${provider} didn't send anything we can show.`;
    case "loading":
      return `Getting this ${noun} from ${provider}.`;
  }
}

/** `tiktok.com/@a/video/123`: the link as people read it. */
function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, "");
    return `${parsed.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}

export function EmbedStatus({
  kind,
  provider,
  url,
  author,
  transient,
  onRetry,
  retrying,
  testId,
  className,
}: {
  kind: EmbedStatusKind;
  provider: string;
  url: string;
  /** Only when known: never a placeholder name or a bare "@". */
  author?: { name?: string; handle?: string; url?: string } | null;
  transient?: boolean;
  /** Shown only for a transient failure. */
  onRetry?: () => void;
  retrying?: boolean;
  testId?: string;
  className?: string;
}) {
  const meta = KIND[kind];
  const name = author?.name?.trim() || undefined;
  const handle = author?.handle?.replace(/^@/, "").trim() || undefined;
  const showHandle =
    handle && handle.toLowerCase() !== name?.toLowerCase().replace(/^@/, "");
  const authorLine: ReactNode =
    name || handle ? (
      <>
        <span className="min-w-0 truncate font-semibold text-ink-1">
          {name ?? `@${handle}`}
        </span>
        {showHandle && name ? (
          <span className="min-w-0 shrink-[2] truncate text-ink-3">
            @{handle}
          </span>
        ) : null}
      </>
    ) : null;
  const canRetry = kind === "failed" && transient && onRetry;

  return (
    <div
      data-embed-status={kind}
      data-testid={testId}
      role={kind === "loading" ? "status" : undefined}
      className={cn("flex min-w-0 items-start gap-3", className)}
    >
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-avatar bg-tint-1 text-ink-2"
      >
        <Icon name={meta.icon} size="md" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <LedLabel state={meta.led}>{meta.label}</LedLabel>
        {authorLine ? (
          author?.url ? (
            <a
              href={author.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-w-0 items-baseline gap-1.5 text-ui-sm underline-offset-3 outline-none pointer-fine:hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {authorLine}
            </a>
          ) : (
            <p className="flex min-w-0 items-baseline gap-1.5 text-ui-sm">
              {authorLine}
            </p>
          )
        ) : null}
        <p className="text-ui-sm text-pretty text-ink-2">
          {embedStatusMessage(kind, provider, { transient })}
        </p>
        <div className="flex min-w-0 items-center gap-3 pt-1">
          {canRetry ? (
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={onRetry}
              disabled={retrying}
            >
              <Icon name="refresh" size="xs" />
              Try again
            </Button>
          ) : null}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={url}
            className="min-w-0 truncate text-ui-xs text-ink-3 underline-offset-3 outline-none pointer-fine:hover:text-ink-2 pointer-fine:hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {displayUrl(url)}
          </a>
        </div>
      </div>
    </div>
  );
}
