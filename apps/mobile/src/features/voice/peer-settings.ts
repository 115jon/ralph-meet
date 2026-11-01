import { Schema } from "effect";
import { create } from "zustand";

import { useSession } from "@/features/auth/session";
import { readPersisted, writePersisted } from "@/lib/persist";

// How you hear each person in calls, on this device only: the web's
// peerSettings (useVoiceSettingsStore, "voice-settings-storage"), kept per
// signed-in user and then per person, with the same fields and range. No
// server keeps these.

export interface PeerSettings {
  /** Their voice, 0..200 percent. */
  readonly volume: number;
  /** Their shared screen's audio, 0..200 percent. */
  readonly streamVolume: number;
  /** Muted for you only. */
  readonly muted: boolean;
  /** Their soundboard clips stay silent for you. */
  readonly soundboardMuted: boolean;
}

export const PEER_VOLUME = { min: 0, max: 200, default: 100 } as const;

export const DEFAULT_PEER_SETTINGS: PeerSettings = {
  volume: PEER_VOLUME.default,
  streamVolume: PEER_VOLUME.default,
  muted: false,
  soundboardMuted: false,
};

const StoredPeer = Schema.Struct({
  volume: Schema.optional(Schema.Finite),
  streamVolume: Schema.optional(Schema.Finite),
  muted: Schema.optional(Schema.Boolean),
  soundboardMuted: Schema.optional(Schema.Boolean),
});
/** Signed-in user id → person's user id → settings. */
const Stored = Schema.Record(
  Schema.String,
  Schema.Record(Schema.String, StoredPeer),
);
type StoredPeers = typeof Stored.Type;

const STORAGE = "peer-settings";

function clampVolume(value: number): number {
  return Math.round(
    Math.min(PEER_VOLUME.max, Math.max(PEER_VOLUME.min, value)),
  );
}

function normalize(stored: typeof StoredPeer.Type | undefined): PeerSettings {
  if (!stored) return DEFAULT_PEER_SETTINGS;
  const volume = clampVolume(stored.volume ?? PEER_VOLUME.default);
  return {
    volume,
    // As the web's normalizePeerSettings: an old entry's stream follows the voice.
    streamVolume: clampVolume(stored.streamVolume ?? volume),
    muted: stored.muted ?? false,
    soundboardMuted: stored.soundboardMuted ?? false,
  };
}

interface PeerSettingsState {
  readonly byOwner: StoredPeers;
}

export const usePeerSettingsStore = create<PeerSettingsState>()(() => ({
  byOwner: readPersisted(STORAGE, Stored) ?? {},
}));

function ownerId(): string | null {
  return useSession.getState().user?.id ?? null;
}

/** `userId`'s settings for whoever is signed in; defaults when unset. */
export function peerSettings(userId: string | null): PeerSettings {
  const owner = ownerId();
  if (!owner || !userId) return DEFAULT_PEER_SETTINGS;
  return normalize(usePeerSettingsStore.getState().byOwner[owner]?.[userId]);
}

export function usePeerSettings(userId: string | null): PeerSettings {
  const owner = useSession((s) => s.user?.id ?? null);
  const stored = usePeerSettingsStore((s) =>
    owner && userId ? s.byOwner[owner]?.[userId] : undefined,
  );
  return normalize(stored);
}

export function setPeerSetting<K extends keyof PeerSettings>(
  userId: string,
  key: K,
  value: PeerSettings[K],
): void {
  const owner = ownerId();
  if (!owner) return;
  const next = { ...peerSettings(userId), [key]: value };
  next.volume = clampVolume(next.volume);
  next.streamVolume = clampVolume(next.streamVolume);
  usePeerSettingsStore.setState((state) => {
    const byOwner = {
      ...state.byOwner,
      [owner]: { ...state.byOwner[owner], [userId]: next },
    };
    writePersisted(STORAGE, byOwner);
    return { byOwner };
  });
}

/** The gain a voice or share track plays at: 0..2, 0 when muted for you. */
export function peerGain(
  settings: PeerSettings,
  source: "voice" | "stream",
): number {
  if (settings.muted) return 0;
  return (source === "voice" ? settings.volume : settings.streamVolume) / 100;
}
