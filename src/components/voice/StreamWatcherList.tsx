import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { StreamWatcherIdentity } from "@/lib/stream-watchers";

const MAX_VISIBLE_AVATARS = 4;
const MAX_VISIBLE_NAMES = 2;

interface StreamWatcherListProps {
  watchers: StreamWatcherIdentity[];
  variant?: "default" | "inline";
  className?: string;
}

function formatWatcherSummary(watchers: StreamWatcherIdentity[]) {
  const visibleNames = watchers.slice(0, MAX_VISIBLE_NAMES).map((watcher) => watcher.name);
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
  const viewerLabel = watchers.length === 1 ? "1 viewer" : `${watchers.length} viewers`;
  const isInline = variant === "inline";

  return (
    <div
      className={cn(
        "min-w-0",
        isInline
          ? "flex min-w-0 items-center gap-2"
          : "flex max-w-full items-center gap-2 rounded-2xl border border-rm-border/80 bg-rm-bg-primary/72 px-2.5 py-1.5 shadow-xl backdrop-blur-md",
        className,
      )}
    >
      <div className={cn("flex shrink-0", isInline ? "-space-x-1.5" : "-space-x-2")}>
        {visibleWatchers.map((watcher) => (
          <div
            key={watcher.userId}
            className={cn(
              "overflow-hidden rounded-full border bg-rm-bg-surface",
              isInline ? "h-6 w-6 border-white/20" : "h-6 w-6 border-rm-border",
            )}
            title={watcher.name}
          >
            {watcher.avatar ? (
              <img src={getAuthAssetUrl(watcher.avatar)} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] font-black text-rm-text">
                {watcher.name[0]?.toUpperCase() ?? "?"}
              </div>
            )}
          </div>
        ))}
        {overflowCount > 0 && (
          <div
            className={cn(
              "flex items-center justify-center rounded-full border text-[9px] font-black",
              isInline
                ? "h-6 w-6 border-white/20 bg-white/10 text-white"
                : "h-6 w-6 border-rm-border bg-rm-bg-elevated text-rm-text",
            )}
            title={`${overflowCount} more viewers`}
          >
            +{overflowCount}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className={cn(
          "font-black uppercase tracking-[0.18em]",
          isInline ? "text-[8px] text-white/55" : "text-[9px] text-primary",
        )}>
          {viewerLabel}
        </div>
        <div className={cn(
          "truncate font-semibold",
          isInline ? "text-[11px] text-white" : "text-[11px] text-rm-text",
        )}>
          {namesLabel}
        </div>
      </div>
    </div>
  );
}
