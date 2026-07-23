import {
  LISTEN_TOGETHER_DRIFT_TOLERANCE_MS,
  type ListenTogetherStateSnapshot,
} from "@/lib/listen-together";
import {
  clampListenTogetherPaneRatio,
  readListenTogetherPaneRatio,
  writeListenTogetherPaneRatio,
} from "@/lib/listen-together-local";
import { create } from "zustand";

export type ListenTogetherLocalPlaybackSource = "command" | "native" | "seek";

export interface ListenTogetherPendingPlaybackState {
  paused: boolean;
  positionMs: number;
  snapshotRevision: number;
  sequence: number;
}

export interface ListenTogetherLocalPlayback {
  paused: boolean;
  positionMs: number;
  entryId: string;
  snapshotRevision: number;
  source: ListenTogetherLocalPlaybackSource;
  accepted: boolean;
  pendingStates?: ListenTogetherPendingPlaybackState[];
}

export interface ListenTogetherRoomState {
  snapshot: ListenTogetherStateSnapshot | null;
  localVolume: number;
  localPlayback?: ListenTogetherLocalPlayback | null;
  error: {
    code: string;
    message: string;
  } | null;
  playbackError?: {
    code: string;
    message: string;
  } | null;
  roomError?: {
    code: string;
    message: string;
  } | null;
}

interface ListenTogetherStoreState {
  rooms: Record<string, ListenTogetherRoomState>;
  workspacePaneRatio: number;
  ensureRoom: (roomSlug: string) => void;
  setSnapshot: (
    roomSlug: string,
    snapshot: ListenTogetherStateSnapshot,
  ) => void;
  setLocalPlayback: (
    roomSlug: string,
    playback: ListenTogetherRoomState["localPlayback"],
  ) => void;
  clearLocalPlaybackIfMatches: (
    roomSlug: string,
    expected: ListenTogetherLocalPlayback,
  ) => void;
  setLocalVolume: (roomSlug: string, volume: number) => void;
  setWorkspacePaneRatio: (ratio: number) => void;
  persistWorkspacePaneRatio: (ratio: number) => void;
  setError: (roomSlug: string, error: ListenTogetherRoomState["error"]) => void;
  clearRoomError: (roomSlug: string) => void;
  clearPlaybackError: (roomSlug: string) => void;
  clearRoom: (roomSlug: string) => void;
}

const DEFAULT_ROOM_STATE: ListenTogetherRoomState = {
  snapshot: null,
  localVolume: 1,
  localPlayback: null,
  error: null,
  playbackError: null,
  roomError: null,
};

function getListenTogetherVolumeStorageKey(roomSlug: string) {
  return `listen-together:volume:${roomSlug}`;
}

function readStoredListenTogetherVolume(roomSlug: string) {
  if (typeof window === "undefined") return DEFAULT_ROOM_STATE.localVolume;
  const rawValue = localStorage.getItem(
    getListenTogetherVolumeStorageKey(roomSlug),
  );
  const volume = rawValue ? Number(rawValue) : NaN;
  if (!Number.isFinite(volume)) return DEFAULT_ROOM_STATE.localVolume;
  return Math.max(0, Math.min(1, volume));
}

function writeStoredListenTogetherVolume(roomSlug: string, volume: number) {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    getListenTogetherVolumeStorageKey(roomSlug),
    volume.toString(),
  );
}

function areListenTogetherSnapshotsEqual(
  first: ListenTogetherStateSnapshot,
  second: ListenTogetherStateSnapshot,
  includePosition = true,
) {
  if (
    first.roomSlug !== second.roomSlug ||
    first.revision !== second.revision ||
    first.paused !== second.paused ||
    first.currentEntryId !== second.currentEntryId ||
    first.anchorPositionMs !== second.anchorPositionMs ||
    first.anchorUpdatedAt !== second.anchorUpdatedAt ||
    first.lastUpdatedAt !== second.lastUpdatedAt ||
    (includePosition && first.positionMs !== second.positionMs) ||
    first.durationMs !== second.durationMs ||
    first.queue.length !== second.queue.length ||
    (first.recentlyPlayed?.length ?? 0) !== (second.recentlyPlayed?.length ?? 0)
  ) {
    return false;
  }

  if (
    JSON.stringify(first.currentEntry) !==
      JSON.stringify(second.currentEntry) ||
    JSON.stringify(first.queue) !== JSON.stringify(second.queue) ||
    JSON.stringify(first.recentlyPlayed ?? []) !==
      JSON.stringify(second.recentlyPlayed ?? [])
  ) {
    return false;
  }

  if (
    first.currentEntry?.entryId !== second.currentEntry?.entryId ||
    first.queue.some(
      (entry, index) => entry.entryId !== second.queue[index]?.entryId,
    )
  ) {
    return false;
  }

  return (first.recentlyPlayed ?? []).every(
    (entry, index) =>
      entry.historyId === second.recentlyPlayed?.[index]?.historyId,
  );
}

