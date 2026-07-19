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
import { useCallback, useSyncExternalStore } from "react";

interface ListenTogetherRoomClock {
  nowMs: number;
  listeners: Set<() => void>;
  interval: number | null;
}

const roomClocks = new Map<string, ListenTogetherRoomClock>();

function getRoomClock(roomSlug: string) {
  let clock = roomClocks.get(roomSlug);
  if (!clock) {
    clock = { nowMs: Date.now(), listeners: new Set(), interval: null };
    roomClocks.set(roomSlug, clock);
  }
  return clock;
}

function subscribeToRoomClock(roomSlug: string, listener: () => void) {
  const clock = getRoomClock(roomSlug);
  clock.listeners.add(listener);
  if (clock.interval === null) {
    clock.interval = window.setInterval(() => {
      clock.nowMs = Date.now();
      for (const subscriber of clock.listeners) subscriber();
    }, 250);
  }

  return () => {
    clock.listeners.delete(listener);
    if (clock.listeners.size > 0) return;
    if (clock.interval !== null) window.clearInterval(clock.interval);
    clock.interval = null;
    roomClocks.delete(roomSlug);
  };
}

function useListenTogetherRoomClock(
  roomSlug: string | null | undefined,
  enabled: boolean,
) {
  const subscribe = useCallback(
    (listener: () => void) =>
      roomSlug && enabled ? subscribeToRoomClock(roomSlug, listener) : () => {},
    [enabled, roomSlug],
  );
  const getSnapshot = useCallback(
    () => (roomSlug && enabled ? getRoomClock(roomSlug).nowMs : 0),
    [enabled, roomSlug],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}

export interface ListenTogetherPlaybackState {
  currentEntry: ListenTogetherQueueEntry | null;
  durationMs: number;
  effectiveSeekValue: number;
  error: ListenTogetherRoomState["error"];
  isPaused: boolean;
  localPlayback: ListenTogetherRoomState["localPlayback"];
  localVolume: number;
  loudnessEnabled: boolean;
  loudnessPreset: ListenTogetherLoudnessPreset;
  progressMax: number;
  setLocalVolume: (roomSlug: string, volume: number) => void;
  setLocalPlayback: (
    roomSlug: string,
    playback: ListenTogetherRoomState["localPlayback"],
  ) => void;
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
    roomSlug ? (state.rooms[roomSlug]?.snapshot ?? null) : null,
  );
  const localVolume = useListenTogetherStore((state) =>
    roomSlug ? (state.rooms[roomSlug]?.localVolume ?? 1) : 1,
  );
  const error = useListenTogetherStore((state) =>
    roomSlug ? (state.rooms[roomSlug]?.error ?? null) : null,
  );
  const localPlayback = useListenTogetherStore((state) =>
    roomSlug ? (state.rooms[roomSlug]?.localPlayback ?? null) : null,
  );
  const setLocalVolume = useListenTogetherStore(
    (state) => state.setLocalVolume,
  );
  const setLocalPlayback = useListenTogetherStore(
    (state) => state.setLocalPlayback,
  );
  const loudnessEnabled = useListenTogetherAudioSettingsStore(
    (state) => state.enabled,
  );
  const loudnessPreset = useListenTogetherAudioSettingsStore(
    (state) => state.preset,
  );
  const updateLoudnessSettings = useListenTogetherAudioSettingsStore(
    (state) => state.updateSettings,
  );
  const isSeekOverride = localPlayback?.source === "seek";
  const isPaused = isSeekOverride
    ? (snapshot?.paused ?? true)
    : (localPlayback?.paused ?? snapshot?.paused ?? true);
  const playbackNowMs = useListenTogetherRoomClock(
    roomSlug,
    !!snapshot?.currentEntry && !isPaused,
  );

  const currentEntry = snapshot?.currentEntry ?? null;
  const durationMs = snapshot?.durationMs ?? 0;
  const effectiveSeekValue = isSeekOverride
    ? clampListenTogetherPosition(localPlayback.positionMs, durationMs)
    : localPlayback?.paused
      ? clampListenTogetherPosition(localPlayback.positionMs, durationMs)
      : snapshot
        ? clampListenTogetherPosition(
            Math.max(
              snapshot.positionMs,
              getListenTogetherPositionMs(
                snapshot,
                durationMs,
                playbackNowMs || snapshot.anchorUpdatedAt || 0,
              ),
            ),
            durationMs,
          )
        : 0;

  return {
    currentEntry,
    durationMs,
    effectiveSeekValue,
    error,
    isPaused,
    localPlayback,
    localVolume,
    loudnessEnabled,
    loudnessPreset,
    progressMax: Math.max(1, durationMs),
    setLocalVolume,
    setLocalPlayback,
    updateLoudnessSettings,
    snapshot,
  };
}
