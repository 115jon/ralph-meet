import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Led } from "@/components/ui/led";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";

interface VoiceStreamHoverCardProps {
  displayName: string;
  thumbnailUrl?: string | null;
  isCurrentUser?: boolean;
  onWatchStream?: () => void;
  className?: string;
}

/** No frame yet: a quiet ply-2 field with the live LED and one line. */
function PlaceholderStreamPreview({
  displayName,
  isCurrentUser,
}: {
  displayName: string;
  isCurrentUser: boolean;
}) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 bg-ply-2 px-5 py-4 text-center">
      <span className="flex size-10 items-center justify-center rounded-md bg-live-tint text-live-ink">
        <Icon name="stream" size="lg" />
      </span>
      <div className="max-w-[14rem]">
        <p className="text-ui-sm font-semibold text-ink-1">
          {isCurrentUser ? "Your stream is live" : `${displayName} is live`}
        </p>
        <p className="mt-0.5 text-ui-xs text-pretty text-ink-3">
          Preview syncing now. A fresh frame should appear in a moment.
        </p>
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
    ? hasWatchAction
      ? "Open stream"
      : "You're Streaming!"
    : "Watch stream";
  const resolvedThumbnailUrl = thumbnailUrl
    ? thumbnailUrl.startsWith("data:")
      ? thumbnailUrl
      : getAuthAssetUrl(thumbnailUrl)
    : null;
  const handleWatchStream = hasWatchAction ? onWatchStream : undefined;

  return (
    <div
      className={cn(
        "w-[292px] rounded-lg border border-line bg-ply-3 p-3 text-ink-1 shadow-float",
        className,
      )}
      data-stream-hover-card="true"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-ui-sm font-semibold text-ink-2">
          Streaming now
        </span>
        <Badge variant="live">
          <Led state="live" />
          Live
        </Badge>
      </div>

      <button
        type="button"
        aria-disabled={!hasWatchAction || undefined}
        disabled={!hasWatchAction}
        onClick={handleWatchStream}
        className={cn(
          "group/stream-thumb relative block w-full overflow-hidden rounded-md border border-line bg-ply-2 text-left outline-none transition-[scale] duration-(--dur-1) ease-out",
          hasWatchAction
            ? "cursor-pointer enabled:active:scale-(--motion-press)"
            : "cursor-default",
        )}
      >
        <div className="aspect-[16/10] w-full">
          {resolvedThumbnailUrl ? (
            <img
              src={resolvedThumbnailUrl}
              alt={`${displayName} stream preview`}
              className="size-full object-cover"
            />
          ) : (
            <PlaceholderStreamPreview
              displayName={displayName}
              isCurrentUser={isCurrentUser}
            />
          )}
        </div>
        {hasWatchAction ? (
          <div className="pointer-events-none absolute inset-0 bg-ply-0/0 transition-colors duration-(--dur-1) ease-out pointer-fine:group-hover/stream-thumb:bg-ply-0/35" />
        ) : null}
      </button>

      <Button
        type="button"
        variant={hasWatchAction ? "primary" : "secondary"}
        disabled={!hasWatchAction}
        onClick={handleWatchStream}
        className="mt-3 w-full"
      >
        <Icon name="screenShare" size="sm" />
        <span>{ctaLabel}</span>
      </Button>
    </div>
  );
}
