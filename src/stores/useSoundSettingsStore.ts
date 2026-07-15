// ============================================================================
// Sound Settings Store — Zustand + persist
//
// Controls which sound effect categories are enabled/disabled.
// Persisted to localStorage and scoped per-user just like voice settings.
// ============================================================================

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  EMPTY_SOUNDBOARD_TRIGGER,
  normalizeSoundboardTriggerMap,
  type SoundboardTriggerMap,
} from "@/lib/voice/soundboard-trigger";
import { apiPatch } from "@/lib/api-client";

export type {
  SoundboardTriggerMap,
  SoundboardTriggerConfig,
  SoundboardTriggerSelection,
} from "@/lib/voice/soundboard-trigger";

export interface SoundSettings {
  /** Master switch — disables ALL sounds when false */
  soundsEnabled: boolean;
  /** Play sound when someone joins/leaves a voice channel you're in */
  voiceJoinLeave: boolean;
  /** Play mute/unmute/deafen click sounds */
  muteDeafen: boolean;
  /** Play notification chime on mentions/replies/DMs */
  notifications: boolean;
  /** Play connect/disconnect tones when you join/leave voice */
  selfConnectDisconnect: boolean;
  /** Play screen share start/stop sounds */
  screenShare: boolean;
  /** Play a dedicated tone when someone starts or stops watching your stream */
  streamWatcherActivity: boolean;
  /** Play subtle knock when a new message arrives in the current channel */
  messageReceived: boolean;
  /** Play ringing / call connected / call ended sounds */
  calls: boolean;
  /** Volume multiplier for all sound effects (0-100) */
  soundVolume: number;
  /** Local receive volume for soundboard playback (0-100). */
  soundboardVolume: number;
  /** Optional local soundboard clip played after a new voice session joins. */
  voiceJoinSoundboard: SoundboardTriggerMap;
  /** Optional local soundboard clip played before an established voice session leaves. */
  voiceLeaveSoundboard: SoundboardTriggerMap;
}

interface SoundSettingsState {
  currentUser: string | null;
  userSettings: Record<string, SoundSettings>;
  /** @internal Cache of merged settings objects to ensure referential stability */
  _cache: Record<string, SoundSettings>;
  setCurrentUser: (userId: string) => void;
  getSettings: (userId?: string | null) => SoundSettings;
  updateSettings: (updater: Partial<SoundSettings>, userId?: string) => void;
  hydrateFromBackend: (settings: unknown, userId: string) => void;
}

const defaultSoundSettings: SoundSettings = {
  soundsEnabled: true,
  voiceJoinLeave: true,
  muteDeafen: true,
  notifications: true,
  selfConnectDisconnect: true,
  screenShare: true,
  streamWatcherActivity: true,
  messageReceived: true,
  calls: true,
  soundVolume: 100,
  soundboardVolume: 100,
  voiceJoinSoundboard: { "*": { ...EMPTY_SOUNDBOARD_TRIGGER } },
  voiceLeaveSoundboard: { "*": { ...EMPTY_SOUNDBOARD_TRIGGER } },
};

type TriggerField =
  | "voiceJoinSoundboard"
  | "voiceLeaveSoundboard"
  | "soundboardVolume";
type TriggerSyncPayload = Partial<Pick<SoundSettings, TriggerField>>;

interface TriggerSyncQueue {
  pending: TriggerSyncPayload;
  inFlight: Promise<void> | null;
}

const triggerSyncQueues = new Map<string, TriggerSyncQueue>();

function queueTriggerSync(userId: string, updates: TriggerSyncPayload) {
  if (typeof window === "undefined") return;
  if (userId.startsWith("room-") || userId === "guest") return;

  const queue = triggerSyncQueues.get(userId) ?? {
    pending: {},
    inFlight: null,
  };
  queue.pending = { ...queue.pending, ...updates };
  triggerSyncQueues.set(userId, queue);
  if (queue.inFlight) return;

  const flush = async () => {
    while (Object.keys(queue.pending).length > 0) {
      const payload = queue.pending;
      queue.pending = {};
      try {
        await apiPatch("/api/users/me", { sound_settings: payload });
      } catch {
        // Local settings remain usable when the authenticated sync is offline.
      }
    }
    queue.inFlight = null;
    if (Object.keys(queue.pending).length === 0) {
      triggerSyncQueues.delete(userId);
    }
  };

  queue.inFlight = flush();
}

