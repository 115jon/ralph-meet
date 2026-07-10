import {
  clampListenTogetherPosition,
  getListenTogetherPositionMs,
  type ListenTogetherQueueEntry,
  type ListenTogetherStateSnapshot,
} from "@/lib/listen-together";
import {
  type ListenTogetherRoomState,
  useListenTogetherStore,
} from "@/stores/useListenTogetherStore";
import type { ListenTogetherLoudnessPreset } from "@/lib/voice/listen-together-audio";
import { useListenTogetherAudioSettingsStore } from "@/stores/useListenTogetherAudioSettingsStore";
import { useEffect, useState } from "react";

export interface ListenTogetherPlaybackState {
  currentEntry: ListenTogetherQueueEntry | null;
  durationMs: number;
  effectiveSeekValue: number;
  error: ListenTogetherRoomState["error"];
  localVolume: number;
  loudnessEnabled: boolean;
  loudnessPreset: ListenTogetherLoudnessPreset;
  progressMax: number;
  setLocalVolume: (roomSlug: string, volume: number) => void;
  updateLoudnessSettings: (updates: {
    enabled?: boolean;
    preset?: ListenTogetherLoudnessPreset;
  }) => void;
  snapshot: ListenTogetherStateSnapshot | null;
}

export function formatListenTogetherDuration(durationMs?: number | null) {
  if (!durationMs || durationMs <= 0) return "--:--";
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function useListenTogetherPlaybackState(
  roomSlug?: string | null,
): ListenTogetherPlaybackState {
  const snapshot = useListenTogetherStore((state) =>
    roomSlug ? state.rooms[roomSlug]?.snapshot ?? null : null,
  );
  const localVolume = useListenTogetherStore((state) =>
    roomSlug ? state.rooms[roomSlug]?.localVolume ?? 1 : 1,
  );
  const error = useListenTogetherStore((state) =>
    roomSlug ? state.rooms[roomSlug]?.error ?? null : null,
  );
  const setLocalVolume = useListenTogetherStore((state) => state.setLocalVolume);
  const loudnessEnabled = useListenTogetherAudioSettingsStore((state) => state.enabled);
  const loudnessPreset = useListenTogetherAudioSettingsStore((state) => state.preset);
  const updateLoudnessSettings = useListenTogetherAudioSettingsStore((state) => state.updateSettings);
  const [playbackNowMs, setPlaybackNowMs] = useState(0);

  useEffect(() => {
    if (!snapshot?.currentEntry || snapshot.paused) return;

    const interval = window.setInterval(() => {
      setPlaybackNowMs(Date.now());
    }, 250);

    return () => {
      window.clearInterval(interval);
    };
  }, [snapshot?.currentEntry, snapshot?.paused]);

  const currentEntry = snapshot?.currentEntry ?? null;
  const durationMs = snapshot?.durationMs ?? currentEntry?.track.durationMs ?? 0;
  const effectiveSeekValue = snapshot
    ? clampListenTogetherPosition(
      Math.max(
        snapshot.positionMs,
        getListenTogetherPositionMs(snapshot, durationMs, playbackNowMs || snapshot.anchorUpdatedAt || 0),
      ),
      durationMs,
    )
    : 0;

  return {
    currentEntry,
    durationMs,
    effectiveSeekValue,
    error,
    localVolume,
    loudnessEnabled,
    loudnessPreset,
    progressMax: Math.max(1, durationMs),
    setLocalVolume,
    updateLoudnessSettings,
    snapshot,
  };
}
