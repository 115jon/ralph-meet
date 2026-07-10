import type { ListenTogetherStateSnapshot } from "@/lib/listen-together";
import { create } from "zustand";

export interface ListenTogetherRoomState {
  snapshot: ListenTogetherStateSnapshot | null;
  localVolume: number;
  error: {
    code: string;
    message: string;
  } | null;
}

interface ListenTogetherStoreState {
  rooms: Record<string, ListenTogetherRoomState>;
  ensureRoom: (roomSlug: string) => void;
  setSnapshot: (
    roomSlug: string,
    snapshot: ListenTogetherStateSnapshot,
  ) => void;
  setLocalVolume: (roomSlug: string, volume: number) => void;
  setError: (roomSlug: string, error: ListenTogetherRoomState["error"]) => void;
  clearRoom: (roomSlug: string) => void;
}

const DEFAULT_ROOM_STATE: ListenTogetherRoomState = {
  snapshot: null,
  localVolume: 1,
  error: null,
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

export const useListenTogetherStore = create<ListenTogetherStoreState>()(
  (set) => ({
    rooms: {},
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
      set((state) => ({
        rooms: {
          ...state.rooms,
          [roomSlug]: {
            ...(state.rooms[roomSlug] ?? DEFAULT_ROOM_STATE),
            snapshot,
            error: null,
          },
        },
      })),
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
    setError: (roomSlug, error) =>
      set((state) => ({
        rooms: {
          ...state.rooms,
          [roomSlug]: {
            ...(state.rooms[roomSlug] ?? DEFAULT_ROOM_STATE),
            error,
          },
        },
      })),
    clearRoom: (roomSlug) =>
      set((state) => {
        if (!state.rooms[roomSlug]) return state;
        const rooms = { ...state.rooms };
        delete rooms[roomSlug];
        return { rooms };
      }),
  }),
);
