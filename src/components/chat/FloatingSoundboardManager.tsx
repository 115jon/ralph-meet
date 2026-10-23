import { Icon } from "@/components/ui/icon";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SFUClient } from "@/lib/sfu-client";
import { getSoundboardServerKey } from "@/lib/voice/soundboard";
import { useVoiceSoundboardStore } from "@/stores/useVoiceSoundboardStore";
import { useMemo } from "react";

import { SoundboardPlaybackRow } from "./ActiveSoundboardEffectList";
import { FloatingSurface } from "./floating/FloatingSurface";

interface FloatingSoundboardManagerProps {
  serverId?: string | null;
  serverKey?: string;
  localUserId?: string | null;
  sfu: SFUClient | null;
}

/**
 * Your sounds that are playing right now, with pause, volume and stop.
 * Desktop: a resizable panel (top right by default). Phone: a pill naming
 * how many play; tap for a sheet with the rows. Minimises to a bubble.
 */
export function FloatingSoundboardManager({
  serverId,
  serverKey: explicitServerKey,
  localUserId,
  sfu,
}: FloatingSoundboardManagerProps) {
  const activePlaybacks = useVoiceSoundboardStore(
    (state) => state.activePlaybacks,
  );
  const serverKey = explicitServerKey ?? getSoundboardServerKey(serverId);

  const scopedPlaybacks = useMemo(
    () =>
      Object.values(activePlaybacks)
        .filter(
          (playback) =>
            playback.serverKey === serverKey &&
            playback.ownerId === localUserId,
        )
        .sort((a, b) => b.startedAt - a.startedAt),
    [activePlaybacks, localUserId, serverKey],
  );

  if (scopedPlaybacks.length === 0) return null;

  const count = scopedPlaybacks.length;
  const rows = (
    <div className="flex flex-col gap-2">
      {scopedPlaybacks.map((playback) => (
        <SoundboardPlaybackRow
          key={playback.playbackId}
          playback={playback}
          localUserId={localUserId}
          serverKey={serverKey}
          sfu={sfu}
          variant="floating"
        />
      ))}
    </div>
  );

  return (
    <TooltipProvider delayDuration={100}>
      <FloatingSurface
        id="soundboard"
        label="Soundboard manager"
        title="Soundboard"
        testId="floating-soundboard-manager"
        defaultCorner="top-right"
        width={{ min: 280, max: 440, default: 340 }}
        phoneWidth={220}
        minimizeLabel="Collapse soundboard manager"
        restoreLabel="Open soundboard manager"
        bubble={
          <>
            <Icon name="soundboard" size="lg" />
            <span className="badge-count absolute top-0.5 right-0.5">
              {count}
            </span>
          </>
        }
        compact={
          <div className="flex h-12 items-center gap-2.5 px-3">
            <Icon name="soundboard" size="md" className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-ui-sm font-semibold">
              Soundboard
            </span>
            <span className="shrink-0 text-ui-xs text-rm-text-secondary">
              {count} playing
            </span>
          </div>
        }
        sheetTitle="Soundboard"
        sheetDescription={`${count} ${count === 1 ? "sound" : "sounds"} playing`}
        sheet={rows}
      >
        <div className="max-h-[min(360px,calc(100dvh-160px))] overflow-y-auto overscroll-contain p-2.5">
          {rows}
        </div>
      </FloatingSurface>
    </TooltipProvider>
  );
}
