
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PeerSettings {
  volume: number;
  muted: boolean;
  alwaysHear: boolean;
  attenuationEnabled: boolean;
  attenuationStrength: number;
}

export interface UserSettings {
  inputDeviceId: string;
  outputDeviceId: string;
  videoDeviceId: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  sensitivity: number;
  autoSensitivity: boolean;
  outputVolume: number;
  streamHighFidelity: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  wasMutedBeforeDeafen: boolean;
  alwaysHearScreenShareAudio: boolean;
  lastChannelId: string | null;
  lastServerId: string | null;
  peerSettings: Record<string, PeerSettings>;
}

interface VoiceSettingsState {
  currentUser: string | null;
  // userId -> settings
  userSettings: Record<string, UserSettings>;
  setCurrentUser: (userId: string) => void;
  getSettings: (userId?: string | null) => UserSettings;
  setPeerVolume: (peerId: string, volume: number) => void;
  setPeerMuted: (peerId: string, muted: boolean) => void;
  setPeerAlwaysHear: (peerId: string, alwaysHear: boolean) => void;
  setPeerAttenuation: (peerId: string, enabled: boolean) => void;
  setPeerAttenuationStrength: (peerId: string, strength: number) => void;

  // Global actions
  setIsMuted: (muted: boolean) => void;
  setIsDeafened: (deafened: boolean) => void;
  setDevice: (kind: 'input' | 'output' | 'video', deviceId: string, userId?: string) => void;
  updateUserSettings: (updater: (s: UserSettings) => UserSettings, userId?: string) => void;
}

const defaultSettings: UserSettings = {
  inputDeviceId: "default",
  outputDeviceId: "default",
  videoDeviceId: "default",
  noiseSuppression: true,
  echoCancellation: true,
  sensitivity: -50,
  autoSensitivity: true,
  outputVolume: 100,
  streamHighFidelity: false,
  isMuted: false,
  isDeafened: false,
  wasMutedBeforeDeafen: false,
  alwaysHearScreenShareAudio: false,
  lastChannelId: null,
  lastServerId: null,
  peerSettings: {},
};

const defaultPeerSettings: PeerSettings = {
  volume: 100,
  muted: false,
  alwaysHear: false,
  attenuationEnabled: false,
  attenuationStrength: 50,
};

export const useVoiceSettingsStore = create<VoiceSettingsState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      userSettings: {},
      setCurrentUser: (userId) => set({ currentUser: userId }),
      getSettings: (userId) => {
        const uid = userId || get().currentUser;
        if (!uid) return defaultSettings;
        return get().userSettings[uid] || defaultSettings;
      },

      updateUserSettings: (updater: (s: UserSettings) => UserSettings, userId?: string) => {
        const uid = userId ?? get().currentUser;
        if (!uid) return;
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: updater(state.userSettings[uid] || { ...defaultSettings })
          }
        }));
      },

      setPeerVolume: (peerId, volume) => {
        const uid = get().currentUser;
        if (!uid) return;
        const current = get().getSettings(uid);
        const peer = current.peerSettings[peerId] || { ...defaultPeerSettings };
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: {
              ...current,
              peerSettings: {
                ...current.peerSettings,
                [peerId]: { ...peer, volume }
              }
            }
          }
        }));
      },

      setPeerMuted: (peerId, muted) => {
        const uid = get().currentUser;
        if (!uid) return;
        const current = get().getSettings(uid);
        const peer = current.peerSettings[peerId] || { ...defaultPeerSettings };
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: {
              ...current,
              peerSettings: {
                ...current.peerSettings,
                [peerId]: { ...peer, muted }
              }
            }
          }
        }));
      },

      setPeerAlwaysHear: (peerId, alwaysHear) => {
        const uid = get().currentUser;
        if (!uid) return;
        const current = get().getSettings(uid);
        const peer = current.peerSettings[peerId] || { ...defaultPeerSettings };
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: {
              ...current,
              peerSettings: {
                ...current.peerSettings,
                [peerId]: { ...peer, alwaysHear }
              }
            }
          }
        }));
      },

      setPeerAttenuation: (peerId, enabled) => {
        const uid = get().currentUser;
        if (!uid) return;
        const current = get().getSettings(uid);
        const peer = current.peerSettings[peerId] || { ...defaultPeerSettings };
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: {
              ...current,
              peerSettings: {
                ...current.peerSettings,
                [peerId]: { ...peer, attenuationEnabled: enabled }
              }
            }
          }
        }));
      },

      setPeerAttenuationStrength: (peerId, strength) => {
        const uid = get().currentUser;
        if (!uid) return;
        const current = get().getSettings(uid);
        const peer = current.peerSettings[peerId] || { ...defaultPeerSettings };
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: {
              ...current,
              peerSettings: {
                ...current.peerSettings,
                [peerId]: { ...peer, attenuationStrength: strength }
              }
            }
          }
        }));
      },

      setIsMuted: (isMuted) => {
        const uid = get().currentUser;
        if (!uid) return;
        const current = get().getSettings(uid);

        // If we are deafened and we unmute, we MUST undeafen too
        let nextDeaf = current.isDeafened;
        if (!isMuted && current.isDeafened) {
          nextDeaf = false;
        }

        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: {
              ...current,
              isMuted,
              isDeafened: nextDeaf,
              // If we are NOT currently deafened, any mute toggle is "manual" and should be remembered
              wasMutedBeforeDeafen: !nextDeaf ? isMuted : current.wasMutedBeforeDeafen
            }
          }
        }));
      },

      setIsDeafened: (isDeafened) => {
        const uid = get().currentUser;
        if (!uid) return;
        const current = get().getSettings(uid);

        if (isDeafened) {
          // Deafening: remember if we were muted, then mute and deafen
          set((state) => ({
            userSettings: {
              ...state.userSettings,
              [uid]: {
                ...current,
                isDeafened: true,
                isMuted: true,
                wasMutedBeforeDeafen: current.isMuted
              }
            }
          }));
        } else {
          // Undeafening: restore from memory
          set((state) => ({
            userSettings: {
              ...state.userSettings,
              [uid]: {
                ...current,
                isDeafened: false,
                isMuted: current.wasMutedBeforeDeafen
              }
            }
          }));
        }
      },

      setDevice: (kind, deviceId, userId) => {
        const uid = userId ?? get().currentUser;
        if (!uid) return;
        const current = get().getSettings(uid);
        const key = kind === 'input' ? 'inputDeviceId' : kind === 'output' ? 'outputDeviceId' : 'videoDeviceId';
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: { ...current, [key]: deviceId }
          }
        }));
      },
    }),
    {
      name: "voice-settings-storage",
      version: 1,
      migrate: (persisted: any, version: number) => {
        if (version === 0 || version === undefined) {
          // Fix contradictory defaults: if streamHighFidelity is on,
          // all audio processing must be off.
          const state = persisted as VoiceSettingsState;
          if (state?.userSettings) {
            for (const uid of Object.keys(state.userSettings)) {
              const s = state.userSettings[uid];
              if (s?.streamHighFidelity) {
                s.noiseSuppression = false;
                s.echoCancellation = false;
                s.autoSensitivity = false;
              }
            }
          }
        }
        return persisted;
      },
    }
  )
);
