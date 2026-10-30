import { Icon } from "@/components/ui/icon";
import type { SFUClient } from "@/lib/sfu-client";

import { FloatingSurface } from "./floating/FloatingSurface";
import { ListenTogetherNowPlayingCard } from "./ListenTogetherNowPlayingCard";
import { useListenTogetherPlaybackState } from "./listen-together-playback";

interface FloatingListenTogetherPlayerProps {
  sfu: SFUClient | null;
  roomSlug?: string | null;
  onOpenQueue?: () => void;
}

/**
 * Now Playing for a listen-together session. Desktop: a resizable card.
 * Phone: a 56px pill above the composer or tab bar; tap for a sheet with
 * seek, volume and the queue. Either can be minimised to the artwork bubble
 * and dragged to any corner.
 */
export function FloatingListenTogetherPlayer({
  sfu,
  roomSlug,
  onOpenQueue,
}: FloatingListenTogetherPlayerProps) {
  // No ticking: the card moves its progress in CSS and ticks its clock in a
  // leaf, so the player itself renders only when the room changes.
  const playback = useListenTogetherPlaybackState(roomSlug);
  const entry = playback.currentEntry;
  if (!entry) return null;

  const artworkUrl = entry.track.artworkUrl;
  const card = (variant: "mini" | "pill" | "panel", className?: string) => (
    <ListenTogetherNowPlayingCard
      playback={playback}
      sfu={sfu}
      roomSlug={roomSlug}
      variant={variant}
      onOpenQueue={onOpenQueue}
      className={className}
    />
  );

  return (
    <FloatingSurface
      id="listen-together"
      label="Now playing"
      testId="floating-listen-together-player"
      width={{ min: 280, max: 440, default: 340 }}
      phoneWidth={300}
      bubble={
        artworkUrl ? (
          <img
            src={artworkUrl}
            alt=""
            className="size-full object-cover"
            draggable={false}
          />
        ) : (
          <Icon name="music" size="lg" />
        )
      }
      compact={card("pill")}
      sheet={card("panel", "pb-2")}
      sheetTitle="Now playing"
    >
      {card("mini")}
    </FloatingSurface>
  );
}
