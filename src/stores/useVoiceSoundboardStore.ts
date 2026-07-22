import { create } from "zustand";

export interface SoundboardPlaybackState {
  playbackId: string;
  ownerId: string;
  serverKey: string;
  name: string;
  isLocal: boolean;
  startedAt: number;
  paused: boolean;
  volume: number;
}

export interface VoiceSoundboardStore {
  activePlaybacks: Record<string, SoundboardPlaybackState>;
  serverMutedByServer: Record<string, Record<string, boolean>>;
  upsertPlayback: (playback: SoundboardPlaybackState) => void;
  removePlayback: (playbackId: string, serverKey?: string) => void;
  clearServerPlaybacks: (serverKey: string) => void;
  setPlaybackPaused: (
    playbackId: string,
    paused: boolean,
    serverKey?: string,
  ) => void;
  setPlaybackVolume: (
    playbackId: string,
    volume: number,
    serverKey?: string,
  ) => void;
  setServerSoundboardMuted: (
    serverKey: string,
    userId: string,
    muted: boolean,
  ) => void;
}

function findPlaybackKey(
  activePlaybacks: VoiceSoundboardStore["activePlaybacks"],
  playbackId: string,
  serverKey?: string,
): string | null {
  if (!serverKey) return activePlaybacks[playbackId] ? playbackId : null;

  const scopedKey = `${serverKey}::${playbackId}`;
  if (activePlaybacks[scopedKey]) return scopedKey;
  return activePlaybacks[playbackId]?.serverKey === serverKey
    ? playbackId
    : null;
}

export const useVoiceSoundboardStore = create<VoiceSoundboardStore>()(
  (set) => ({
    activePlaybacks: {},
    serverMutedByServer: {},
    upsertPlayback: (playback) =>
      set((state) => {
        const scopedKey = `${playback.serverKey}::${playback.playbackId}`;
        const existingPrimary = state.activePlaybacks[playback.playbackId];
        const key = state.activePlaybacks[scopedKey]
          ? scopedKey
          : !existingPrimary || existingPrimary.serverKey === playback.serverKey
            ? playback.playbackId
            : scopedKey;
        return {
          activePlaybacks: {
            ...state.activePlaybacks,
            [key]: playback,
          },
        };
      }),
    removePlayback: (playbackId, serverKey) =>
      set((state) => {
        const key = findPlaybackKey(
          state.activePlaybacks,
          playbackId,
          serverKey,
        );
        if (!key) return state;
        const next = { ...state.activePlaybacks };
        delete next[key];
        return { activePlaybacks: next };
      }),
    clearServerPlaybacks: (serverKey) =>
      set((state) => ({
        activePlaybacks: Object.fromEntries(
          Object.entries(state.activePlaybacks).filter(
            ([, playback]) => playback.serverKey !== serverKey,
          ),
        ),
      })),
    setPlaybackPaused: (playbackId, paused, serverKey) =>
      set((state) => {
        const key = findPlaybackKey(
          state.activePlaybacks,
          playbackId,
          serverKey,
        );
        const playback = key ? state.activePlaybacks[key] : undefined;
        if (!key || !playback || playback.paused === paused) return state;
        return {
          activePlaybacks: {
            ...state.activePlaybacks,
            [key]: { ...playback, paused },
          },
        };
      }),
    setPlaybackVolume: (playbackId, volume, serverKey) =>
      set((state) => {
        const key = findPlaybackKey(
          state.activePlaybacks,
          playbackId,
          serverKey,
        );
        const playback = key ? state.activePlaybacks[key] : undefined;
        if (!key || !playback || playback.volume === volume) return state;
        return {
          activePlaybacks: {
            ...state.activePlaybacks,
            [key]: { ...playback, volume },
          },
        };
      }),
    setServerSoundboardMuted: (serverKey, userId, muted) =>
      set((state) => ({
        serverMutedByServer: {
          ...state.serverMutedByServer,
          [serverKey]: {
            ...(state.serverMutedByServer[serverKey] ?? {}),
            [userId]: muted,
          },
        },
      })),
  }),
);
