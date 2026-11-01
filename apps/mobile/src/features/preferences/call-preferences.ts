import { Option, Schema } from "effect";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

// Call settings (You → 02 Calls), kept on this device only: the web keeps
// its voice settings in the browser too (useVoiceSettingsStore), and none of
// these has a server-side counterpart. Stored as one JSON value in
// SecureStore, like the theme and the last server.

const STORAGE_KEY = "ralph.call-preferences";

export type AudioRoutePreference = "speaker" | "earpiece";

export interface CallPreferences {
  /** The microphone level, in dB, at which you count as speaking. */
  readonly speakingThresholdDb: number;
  /** Join voice channels with the microphone off. */
  readonly joinMuted: boolean;
  /** Where call audio starts when no headset is connected. */
  readonly audioRoute: AudioRoutePreference;
}

/** The slider's range. -29 dB is the level the detector shipped with (0.035). */
export const SPEAKING_THRESHOLD_DB = { min: -60, max: -10, default: -29 };

const DEFAULTS: CallPreferences = {
  speakingThresholdDb: SPEAKING_THRESHOLD_DB.default,
  joinMuted: false,
  audioRoute: "speaker",
};

const StoredPreferences = Schema.Struct({
  speakingThresholdDb: Schema.optional(Schema.Finite),
  joinMuted: Schema.optional(Schema.Boolean),
  audioRoute: Schema.optional(Schema.Literals(["speaker", "earpiece"])),
});
const decodeStored = Schema.decodeUnknownOption(StoredPreferences);

function clampThreshold(db: number): number {
  return Math.round(
    Math.min(
      SPEAKING_THRESHOLD_DB.max,
      Math.max(SPEAKING_THRESHOLD_DB.min, db),
    ),
  );
}

function parse(raw: string | null): Partial<CallPreferences> {
  if (!raw) return {};
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {};
  }
  const stored = Option.getOrUndefined(decodeStored(json));
  if (!stored) return {};
  const { speakingThresholdDb, joinMuted, audioRoute } = stored;
  return {
    ...(speakingThresholdDb !== undefined && {
      speakingThresholdDb: clampThreshold(speakingThresholdDb),
    }),
    ...(joinMuted !== undefined && { joinMuted }),
    ...(audioRoute !== undefined && { audioRoute }),
  };
}

export const useCallPreferences = create<CallPreferences>()(() => DEFAULTS);

let loading: Promise<void> | null = null;
/** Set by the first change, so a slow first read cannot undo it. */
let changed = false;

/** Reads the stored preferences once; later calls share the first read. */
export function loadCallPreferences(): Promise<void> {
  loading ??= SecureStore.getItemAsync(STORAGE_KEY)
    .then((raw) => {
      if (!changed) useCallPreferences.setState(parse(raw));
    })
    .catch(() => undefined);
  return loading;
}

export function setCallPreference<K extends keyof CallPreferences>(
  key: K,
  value: CallPreferences[K],
): void {
  changed = true;
  const next = { ...useCallPreferences.getState(), [key]: value };
  if (key === "speakingThresholdDb") {
    next.speakingThresholdDb = clampThreshold(next.speakingThresholdDb);
  }
  useCallPreferences.setState(next);
  SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next)).catch(
    () => undefined,
  );
}

/** The threshold as the 0..1 audio level WebRTC reports. */
export function speakingLevel(): number {
  return 10 ** (useCallPreferences.getState().speakingThresholdDb / 20);
}
