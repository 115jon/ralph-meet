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
import { useAppActive } from "@/hooks/useAppActive";
import { useListenTogetherAudioSettingsStore } from "@/stores/useListenTogetherAudioSettingsStore";
import { type RefObject, useEffect, useState } from "react";

/* ------------------------------------------------------------------ */
/* Position: pure functions over the playback state                     */
/* ------------------------------------------------------------------ */

/** The fields the position math needs (tests may build them by hand). */
export type ListenTogetherPositionSource = Pick<
  ListenTogetherPlaybackState,
  "snapshot" | "localPlayback" | "durationMs"
>;

/**
 * Where the shared track is at `now`. A local seek preview or a local pause
 * pins it; otherwise it runs from the room's anchor.
 */
export function getListenTogetherLivePositionMs(
  { snapshot, localPlayback, durationMs }: ListenTogetherPositionSource,
  now: number,
): number {
  if (
    localPlayback &&
    (localPlayback.source === "seek" || localPlayback.paused)
  ) {
    return clampListenTogetherPosition(localPlayback.positionMs, durationMs);
  }
  if (!snapshot) return 0;
  return clampListenTogetherPosition(
    Math.max(
      snapshot.positionMs,
      getListenTogetherPositionMs(
        snapshot,
        durationMs,
        now || snapshot.anchorUpdatedAt || 0,
      ),
    ),
    durationMs,
  );
}

/** Whether the position advances on its own right now. */
export function isListenTogetherProgressRunning({
  snapshot,
  localPlayback,
  durationMs,
}: ListenTogetherPositionSource): boolean {
  return (
    !!snapshot?.currentEntry &&
    !snapshot.paused &&
    durationMs > 0 &&
    localPlayback?.source !== "seek" &&
    !localPlayback?.paused
  );
}

/**
 * Changes whenever the position jumps (seek, pause, resume, next track) and
 * never while it just runs. CSS progress re-keys on it.
 */
export function getListenTogetherProgressKey(
  source: ListenTogetherPositionSource,
): string {
  const { snapshot, durationMs } = source;
  const entryId = snapshot?.currentEntry?.entryId ?? "none";
  if (isListenTogetherProgressRunning(source) && snapshot) {
    return `${entryId}|run|${snapshot.anchorPositionMs}@${snapshot.anchorUpdatedAt}|${snapshot.positionMs}|${durationMs}`;
  }
  // Not running: the position doesn't depend on the time.
  return `${entryId}|hold|${getListenTogetherLivePositionMs(source, 0)}|${durationMs}`;
}

/**
 * Re-renders its caller once per second of track time while the track runs,
 * the app is active and `target` is on screen, aligned so the label flips on
 * the second. Returns the time to compute the position at.
 */
export function useListenTogetherClockNow(
  source: ListenTogetherPositionSource,
  target?: RefObject<Element | null>,
): number {
  const running = isListenTogetherProgressRunning(source);
  const active = useAppActive();
  const visible = useOnScreen(target);
  const anchor = source.snapshot
    ? source.snapshot.anchorPositionMs - (source.snapshot.anchorUpdatedAt ?? 0)
    : 0;
  const phase = ((anchor % 1000) + 1000) % 1000;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running || !active || !visible) return;
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const intoSecond = (((current + phase) % 1000) + 1000) % 1000;
      id = setTimeout(tick, 1000 - intoSecond);
    };
    tick();
    return () => clearTimeout(id);
  }, [running, active, visible, phase]);

  return now;
}

/** True unless `target` is known to be scrolled or collapsed out of view. */
function useOnScreen(target?: RefObject<Element | null>) {
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = target?.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setOnScreen(entry.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);
  return onScreen;
}

/* ------------------------------------------------------------------ */
/* The hook                                                             */
/* ------------------------------------------------------------------ */

export interface ListenTogetherPlaybackState {
  currentEntry: ListenTogetherQueueEntry | null;
  durationMs: number;
  /**
   * The position at the room's last anchor, not a live value. Views read the
   * position through ListenTogetherProgress / useListenTogetherClockNow, and
   * handlers through getListenTogetherLivePositionMs(state, Date.now()).
   */
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
  const currentEntry = snapshot?.currentEntry ?? null;
  const durationMs = snapshot?.durationMs ?? 0;
  const effectiveSeekValue = getListenTogetherLivePositionMs(
    { snapshot, localPlayback, durationMs },
    0,
  );

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