export const useSoundSettingsStore = create<SoundSettingsState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      userSettings: {},
      _cache: {},

      setCurrentUser: (userId) => set({ currentUser: userId }),

      getSettings: (userId) => {
        const uid = userId || get().currentUser;
        if (!uid) return defaultSoundSettings;
        const raw = get().userSettings[uid];
        if (!raw) return defaultSoundSettings;
        const merged: SoundSettings = {
          ...defaultSoundSettings,
          ...raw,
          voiceJoinSoundboard: normalizeSoundboardTriggerMap(
            raw.voiceJoinSoundboard,
          ),
          voiceLeaveSoundboard: normalizeSoundboardTriggerMap(
            raw.voiceLeaveSoundboard,
          ),
          soundboardVolume:
            typeof raw.soundboardVolume === "number" &&
            Number.isFinite(raw.soundboardVolume)
              ? Math.max(0, Math.min(100, raw.soundboardVolume))
              : defaultSoundSettings.soundboardVolume,
        };
        const cached = get()._cache[uid];
        if (cached && JSON.stringify(cached) === JSON.stringify(merged)) {
          return cached;
        }
        // Store in cache (mutate to avoid triggering subscribers)
        get()._cache[uid] = merged;
        return merged;
      },

      updateSettings: (updates, userId) => {
        const uid = userId ?? get().currentUser;
        if (!uid) return;
        const previous = get().getSettings(uid);
        const normalizedUpdates: Partial<SoundSettings> = { ...updates };
        for (const field of [
          "voiceJoinSoundboard",
          "voiceLeaveSoundboard",
        ] as const) {
          if (field in updates) {
            normalizedUpdates[field] = normalizeSoundboardTriggerMap(
              updates[field],
            );
          }
        }
        if ("soundboardVolume" in updates) {
          const volume = updates.soundboardVolume;
          normalizedUpdates.soundboardVolume =
            typeof volume === "number" && Number.isFinite(volume)
              ? Math.max(0, Math.min(100, volume))
              : defaultSoundSettings.soundboardVolume;
        }
        set((state) => {
          // Invalidate cache for this user
          const newCache = { ...state._cache };
          delete newCache[uid];
          return {
            _cache: newCache,
            userSettings: {
              ...state.userSettings,
              [uid]: {
                ...defaultSoundSettings,
                ...state.userSettings[uid],
                ...normalizedUpdates,
              },
            },
          };
        });

        const triggerUpdates: TriggerSyncPayload = {};
        if (
          "voiceJoinSoundboard" in updates &&
          JSON.stringify(previous.voiceJoinSoundboard) !==
            JSON.stringify(normalizedUpdates.voiceJoinSoundboard)
        ) {
          triggerUpdates.voiceJoinSoundboard =
            normalizedUpdates.voiceJoinSoundboard;
        }
        if (
          "voiceLeaveSoundboard" in updates &&
          JSON.stringify(previous.voiceLeaveSoundboard) !==
            JSON.stringify(normalizedUpdates.voiceLeaveSoundboard)
        ) {
          triggerUpdates.voiceLeaveSoundboard =
            normalizedUpdates.voiceLeaveSoundboard;
        }
        if (
          "soundboardVolume" in updates &&
          previous.soundboardVolume !== normalizedUpdates.soundboardVolume
        ) {
          triggerUpdates.soundboardVolume = normalizedUpdates.soundboardVolume;
        }
        if (Object.keys(triggerUpdates).length > 0) {
          queueTriggerSync(uid, triggerUpdates);
        }
      },

      hydrateFromBackend: (settings, userId) => {
        set({ currentUser: userId });
        if (!settings || typeof settings !== "object") return;
        const remote = settings as Record<string, unknown>;
        set((state) => {
          const nextCache = { ...state._cache };
          delete nextCache[userId];
          return {
            _cache: nextCache,
            userSettings: {
              ...state.userSettings,
              [userId]: {
                ...state.userSettings[userId],
                voiceJoinSoundboard: normalizeSoundboardTriggerMap(
                  remote.voiceJoinSoundboard,
                ),
                voiceLeaveSoundboard: normalizeSoundboardTriggerMap(
                  remote.voiceLeaveSoundboard,
                ),
                soundboardVolume:
                  typeof remote.soundboardVolume === "number" &&
                  Number.isFinite(remote.soundboardVolume)
                    ? Math.max(0, Math.min(100, remote.soundboardVolume))
                    : defaultSoundSettings.soundboardVolume,
              } as SoundSettings,
            },
          };
        });
      },
    }),
    {
      name: "sound-settings-storage",
      version: 1,
    },
  ),
);

// ── Convenience: check if a specific sound category is enabled ──────────────

export function isSoundEnabled(
  category: Exclude<
    keyof SoundSettings,
    | "soundsEnabled"
    | "soundVolume"
    | "soundboardVolume"
    | "voiceJoinSoundboard"
    | "voiceLeaveSoundboard"
  >,
): boolean {
  const store = useSoundSettingsStore.getState();
  const settings = store.getSettings();
  return settings.soundsEnabled && settings[category];
}
