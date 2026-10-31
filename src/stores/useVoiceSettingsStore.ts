import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  CAMERA_QUALITY_PROFILES,
  type CameraQualityId,
} from "@/lib/camera-quality";
import {
  isRecord,
  orElse,
  orElseWith,
  readBoolean,
  readGuard,
  readList,
  readMap,
  readNumber,
  readOneOf,
  readObject,
  readString,
  required,
  type Read,
} from "@/lib/persisted-guard";
import type { NoiseReductionProviderId } from "@/lib/voice/noise-reduction";
import {
  VOICE_INPUT_PROFILE_SETTINGS,
  type VoiceInputProfile,
} from "@/lib/voice/input-profiles";

export type CameraBackgroundSetting =
  | { type: "none" }
  | { type: "blur"; strength: "light" | "strong" }
  | { type: "image"; id: string };

export interface CustomCameraBackground {
  id: string;
  name: string;
  dataUrl?: string;
  url?: string;
  contentType?: string;
  sizeBytes?: number;
  createdAt: number;
}

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
  cameraQuality: CameraQualityId;
  cameraBackground: CameraBackgroundSetting;
  customCameraBackgrounds: CustomCameraBackground[];
  inputProfile: VoiceInputProfile;
  noiseSuppression: boolean;
  noiseReductionEnabled: boolean;
  noiseReductionProvider: NoiseReductionProviderId;
  echoCancellation: boolean;
  sensitivity: number;
  autoSensitivity: boolean;
  outputVolume: number;
  inputVolume: number;
  streamHighFidelity: boolean;
  screenShareQuality: string;
  screenShareWithAudio: boolean;
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
  alwaysPreviewVideo?: boolean;
  alwaysShowStreamPreview?: boolean;
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
  updateSpatialSettings: (
    updater: (s: SpatialAudioSettings) => SpatialAudioSettings,
    userId?: string,
  ) => void;
  setSpatialManualPosition: (
    peerId: string,
    position: SpatialPosition,
    userId?: string,
  ) => void;
  resetSpatialSettings: (userId?: string) => void;

  // Global actions
  setIsMuted: (muted: boolean, userId?: string) => void;
  setIsDeafened: (deafened: boolean, userId?: string) => void;
  setDevice: (
    kind: "input" | "output" | "video",
    deviceId: string,
    userId?: string,
    meta?: { label?: string; groupId?: string },
  ) => void;
  setScreenShareDefaults: (
    defaults: { quality: string; withAudio: boolean },
    userId?: string,
  ) => void;
  updateUserSettings: (
    updater: (s: UserSettings) => UserSettings,
    userId?: string,
  ) => void;
  updateVoiceSettings: (
    updater: (s: UserSettings) => UserSettings,
    userId?: string,
  ) => void;
  setInputProfile: (profile: VoiceInputProfile, userId?: string) => void;
}