const LISTEN_TOGETHER_SEEK_CONFIRMATION_TOLERANCE_MS =
  LISTEN_TOGETHER_DRIFT_TOLERANCE_MS;

export const useListenTogetherStore = create<ListenTogetherStoreState>()(
  (set) => ({
    rooms: {},
    workspacePaneRatio: readListenTogetherPaneRatio(),
    ensureRoom: (roomSlug) =>
      set((state) => {
        if (!roomSlug || state.rooms[roomSlug]) return state;
        return {
          rooms: {
            ...state.rooms,
            [roomSlug]: {
              ...DEFAULT_ROOM_STATE,
              localVolume: readStoredListenTogetherVolume(roomSlug),
            },
          },
        };
      }),
    setSnapshot: (roomSlug, snapshot) =>
      set((state) => {
        const currentRoom = state.rooms[roomSlug] ?? DEFAULT_ROOM_STATE;
        const currentSnapshot = currentRoom.snapshot;
        const localPlayback = currentRoom.localPlayback;
        const pendingCommandStates =
          localPlayback?.source === "command"
            ? localPlayback.pendingStates
            : undefined;
        const pendingStates = pendingCommandStates ?? [];
        const matchesSingleOptimisticState =
          localPlayback &&
          localPlayback.entryId === snapshot.currentEntryId &&
          localPlayback.paused === snapshot.paused &&
          pendingStates.length <= 1;
        const matchesSingleOptimisticSnapshot =
          matchesSingleOptimisticState &&
          currentSnapshot !== null &&
          areListenTogetherSnapshotsEqual(
            { ...currentSnapshot, paused: snapshot.paused },
            snapshot,
            false,
          );
        const isRegressingSameRevisionPosition =
          currentSnapshot !== null &&
          snapshot.revision === currentSnapshot.revision &&
          snapshot.anchorPositionMs === currentSnapshot.anchorPositionMs &&
          snapshot.anchorUpdatedAt === currentSnapshot.anchorUpdatedAt &&
          snapshot.lastUpdatedAt === currentSnapshot.lastUpdatedAt &&
          snapshot.positionMs < currentSnapshot.positionMs;
        if (
          currentSnapshot &&
          snapshot.revision === currentSnapshot.revision &&
          !areListenTogetherSnapshotsEqual(currentSnapshot, snapshot, false) &&
          !matchesSingleOptimisticSnapshot
        ) {
          return state;
        }
        if (
          currentSnapshot &&
          (snapshot.revision < currentSnapshot.revision ||
            (snapshot.revision === currentSnapshot.revision &&
              areListenTogetherSnapshotsEqual(currentSnapshot, snapshot)))
        ) {
          if (
            snapshot.revision === currentSnapshot.revision &&
            areListenTogetherSnapshotsEqual(currentSnapshot, snapshot) &&
            currentRoom.error &&
            !currentRoom.error.code.startsWith("PLAYBACK_")
          ) {
            return {
              rooms: {
                ...state.rooms,
                [roomSlug]: {
                  ...currentRoom,
                  error: currentRoom.playbackError ?? null,
                  roomError: null,
                },
              },
            };
          }
          return state;
        }
        if (
          currentSnapshot &&
          snapshot.revision === currentSnapshot.revision &&
          isRegressingSameRevisionPosition
        ) {
          return state;
        }

        const confirmedCommandStateIndex = pendingStates.findLastIndex(
          (pendingState, index) =>
            (snapshot.revision > pendingState.snapshotRevision ||
              (snapshot.revision === pendingState.snapshotRevision &&
                pendingStates.length === 1)) &&
            snapshot.paused === pendingState.paused &&
            (index === 0 ||
              pendingState.snapshotRevision >
                pendingStates[index - 1]!.snapshotRevision),
        );
        if (
          localPlayback &&
          localPlayback.entryId === snapshot.currentEntryId &&
          confirmedCommandStateIndex !== undefined &&
          confirmedCommandStateIndex >= 0
        ) {
          const remainingStates = pendingStates.slice(
            confirmedCommandStateIndex + 1,
          );
          const playbackError =
            currentSnapshot?.currentEntryId === snapshot.currentEntryId
              ? (currentRoom.playbackError ??
                (currentRoom.error?.code.startsWith("PLAYBACK_") &&
                currentSnapshot?.currentEntryId === snapshot.currentEntryId
                  ? currentRoom.error
                  : null))
              : null;
          const nextLocalPlayback = remainingStates.length
            ? {
                ...localPlayback,
                paused: remainingStates.at(-1)!.paused,
                positionMs: remainingStates.at(-1)!.positionMs,
                pendingStates: remainingStates,
              }
            : null;
          return {
            rooms: {
              ...state.rooms,
              [roomSlug]: {
                ...currentRoom,
                snapshot,
                localPlayback: nextLocalPlayback,
                error: playbackError,
                playbackError,
                roomError: null,
              },
            },
          };
        }
        const seekConfirmed =
          localPlayback?.source === "seek" &&
          snapshot.revision >= localPlayback.snapshotRevision &&
          Math.abs(snapshot.anchorPositionMs - localPlayback.positionMs) <=
            LISTEN_TOGETHER_SEEK_CONFIRMATION_TOLERANCE_MS;
        const playbackConfirmed =
          localPlayback?.source !== "seek" &&
          !pendingCommandStates?.length &&
          snapshot.revision >= (localPlayback?.snapshotRevision ?? 0) &&
          localPlayback?.paused === snapshot.paused;
        const nextLocalPlayback =
          localPlayback &&
          localPlayback.entryId === snapshot.currentEntryId &&
          !seekConfirmed &&
          !playbackConfirmed
            ? localPlayback
            : null;
        const playbackError =
          currentSnapshot?.currentEntryId === snapshot.currentEntryId
            ? (currentRoom.playbackError ??
              (currentRoom.error?.code.startsWith("PLAYBACK_")
                ? currentRoom.error
                : null))
            : null;
        return {
          rooms: {
            ...state.rooms,
            [roomSlug]: {
              ...currentRoom,
              snapshot,
              localPlayback: nextLocalPlayback,
              error: playbackError,
              playbackError,
              roomError: null,
            },
          },
        };
      }),
    setLocalPlayback: (roomSlug, playback) =>
      set((state) => {
        const currentRoom = state.rooms[roomSlug] ?? DEFAULT_ROOM_STATE;
        if (
          playback &&
          (currentRoom.snapshot?.currentEntryId !== playback.entryId ||
            (currentRoom.snapshot &&
              playback.snapshotRevision < currentRoom.snapshot.revision))
        ) {
          return state;
        }
        return {
          rooms: {
            ...state.rooms,
            [roomSlug]: {
              ...currentRoom,
              localPlayback: playback,
            },
          },
        };
      }),
    clearLocalPlaybackIfMatches: (roomSlug, expected) =>
      set((state) => {
        const currentRoom = state.rooms[roomSlug] ?? DEFAULT_ROOM_STATE;
        const current = currentRoom.localPlayback;
        if (
          !current ||
          current.entryId !== expected.entryId ||
          current.positionMs !== expected.positionMs ||
          current.paused !== expected.paused ||
          current.snapshotRevision !== expected.snapshotRevision ||
          current.source !== expected.source ||
          current.accepted !== expected.accepted
        ) {
          return state;
        }
        return {
          rooms: {
            ...state.rooms,
            [roomSlug]: {
              ...currentRoom,
              localPlayback: null,
            },
          },
        };
      }),
    setLocalVolume: (roomSlug, volume) =>
      set((state) => {
        const nextVolume = Math.max(0, Math.min(1, volume));
        writeStoredListenTogetherVolume(roomSlug, nextVolume);
        return {
          rooms: {
            ...state.rooms,
            [roomSlug]: {
              ...(state.rooms[roomSlug] ?? DEFAULT_ROOM_STATE),
              localVolume: nextVolume,
            },
          },
        };
      }),
    setWorkspacePaneRatio: (ratio) =>
      set({ workspacePaneRatio: clampListenTogetherPaneRatio(ratio) }),
    persistWorkspacePaneRatio: (ratio) => {
      const nextRatio = clampListenTogetherPaneRatio(ratio);
      writeListenTogetherPaneRatio(nextRatio);
      set({ workspacePaneRatio: nextRatio });
    },
    setError: (roomSlug, error) =>
      set((state) => {
        const currentRoom = state.rooms[roomSlug] ?? DEFAULT_ROOM_STATE;
        return {
          rooms: {
            ...state.rooms,
            [roomSlug]: {
              ...currentRoom,
              error,
              playbackError: error?.code.startsWith("PLAYBACK_")
                ? error
                : error
                  ? currentRoom.playbackError
                  : null,
              roomError: error?.code.startsWith("PLAYBACK_")
                ? currentRoom.roomError
                : error,
            },
          },
        };
      }),
    clearRoomError: (roomSlug) =>
      set((state) => {
        const currentRoom = state.rooms[roomSlug] ?? DEFAULT_ROOM_STATE;
        return {
          rooms: {
            ...state.rooms,
            [roomSlug]: {
              ...currentRoom,
              error: currentRoom.playbackError ?? null,
              roomError: null,
            },
          },
        };
      }),
    clearPlaybackError: (roomSlug) =>
      set((state) => {
        const currentRoom = state.rooms[roomSlug] ?? DEFAULT_ROOM_STATE;
        return {
          rooms: {
            ...state.rooms,
            [roomSlug]: {
              ...currentRoom,
              error: currentRoom.roomError ?? null,
              playbackError: null,
            },
          },
        };
      }),
    clearRoom: (roomSlug) =>
      set((state) => {
        if (!state.rooms[roomSlug]) return state;
        const rooms = { ...state.rooms };
        delete rooms[roomSlug];
        return { rooms };
      }),
  }),
);
