import { Icon } from "@/components/ui/icon";

import {
  formatListenTogetherDuration,
  useListenTogetherPlaybackState,
} from "./listen-together-playback";

interface ListenTogetherSidebarStatusProps {
  roomSlug?: string | null;
}

export function ListenTogetherSidebarStatus({
  roomSlug,
}: ListenTogetherSidebarStatusProps) {
  const playback = useListenTogetherPlaybackState(roomSlug);
  const track = playback.currentEntry?.track;

  if (!track) return null;

  return (
    <div className="mb-1 ml-7 mr-2 flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-rm-text-muted">
      <div className="h-7 w-7 shrink-0 overflow-hidden rounded-md bg-rm-bg-elevated ring-1 ring-white/8">
        {track.artworkUrl ? (
          <img
            src={track.artworkUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-emerald-400">
            <Icon name="music" size="sm" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon name="music" size="xs" className="shrink-0 text-emerald-400" />
          <span className="truncate text-ui-xs font-semibold text-rm-text-secondary">
            {track.title}
          </span>
        </div>
        <span className="mt-0.5 block text-ui-2xs tabular-nums text-emerald-400/80">
          {formatListenTogetherDuration(playback.effectiveSeekValue)}
        </span>
      </div>
    </div>
  );
}