const defaultSettings: UserSettings = {
  inputDeviceId: "default",
  outputDeviceId: "default",
  videoDeviceId: "default",
  cameraQuality: "720p30",
  cameraBackground: { type: "none" },
  customCameraBackgrounds: [],
  inputProfile: "standard",
  noiseSuppression: true,
  noiseReductionEnabled: false,
  noiseReductionProvider: "rnnoise",
  echoCancellation: true,
  sensitivity: -50,
  autoSensitivity: true,
  outputVolume: 100,
  inputVolume: 100,
  streamHighFidelity: false,
  screenShareQuality: "720p30",
  screenShareWithAudio: true,
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
  alwaysPreviewVideo: true,
  alwaysShowStreamPreview: false,
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

export function normalizePeerSettings(
  peer?: Partial<PeerSettings>,
): PeerSettings {
  const volume =
    typeof peer?.volume === "number" ? peer.volume : defaultPeerSettings.volume;
  return {
    ...defaultPeerSettings,
    ...peer,
    volume,
    streamVolume:
      typeof peer?.streamVolume === "number" ? peer.streamVolume : volume,
  };
}

// ── Persisted state ─────────────────────────────────────────────────────────
// localStorage outlives the code that wrote it, so everything read back is
// checked: a field that is missing, from an older release or the wrong type
// becomes the default instead of reaching the store. The id lists below repeat
// the members of types that live in modules this store must not import at
// runtime (they pull in wasm and audio code); `satisfies` checks that every id
// listed is a valid member of those types.

const readCameraQuality = readGuard((value): value is CameraQualityId =>
  CAMERA_QUALITY_PROFILES.some((profile) => profile.id === value),
);

const readInputProfile = readOneOf([
  "standard",
  "studio",
  "custom",
] satisfies VoiceInputProfile[]);

const readNoiseReductionProvider = readOneOf([
  "rnnoise",
  "krisp-browser",
] satisfies NoiseReductionProviderId[]);

const readSpatialPlacementMode = readOneOf([
  "line",
  "arc",
  "grid",
  "manual",
] satisfies SpatialPlacementMode[]);

const readCameraBackground: Read<CameraBackgroundSetting> = (value) => {
  if (!isRecord(value)) return undefined;
  if (value.type === "none") return { type: "none" };
  if (value.type === "blur") {
    return value.strength === "light" || value.strength === "strong"
      ? { type: "blur", strength: value.strength }
      : undefined;
  }
  if (value.type === "image" && typeof value.id === "string") {
    return { type: "image", id: value.id };
  }
  return undefined;
};

const readCustomCameraBackground = readObject<CustomCameraBackground>({
  id: required(readString),
  name: required(readString),
  dataUrl: readString,
  url: readString,
  contentType: readString,
  sizeBytes: readNumber,
  createdAt: required(readNumber),
});

const readSpatialPosition = readObject<SpatialPosition>({
  x: required(readNumber),
  y: required(readNumber),
});

/** A peer entry as stored: any field may be missing in entries from older releases. */
const readStoredPeerSettings = readObject<Partial<PeerSettings>>({
  volume: readNumber,
  streamVolume: readNumber,
  muted: readBoolean,
  alwaysHear: readBoolean,
  attenuationEnabled: readBoolean,
  attenuationStrength: readNumber,
  soundboardMuted: readBoolean,
});

/** Peer entries are completed by `normalizePeerSettings`, which also backfills `streamVolume` from `volume`. */
const readPeerSettings: Read<PeerSettings> = (value) => {
  const stored = readStoredPeerSettings(value);
  return stored && normalizePeerSettings(stored);
};

const readUserSettings = readObject<UserSettings>({
  inputDeviceId: orElse(readString, defaultSettings.inputDeviceId),
  inputDeviceLabel: readString,
  inputDeviceGroupId: readString,
  outputDeviceId: orElse(readString, defaultSettings.outputDeviceId),
  outputDeviceLabel: readString,
  outputDeviceGroupId: readString,
  videoDeviceId: orElse(readString, defaultSettings.videoDeviceId),
  videoDeviceLabel: readString,
  videoDeviceGroupId: readString,
  cameraQuality: orElse(readCameraQuality, defaultSettings.cameraQuality),
  cameraBackground: orElse(
    readCameraBackground,
    defaultSettings.cameraBackground,
  ),
  customCameraBackgrounds: orElseWith(
    readList(readCustomCameraBackground),
    () => [],
  ),
  inputProfile: orElse(readInputProfile, defaultSettings.inputProfile),
  noiseSuppression: orElse(readBoolean, defaultSettings.noiseSuppression),
  noiseReductionEnabled: orElse(
    readBoolean,
    defaultSettings.noiseReductionEnabled,
  ),
  noiseReductionProvider: orElse(
    readNoiseReductionProvider,
    defaultSettings.noiseReductionProvider,
  ),
  echoCancellation: orElse(readBoolean, defaultSettings.echoCancellation),
  sensitivity: orElse(readNumber, defaultSettings.sensitivity),
  autoSensitivity: orElse(readBoolean, defaultSettings.autoSensitivity),
  outputVolume: orElse(readNumber, defaultSettings.outputVolume),
  inputVolume: orElse(readNumber, defaultSettings.inputVolume),
  streamHighFidelity: orElse(readBoolean, defaultSettings.streamHighFidelity),
  screenShareQuality: orElse(readString, defaultSettings.screenShareQuality),
  screenShareWithAudio: orElse(
    readBoolean,
    defaultSettings.screenShareWithAudio,
  ),
  isMuted: orElse(readBoolean, defaultSettings.isMuted),
  isDeafened: orElse(readBoolean, defaultSettings.isDeafened),
  wasMutedBeforeDeafen: orElse(
    readBoolean,
    defaultSettings.wasMutedBeforeDeafen,
  ),
  alwaysHearScreenShareAudio: orElse(
    readBoolean,
    defaultSettings.alwaysHearScreenShareAudio,
  ),
  lastChannelId: orElse<string | null>(readString, null),
  lastServerId: orElse<string | null>(readString, null),
  peerSettings: orElseWith(readMap(readPeerSettings), () => ({})),
  spatialAudioEnabled: orElse(readBoolean, defaultSettings.spatialAudioEnabled),
  spatialPlacementMode: orElse(
    readSpatialPlacementMode,
    defaultSettings.spatialPlacementMode,
  ),
  spatialRoomSize: orElse(readNumber, defaultSettings.spatialRoomSize),
  spatialDistance: orElse(readNumber, defaultSettings.spatialDistance),
  spatialArcAngle: orElse(readNumber, defaultSettings.spatialArcAngle),
  spatialManualPositions: orElseWith(readMap(readSpatialPosition), () => ({})),
  alwaysPreviewVideo: readBoolean,
  alwaysShowStreamPreview: readBoolean,
});

/** `_cache` is derived and never read back. */
const readPersistedVoiceSettings = readObject<{
  currentUser?: string;
  userSettings: Record<string, UserSettings>;
}>({
  currentUser: readString,
  userSettings: orElseWith(readMap(readUserSettings), () => ({})),
});

/** What `persist` writes and `migrate` returns; derived state such as `_cache` is not stored. */
type PersistedVoiceState = {
  currentUser: string | null;
  userSettings: Record<string, UserSettings>;
};

const ROOM_GUEST_SETTINGS_USER_ID = "room-guest";

function migrateRoomScopedSettings(state: PersistedVoiceState): void {
  if (!state?.userSettings) return;

  const roomKeys = Object.keys(state.userSettings).filter(
    (uid) => uid.startsWith("room-") && uid !== ROOM_GUEST_SETTINGS_USER_ID,
  );
  if (roomKeys.length === 0) return;

  if (!state.userSettings[ROOM_GUEST_SETTINGS_USER_ID]) {
    state.userSettings[ROOM_GUEST_SETTINGS_USER_ID] =
      state.userSettings[roomKeys[0]];
  }

  for (const uid of roomKeys) {
    delete state.userSettings[uid];
  }

  if (state.currentUser?.startsWith("room-")) {
    state.currentUser = ROOM_GUEST_SETTINGS_USER_ID;
  }
}

export const useVoiceSettingsStore = create<VoiceSettingsState>()(
  persist<VoiceSettingsState, [], [], PersistedVoiceState>(
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
          ]),
        );
        const merged = { ...defaultSettings, ...raw, peerSettings };
        // Tag the merged object with the raw reference for identity checking
        Object.defineProperty(merged, "__raw", {
          value: raw,
          enumerable: false,
        });
        get()._cache[uid] = merged;
        return merged;
      },

      updateUserSettings: (
        updater: (s: UserSettings) => UserSettings,
        userId?: string,
      ) => {
        const uid = userId ?? get().currentUser;
        if (!uid) return;
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: updater(state.userSettings[uid] || { ...defaultSettings }),
          },
        }));
      },

      updateVoiceSettings: (updater, userId) => {
        const uid = userId ?? get().currentUser;
        if (!uid) return;
        const current = get().getSettings(uid);
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: {
              ...updater(current),
              inputProfile: "custom",
            },
          },
        }));
      },

      setInputProfile: (profile, userId) => {
        const uid = userId ?? get().currentUser;
        if (!uid) return;
        const current = get().getSettings(uid);
        const preset =
          profile === "custom" ? {} : VOICE_INPUT_PROFILE_SETTINGS[profile];
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: {
              ...current,
              ...preset,
              inputProfile: profile,
            },
          },
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
                [peerId]: { ...peer, volume },
              },
            },
          },
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
                [peerId]: { ...peer, streamVolume },
              },
            },
          },
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
                [peerId]: { ...peer, muted },
              },
            },
          },
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
                [peerId]: { ...peer, alwaysHear },
              },
            },
          },
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
                [peerId]: { ...peer, attenuationEnabled: enabled },
              },
            },
          },
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
                [peerId]: { ...peer, attenuationStrength: strength },
              },
            },
          },
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
                [peerId]: { ...peer, soundboardMuted },
              },
            },
          },
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

      setIsMuted: (isMuted, userId) => {
        const uid = userId ?? get().currentUser;
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
              wasMutedBeforeDeafen: !nextDeaf
                ? isMuted
                : current.wasMutedBeforeDeafen,
            },
          },
        }));
      },

      setIsDeafened: (isDeafened, userId) => {
        const uid = userId ?? get().currentUser;
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
                wasMutedBeforeDeafen: current.isMuted,
              },
            },
          }));
        } else {
          // Undeafening: restore from memory
          set((state) => ({
            userSettings: {
              ...state.userSettings,
              [uid]: {
                ...current,
                isDeafened: false,
                isMuted: current.wasMutedBeforeDeafen,
              },
            },
          }));
        }
      },

      setDevice: (kind, deviceId, userId, meta) => {
        const uid = userId ?? get().currentUser;
        if (!uid) return;
        const current = get().getSettings(uid);
        const key =
          kind === "input"
            ? "inputDeviceId"
            : kind === "output"
              ? "outputDeviceId"
              : "videoDeviceId";
        const labelKey =
          kind === "input"
            ? "inputDeviceLabel"
            : kind === "output"
              ? "outputDeviceLabel"
              : "videoDeviceLabel";
        const groupKey =
          kind === "input"
            ? "inputDeviceGroupId"
            : kind === "output"
              ? "outputDeviceGroupId"
              : "videoDeviceGroupId";
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: {
              ...current,
              [key]: deviceId,
              [labelKey]: meta?.label,
              [groupKey]: meta?.groupId,
            },
          },
        }));
      },

      setScreenShareDefaults: ({ quality, withAudio }, userId) => {
        const uid = userId ?? get().currentUser;
        if (!uid) return;
        const current = get().getSettings(uid);
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            [uid]: {
              ...current,
              screenShareQuality: quality,
              screenShareWithAudio: withAudio,
            },
          },
        }));
      },
    }),
    {
      name: "voice-settings-storage",
      version: 5,
      partialize: (state) => ({
        currentUser: state.currentUser,
        userSettings: state.userSettings,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...readPersistedVoiceSettings(persistedState),
      }),
      migrate: (persisted, version) => {
        // Read first so the version steps below work on checked data. Missing
        // fields come out as defaults, which is what the older versions' `??=`
        // backfills did.
        const stored = readPersistedVoiceSettings(persisted);
        const state: PersistedVoiceState = {
          currentUser: stored?.currentUser ?? null,
          userSettings: stored?.userSettings ?? {},
        };
        if (version === 0 || version === undefined) {
          // High fidelity only disables browser capture processing. RNNoise
          // and the local sensitivity gate run after capture and remain valid.
          if (state?.userSettings) {
            for (const uid of Object.keys(state.userSettings)) {
              const s = state.userSettings[uid];
              if (s?.streamHighFidelity) {
                s.noiseSuppression = false;
                s.echoCancellation = false;
              }
            }
          }
        }
        if (version === undefined || version < 2) {
          migrateRoomScopedSettings(state);
        }
        if (version === undefined || version < 3) {
          if (state?.userSettings) {
            for (const uid of Object.keys(state.userSettings)) {
              const s = state.userSettings[uid];
              if (!s) continue;
              s.noiseReductionEnabled ??= false;
              s.noiseReductionProvider ??= "rnnoise";
            }
          }
        }
        if (version === undefined || version < 5) {
          if (state?.userSettings) {
            for (const uid of Object.keys(state.userSettings)) {
              const s = state.userSettings[uid];
              if (s) s.inputProfile = "custom";
            }
          }
        }
        return state;
      },
    },
  ),
);
