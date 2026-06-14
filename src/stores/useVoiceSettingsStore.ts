
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PeerSettings {
  volume: number;
  streamVolume: number;
  muted: boolean;
  alwaysHear: boolean;
  attenuationEnabled: boolean;
  attenuationStrength: number;
  soundboardMuted: boolean;
}

export type SpatialPlacementMode = "line" | "arc" | "grid" | "manual";

export interface SpatialPosition {
  x: number;
  y: number;
}

export interface SpatialAudioSettings {
  spatialAudioEnabled: boolean;
  spatialPlacementMode: SpatialPlacementMode;
  spatialRoomSize: number;
  spatialDistance: number;
  spatialArcAngle: number;
  spatialManualPositions: Record<string, SpatialPosition>;
}

export interface UserSettings {
  inputDeviceId: string;
  inputDeviceLabel?: string;
  inputDeviceGroupId?: string;
  outputDeviceId: string;
  outputDeviceLabel?: string;
  outputDeviceGroupId?: string;
  videoDeviceId: string;
  videoDeviceLabel?: string;
  videoDeviceGroupId?: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  sensitivity: number;
  autoSensitivity: boolean;
  outputVolume: number;
  inputVolume: number;
  streamHighFidelity: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  wasMutedBeforeDeafen: boolean;
  alwaysHearScreenShareAudio: boolean;
  lastChannelId: string | null;
  lastServerId: string | null;
  peerSettings: Record<string, PeerSettings>;
  spatialAudioEnabled: boolean;
  spatialPlacementMode: SpatialPlacementMode;
  spatialRoomSize: number;
  spatialDistance: number;
  spatialArcAngle: number;
  spatialManualPositions: Record<string, SpatialPosition>;
}

interface VoiceSettingsState {
  currentUser: string | null;
  // userId -> settings
  userSettings: Record<string, UserSettings>;
  /** @internal Cache for referential stability in selectors */
  _cache: Record<string, UserSettings>;
  setCurrentUser: (userId: string) => void;
  getSettings: (userId?: string | null) => UserSettings;
  setPeerVolume: (peerId: string, volume: number) => void;
  setPeerStreamVolume: (peerId: string, volume: number) => void;
  setPeerMuted: (peerId: string, muted: boolean) => void;
  setPeerAlwaysHear: (peerId: string, alwaysHear: boolean) => void;
  setPeerAttenuation: (peerId: string, enabled: boolean) => void;
  setPeerAttenuationStrength: (peerId: string, strength: number) => void;
  setPeerSoundboardMuted: (peerId: string, muted: boolean) => void;
  updateSpatialSettings: (updater: (s: SpatialAudioSettings) => SpatialAudioSettings, userId?: string) => void;
  setSpatialManualPosition: (peerId: string, position: SpatialPosition, userId?: string) => void;
  resetSpatialSettings: (userId?: string) => void;

  // Global actions
  setIsMuted: (muted: boolean) => void;
  setIsDeafened: (deafened: boolean) => void;
  setDevice: (
    kind: 'input' | 'output' | 'video',
    deviceId: string,
    userId?: string,
    meta?: { label?: string; groupId?: string }
  ) => void;
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
  inputVolume: 100,
  streamHighFidelity: false,
  isMuted: false,
  isDeafened: false,
  wasMutedBeforeDeafen: false,
  alwaysHearScreenShareAudio: false,
  lastChannelId: null,
  lastServerId: null,
  peerSettings: {},
  spatialAudioEnabled: false,
  spatialPlacementMode: "arc",
  spatialRoomSize: 40,
  spatialDistance: 55,
  spatialArcAngle: 120,
  spatialManualPositions: {},
};

const defaultSpatialSettings: SpatialAudioSettings = {
  spatialAudioEnabled: defaultSettings.spatialAudioEnabled,
  spatialPlacementMode: defaultSettings.spatialPlacementMode,
  spatialRoomSize: defaultSettings.spatialRoomSize,
  spatialDistance: defaultSettings.spatialDistance,
  spatialArcAngle: defaultSettings.spatialArcAngle,
  spatialManualPositions: defaultSettings.spatialManualPositions,
};

const defaultPeerSettings: PeerSettings = {
  volume: 100,
  streamVolume: 100,
  muted: false,
  alwaysHear: false,
  attenuationEnabled: false,
  attenuationStrength: 50,
  soundboardMuted: false,
};

export function normalizePeerSettings(peer?: Partial<PeerSettings>): PeerSettings {
  const volume = typeof peer?.volume === "number" ? peer.volume : defaultPeerSettings.volume;
  return {
    ...defaultPeerSettings,
    ...peer,
    volume,
    streamVolume: typeof peer?.streamVolume === "number" ? peer.streamVolume : volume,
  };
}

const ROOM_GUEST_SETTINGS_USER_ID = "room-guest";

function migrateRoomScopedSettings(state: VoiceSettingsState): void {
  if (!state?.userSettings) return;

  const roomKeys = Object.keys(state.userSettings).filter(
    (uid) => uid.startsWith("room-") && uid !== ROOM_GUEST_SETTINGS_USER_ID
  );
  if (roomKeys.length === 0) return;

  if (!state.userSettings[ROOM_GUEST_SETTINGS_USER_ID]) {
    state.userSettings[ROOM_GUEST_SETTINGS_USER_ID] = state.userSettings[roomKeys[0]];
  }

  for (const uid of roomKeys) {
    delete state.userSettings[uid];
  }

  if (state.currentUser?.startsWith("room-")) {
    state.currentUser = ROOM_GUEST_SETTINGS_USER_ID;
  }
}

