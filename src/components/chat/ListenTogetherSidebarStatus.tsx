import { Icon } from "@/components/ui/icon";

import { ListenTogetherClock } from "./ListenTogetherNowPlayingCard";
import { useListenTogetherPlaybackState } from "./listen-together-playback";

interface ListenTogetherSidebarStatusProps {
  roomSlug?: string | null;
}

/**
 * What the room is listening to, under the voice channel in the tree. Only
 * the elapsed time ticks, in its own leaf.
 */
export function ListenTogetherSidebarStatus({
  roomSlug,
}: ListenTogetherSidebarStatusProps) {
  const playback = useListenTogetherPlaybackState(roomSlug);
  const track = playback.currentEntry?.track;

  if (!track) return null;

  return (
    <div className="mr-2 mb-1 ml-7 flex min-w-0 items-center gap-2 rounded-sm px-1 py-1">
      <div className="size-7 shrink-0 overflow-hidden rounded-sm bg-tint-1">
        {track.artworkUrl ? (
          <img
            src={track.artworkUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-3">
            <Icon name="music" size="sm" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon
            name={playback.isPaused ? "pause" : "play"}
            state="active"
            size="xs"
            className="shrink-0 text-ink-3"
          />
          <span className="truncate text-ui-xs font-medium text-ink-2">
            {track.title}
          </span>
        </div>
        <ListenTogetherClock playback={playback} className="block text-ink-3" />
      </div>
    </div>
  );
}
