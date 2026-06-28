import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { MonitorPlay, ScreenShare } from "lucide-react";

interface VoiceStreamHoverCardProps {
  displayName: string;
  thumbnailUrl?: string | null;
  isCurrentUser?: boolean;
  onWatchStream?: () => void;
  className?: string;
}

function PlaceholderStreamPreview({
  displayName,
  isCurrentUser,
}: {
  displayName: string;
  isCurrentUser: boolean;
}) {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[14px] border border-rm-border bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.12),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))] px-5 py-4">
      <div className="absolute inset-4 rounded-[18px] border border-rm-border bg-rm-bg-primary/70 shadow-inner shadow-black/10" />
      <div className="absolute inset-x-8 top-7 h-10 rounded-full border border-rm-border bg-rm-bg-elevated/70" />
      <div className="absolute inset-x-12 top-11 bottom-11 rounded-[20px] border border-primary/15 bg-rm-bg-surface/85" />
      <div className="absolute left-1/2 top-[3.25rem] h-12 w-12 -translate-x-1/2 rounded-2xl border border-primary/25 bg-primary/12 shadow-lg shadow-primary/10" />
      <div className="absolute left-1/2 top-[4.05rem] h-14 w-px -translate-x-1/2 bg-primary/25" />
      <div className="absolute inset-x-[30%] bottom-10 h-px bg-rm-border" />
      <div className="absolute left-1/2 bottom-[2.2rem] h-6 w-6 -translate-x-1/2 rounded-full border border-rm-border bg-rm-bg-elevated/90" />
      <div className="absolute inset-x-14 bottom-6 flex items-end justify-center gap-2">
        <div className="h-6 w-6 rounded-full border border-rm-border bg-rm-bg-elevated/80" />
        <div className="h-8 w-8 rounded-full border border-rm-border bg-rm-bg-elevated/95" />
        <div className="h-6 w-6 rounded-full border border-rm-border bg-rm-bg-elevated/80" />
      </div>
      <div className="relative z-10 flex max-w-[14rem] flex-col items-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-lg shadow-primary/10">
          <MonitorPlay className="h-7 w-7" />
        </div>
        <div>
          <p className="text-sm font-semibold text-rm-text">
            {isCurrentUser ? "Your stream is live" : `${displayName} is live`}
          </p>
          <p className="mt-1 text-[12px] leading-5 text-rm-text-muted">
            Preview syncing now. A fresh frame should appear in a moment.
          </p>
        </div>
      </div>
    </div>
  );
}

export function VoiceStreamHoverCard({
  displayName,
  thumbnailUrl,
  isCurrentUser = false,
  onWatchStream,
  className,
}: VoiceStreamHoverCardProps) {
  const hasWatchAction = typeof onWatchStream === "function";
  const ctaLabel = isCurrentUser
    ? (hasWatchAction ? "Open Stream" : "You're Streaming!")
    : "Watch Stream";
  const resolvedThumbnailUrl = thumbnailUrl
    ? (thumbnailUrl.startsWith("data:") ? thumbnailUrl : getAuthAssetUrl(thumbnailUrl))
    : null;
  const handleWatchStream = hasWatchAction ? onWatchStream : undefined;

  return (
    <div
      className={cn(
        "w-[292px] rounded-[18px] border border-rm-border bg-rm-bg-floating p-3 text-rm-text shadow-xl backdrop-blur-xl",
        className,
      )}
      data-stream-hover-card="true"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-rm-text-muted">Streaming now</span>
        <span className="rounded-full border border-destructive/25 bg-destructive/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-destructive">
          LIVE
        </span>
      </div>

      <button
        type="button"
        aria-disabled={!hasWatchAction || undefined}
        disabled={!hasWatchAction}
        onClick={handleWatchStream}
        className={cn(
          "group/stream-thumb relative block w-full overflow-hidden rounded-[16px] border border-rm-border bg-rm-bg-surface text-left shadow-lg transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-rm-bg-floating",
          hasWatchAction && "cursor-pointer hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-xl active:translate-y-0 active:scale-[0.995]",
          !hasWatchAction && "cursor-default",
        )}
      >
        <div className="aspect-[16/10] w-full">
          {resolvedThumbnailUrl ? (
            <img
              src={resolvedThumbnailUrl}
              alt={`${displayName} stream preview`}
              className={cn(
                "h-full w-full object-cover transition-transform duration-300",
                hasWatchAction && "group-hover/stream-thumb:scale-[1.015]",
              )}
            />
          ) : (
            <PlaceholderStreamPreview displayName={displayName} isCurrentUser={isCurrentUser} />
          )}
        </div>
        <div
          className={cn(
            "pointer-events-none absolute inset-0 bg-transparent transition-colors duration-200",
            hasWatchAction && "group-hover/stream-thumb:bg-rm-bg-primary/35",
          )}
        />
        <div className="pointer-events-none absolute inset-x-4 bottom-4 flex items-center justify-center">
          <div
            className={cn(
              "rounded-full border border-rm-border bg-rm-bg-floating/90 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-rm-text shadow-lg backdrop-blur-sm transition-all duration-200",
              hasWatchAction ? "opacity-0 group-hover/stream-thumb:-translate-y-0.5 group-hover/stream-thumb:opacity-100" : "opacity-100",
            )}
          >
            {ctaLabel}
          </div>
        </div>
      </button>

      <button
        type="button"
        disabled={!hasWatchAction}
        onClick={handleWatchStream}
        className={cn(
          "mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border text-sm font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-rm-bg-floating",
          hasWatchAction
            ? "border-primary/20 bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90 active:scale-[0.99]"
            : "cursor-default border-rm-border bg-rm-bg-elevated/70 text-rm-text-muted",
        )}
      >
        <ScreenShare className="h-4 w-4" />
        <span>{ctaLabel}</span>
      </button>
    </div>
  );
}
