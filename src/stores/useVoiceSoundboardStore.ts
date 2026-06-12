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

interface VoiceSoundboardStore {
  activePlaybacks: Record<string, SoundboardPlaybackState>;
  serverMutedByServer: Record<string, Record<string, boolean>>;
  upsertPlayback: (playback: SoundboardPlaybackState) => void;
  removePlayback: (playbackId: string) => void;
  clearServerPlaybacks: (serverKey: string) => void;
  setPlaybackPaused: (playbackId: string, paused: boolean) => void;
  setPlaybackVolume: (playbackId: string, volume: number) => void;
  setServerSoundboardMuted: (serverKey: string, userId: string, muted: boolean) => void;
}

export const useVoiceSoundboardStore = create<VoiceSoundboardStore>()((set) => ({
  activePlaybacks: {},
  serverMutedByServer: {},
  upsertPlayback: (playback) =>
    set((state) => ({
      activePlaybacks: {
        ...state.activePlaybacks,
        [playback.playbackId]: playback,
      },
    })),
  removePlayback: (playbackId) =>
    set((state) => {
      if (!state.activePlaybacks[playbackId]) return state;
      const next = { ...state.activePlaybacks };
      delete next[playbackId];
      return { activePlaybacks: next };
    }),
  clearServerPlaybacks: (serverKey) =>
    set((state) => ({
      activePlaybacks: Object.fromEntries(
        Object.entries(state.activePlaybacks).filter(([, playback]) => playback.serverKey !== serverKey),
      ),
    })),
  setPlaybackPaused: (playbackId, paused) =>
    set((state) => {
      const playback = state.activePlaybacks[playbackId];
      if (!playback || playback.paused === paused) return state;
      return {
        activePlaybacks: {
          ...state.activePlaybacks,
          [playbackId]: { ...playback, paused },
        },
      };
    }),
  setPlaybackVolume: (playbackId, volume) =>
    set((state) => {
      const playback = state.activePlaybacks[playbackId];
      if (!playback || playback.volume === volume) return state;
      return {
        activePlaybacks: {
          ...state.activePlaybacks,
          [playbackId]: { ...playback, volume },
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
}));
