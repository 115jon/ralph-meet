import { Icon } from "@/components/ui/icon";
import { Num } from "@/components/ui/num";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SFUClient } from "@/lib/sfu-client";
import {
  getSoundboardMasterVolume,
  getSoundboardServerKey,
  setSoundboardMasterVolume,
} from "@/lib/voice/soundboard";
import { useSoundSettingsStore } from "@/stores/useSoundSettingsStore";
import { useVoiceSoundboardStore } from "@/stores/useVoiceSoundboardStore";
import { useEffect, useMemo, useRef, useState } from "react";

import { SoundboardPlaybackRow } from "./ActiveSoundboardEffectList";
import { FloatingSurface } from "./floating/FloatingSurface";
import { RangeSlider } from "./floating/RangeSlider";

interface FloatingSoundboardManagerProps {
  serverId?: string | null;
  serverKey?: string;
  localUserId?: string | null;
  sfu: SFUClient | null;
}

/**
 * The soundboard's one master volume (the same setting as the picker's),
 * applied live and saved a beat after the last change.
 */
function useMasterVolume(localUserId?: string | null) {
  const stored = useSoundSettingsStore((state) =>
    localUserId ? state.getSettings(localUserId).soundboardVolume : null,
  );
  const updateSettings = useSoundSettingsStore((state) => state.updateSettings);
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (localUserId && pending.current !== null) {
        updateSettings({ soundboardVolume: pending.current }, localUserId);
      }
    },
    [localUserId, updateSettings],
  );

  const volume =
    draft ?? stored ?? Math.round(getSoundboardMasterVolume() * 100);
  const setVolume = (next: number) => {
    setDraft(next);
    setSoundboardMasterVolume(next / 100);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const value = pending.current;
      pending.current = null;
      if (localUserId && value !== null) {
        updateSettings({ soundboardVolume: value }, localUserId);
      }
      setDraft(null);
    }, 250);
  };
  return [volume, setVolume] as const;
}

/**
 * Your sounds that are playing right now, as a short tracklist: name, who
 * played it, running time, pause and stop; per-sound volume behind each
 * row's expand. One master volume sits in the window header. Desktop: a
 * resizable panel (top right by default, clear of the header). Phone: a pill
 * naming how many play; tap for a sheet with the rows. Minimises to a
 * bubble.
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
  const [masterVolume, setMasterVolume] = useMasterVolume(localUserId);

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
    <div className="flex flex-col gap-0.5">
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
  const master = (className?: string) => (
    <div className={className}>
      <Icon
        name={masterVolume === 0 ? "speakerOff" : "voiceChannel"}
        size="sm"
        className="shrink-0 text-ink-3"
      />
      <RangeSlider
        aria-label="Soundboard volume"
        aria-valuetext={`${masterVolume} percent`}
        value={masterVolume}
        onValueChange={setMasterVolume}
        className="min-w-0 flex-1"
      />
      <Num className="w-9 shrink-0 text-right text-ink-3">{masterVolume}%</Num>
    </div>
  );

  return (
    <TooltipProvider>
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
        headerActions={master("flex w-36 items-center gap-1.5 pr-1")}
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
            <Icon name="soundboard" size="md" className="shrink-0 text-ink-2" />
            <span className="min-w-0 flex-1 truncate text-ui-sm font-semibold text-ink-1">
              Soundboard
            </span>
            <span className="shrink-0 text-ui-xs text-ink-3">
              <Num>{count}</Num> playing
            </span>
          </div>
        }
        sheetTitle="Soundboard"
        sheetDescription={`${count} ${count === 1 ? "sound" : "sounds"} playing`}
        sheet={
          <div className="flex flex-col gap-3">
            {master("flex items-center gap-2 px-2")}
            {rows}
          </div>
        }
      >
        <div className="max-h-[min(360px,calc(100dvh-160px))] overflow-y-auto overscroll-contain p-1.5">
          {rows}
        </div>
      </FloatingSurface>
    </TooltipProvider>
  );
}
