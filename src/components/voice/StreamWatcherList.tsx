import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { StreamWatcherIdentity } from "@/lib/stream-watchers";
import { AvatarImage } from "@/components/chat/AvatarImage";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { Num } from "@/components/ui/num";

const MAX_VISIBLE_AVATARS = 4;
const MAX_VISIBLE_NAMES = 2;

interface StreamWatcherListProps {
  watchers: StreamWatcherIdentity[];
  variant?: "default" | "inline";
  className?: string;
}

function formatWatcherSummary(watchers: StreamWatcherIdentity[]) {
  const visibleNames = watchers
    .slice(0, MAX_VISIBLE_NAMES)
    .map((watcher) => watcher.name);
  const remainingNames = watchers.length - visibleNames.length;

  if (visibleNames.length === 0) return "";
  if (remainingNames <= 0) return visibleNames.join(", ");
  return `${visibleNames.join(", ")} and ${remainingNames} more`;
}

export function StreamWatcherList({
  watchers,
  variant = "default",
  className,
}: StreamWatcherListProps) {
  if (watchers.length === 0) return null;

  const visibleWatchers = watchers.slice(0, MAX_VISIBLE_AVATARS);
  const overflowCount = watchers.length - visibleWatchers.length;
  const namesLabel = formatWatcherSummary(watchers);
  const viewerLabel =
    watchers.length === 1 ? "1 viewer" : `${watchers.length} viewers`;
  const isInline = variant === "inline";

  return (
    <div
      className={cn(
        "min-w-0",
        isInline
          ? "flex min-w-0 items-center gap-2"
          : "flex max-w-full items-center gap-2 rounded-lg border border-line-strong bg-ply-3 px-2.5 py-1.5 shadow-float",
        className,
      )}
    >
      <div
        className={cn(
          "flex shrink-0",
          isInline ? "-space-x-1.5" : "-space-x-2",
        )}
      >
        {visibleWatchers.map((watcher) => (
          <div
            key={watcher.userId}
            className={cn(
              "size-6 overflow-visible rounded-avatar bg-ply-2",
              isInline ? "border border-white/20" : "ring-2 ring-ply-3",
            )}
            title={watcher.name}
          >
            {watcher.avatar ? (
              <AvatarImage
                src={getAuthAssetUrl(watcher.avatar)}
                alt=""
                display={watcher.avatarDisplay}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-[inherit] bg-tint-3 font-display text-[11px] leading-none font-extrabold text-ink-1">
                {watcher.name[0]?.toUpperCase() ?? "?"}
              </div>
            )}
          </div>
        ))}
        {overflowCount > 0 && (
          <div
            className={cn(
              "flex size-6 items-center justify-center rounded-avatar",
              isInline
                ? "border border-white/20 bg-white/10 text-white"
                : "bg-ply-4 text-ink-1 ring-2 ring-ply-3",
            )}
            title={`${overflowCount} more viewers`}
          >
            <Num>+{overflowCount}</Num>
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div
          className={cn(
            "text-ui-xs font-semibold",
            isInline ? "text-white/70" : "text-ink-1",
          )}
        >
          {viewerLabel}
        </div>
        <div
          className={cn(
            "truncate text-ui-xs font-medium",
            isInline ? "text-white" : "text-ink-2",
          )}
        >
          <InlineEmojiText text={namesLabel} />
        </div>
      </div>
    </div>
  );
}