export const useVoiceSettingsStore = create<VoiceSettingsState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      userSettings: {},
      _cache: {},
      setCurrentUser: (userId) => set({ currentUser: userId }),
      getSettings: (userId) => {
        const uid = userId || get().currentUser;
        if (!uid) return defaultSettings;
        const raw = get().userSettings[uid];
        if (!raw) return defaultSettings;
        // Return cached merged object if underlying raw data hasn't changed
        const cached = get()._cache[uid];
        if (cached && (cached as any).__raw === raw) return cached;
        // Merge with defaults so missing fields (from older stored versions
        // or partially-initialised entries) are always filled in.
        const peerSettings = Object.fromEntries(
          Object.entries(raw.peerSettings ?? {}).map(([peerId, peer]) => [
            peerId,
            normalizePeerSettings(peer as Partial<PeerSettings>),
          ])
        );
        const merged = { ...defaultSettings, ...raw, peerSettings };
        // Tag the merged object with the raw reference for identity checking
        Object.defineProperty(merged, '__raw', { value: raw, enumerable: false });
        get()._cache[uid] = merged;
        return merged;
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
        const peer = normalizePeerSettings(current.peerSettings[peerId]);
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

      setPeerStreamVolume: (peerId, streamVolume) => {
        const uid = get().currentUser;
        if (!uid) return;
        const current = get().getSettings(uid);
        const peer = normalizePeerSettings(current.peerSettings[peerId]);
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: {
              ...current,
              peerSettings: {
                ...current.peerSettings,
                [peerId]: { ...peer, streamVolume }
              }
            }
          }
        }));
      },

      setPeerMuted: (peerId, muted) => {
        const uid = get().currentUser;
        if (!uid) return;
        const current = get().getSettings(uid);
        const peer = normalizePeerSettings(current.peerSettings[peerId]);
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
        const peer = normalizePeerSettings(current.peerSettings[peerId]);
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
        const peer = normalizePeerSettings(current.peerSettings[peerId]);
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
        const peer = normalizePeerSettings(current.peerSettings[peerId]);
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

      setPeerSoundboardMuted: (peerId, soundboardMuted) => {
        const uid = get().currentUser;
        if (!uid) return;
        const current = get().getSettings(uid);
        const peer = normalizePeerSettings(current.peerSettings[peerId]);
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: {
              ...current,
              peerSettings: {
                ...current.peerSettings,
                [peerId]: { ...peer, soundboardMuted }
              }
            }
          }
        }));
      },

      updateSpatialSettings: (updater, userId) => {
        const uid = userId ?? get().currentUser;
        if (!uid) return;
        const current = get().getSettings(uid);
        const nextSpatial = updater({
          spatialAudioEnabled: current.spatialAudioEnabled,
          spatialPlacementMode: current.spatialPlacementMode,
          spatialRoomSize: current.spatialRoomSize,
          spatialDistance: current.spatialDistance,
          spatialArcAngle: current.spatialArcAngle,
          spatialManualPositions: current.spatialManualPositions,
        });
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: {
              ...current,
              ...nextSpatial,
            },
          },
        }));
      },

      setSpatialManualPosition: (peerId, position, userId) => {
        const uid = userId ?? get().currentUser;
        if (!uid) return;
        const current = get().getSettings(uid);
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: {
              ...current,
              spatialManualPositions: {
                ...current.spatialManualPositions,
                [peerId]: {
                  x: Math.max(0, Math.min(100, position.x)),
                  y: Math.max(0, Math.min(100, position.y)),
                },
              },
            },
          },
        }));
      },

      resetSpatialSettings: (userId) => {
        const uid = userId ?? get().currentUser;
        if (!uid) return;
        const current = get().getSettings(uid);
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: {
              ...current,
              ...defaultSpatialSettings,
            },
          },
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

      setDevice: (kind, deviceId, userId, meta) => {
        const uid = userId ?? get().currentUser;
        if (!uid) return;
        const current = get().getSettings(uid);
        const key = kind === 'input' ? 'inputDeviceId' : kind === 'output' ? 'outputDeviceId' : 'videoDeviceId';
        const labelKey = kind === 'input' ? 'inputDeviceLabel' : kind === 'output' ? 'outputDeviceLabel' : 'videoDeviceLabel';
        const groupKey = kind === 'input' ? 'inputDeviceGroupId' : kind === 'output' ? 'outputDeviceGroupId' : 'videoDeviceGroupId';
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: {
              ...current,
              [key]: deviceId,
              [labelKey]: meta?.label,
              [groupKey]: meta?.groupId,
            }
          }
        }));
      },
    }),
    {
      name: "voice-settings-storage",
      version: 2,
      migrate: (persisted: any, version: number) => {
        const state = persisted as VoiceSettingsState;
        if (version === 0 || version === undefined) {
          // Fix contradictory defaults: if streamHighFidelity is on,
          // all audio processing must be off.
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
        if (version === undefined || version < 2) {
          migrateRoomScopedSettings(state);
        }
        return state;
      },
    }
  )
);
