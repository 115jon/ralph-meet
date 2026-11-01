import { Asset } from "expo-asset";

import { fileSystem } from "@/lib/file-system";

import * as RalphCall from "../../../modules/ralph-call/src";

// Short clips on the call's audio route (ralph-call playSound): the join and
// leave tones and soundboard sounds. Bundled sounds are WAV assets rendered
// from the web's oscillator recipes (scripts/render-call-sounds.mjs).

export type BundledSound =
  | "voice-join"
  | "voice-leave"
  | "soundboard-ping"
  | "soundboard-pop"
  | "soundboard-chime"
  | "soundboard-tada";

/** Metro asset ids. */
const BUNDLED: Readonly<Record<BundledSound, number>> = {
  "voice-join": require("../../../assets/sounds/voice-join.wav"),
  "voice-leave": require("../../../assets/sounds/voice-leave.wav"),
  "soundboard-ping": require("../../../assets/sounds/soundboard-ping.wav"),
  "soundboard-pop": require("../../../assets/sounds/soundboard-pop.wav"),
  "soundboard-chime": require("../../../assets/sounds/soundboard-chime.wav"),
  "soundboard-tada": require("../../../assets/sounds/soundboard-tada.wav"),
};

const localUris = new Map<BundledSound, Promise<string | null>>();

/** A bundled sound as a file:// URI (copied out of the app once). */
function bundledUri(name: BundledSound): Promise<string | null> {
  let uri = localUris.get(name);
  if (!uri) {
    uri = Asset.fromModule(BUNDLED[name])
      .downloadAsync()
      .then((asset) => asset.localUri ?? asset.uri)
      .catch((error: unknown) => {
        console.warn(`[Sounds] Could not load ${name}`, error);
        localUris.delete(name);
        return null;
      });
    localUris.set(name, uri);
  }
  return uri;
}

/** Plays a bundled sound under `id` (replacing one with that id). */
export async function playBundled(
  id: string,
  name: BundledSound,
  volume: number,
): Promise<boolean> {
  const uri = await bundledUri(name);
  if (!uri) return false;
  await RalphCall.playSound(id, uri, null, volume);
  return true;
}

export function playUrl(
  id: string,
  uri: string,
  headers: Readonly<Record<string, string>> | null,
  volume: number,
): Promise<void> {
  return RalphCall.playSound(id, uri, headers, volume);
}

/** A `data:audio/...;base64,` clip (a web user's custom sound), via a cache file. */
export function playDataUrl(
  id: string,
  dataUrl: string,
  volume: number,
): Promise<boolean> {
  const match = /^data:audio\/([\w.+-]+);base64,(.+)$/.exec(dataUrl);
  const fs = fileSystem;
  if (!match?.[1] || !match[2] || !fs) return Promise.resolve(false);
  const extension = match[1].replace(/[^\w]/g, "") || "audio";
  const file = new fs.File(
    fs.Paths.cache,
    `soundboard-${id.replace(/[^\w-]/g, "_")}.${extension}`,
  );
  try {
    if (file.exists) file.delete();
    file.create();
    file.write(match[2], { encoding: "base64" });
  } catch (error) {
    console.warn("[Sounds] Could not write a clip", error);
    return Promise.resolve(false);
  }
  return RalphCall.playSound(id, file.uri, null, volume).then(() => true);
}

export function stopSound(id: string): void {
  RalphCall.stopSound(id).catch(() => undefined);
}

type EndListener = (end: RalphCall.SoundEnd) => void;
const endListeners = new Set<EndListener>();
let subscription: { remove: () => void } | null = null;

/** Every clip that ends, is stopped or fails. */
export function onSoundEnded(listener: EndListener): () => void {
  endListeners.add(listener);
  subscription ??= RalphCall.onSoundEnded((end) => {
    for (const each of endListeners) each(end);
  });
  return () => {
    endListeners.delete(listener);
    if (endListeners.size === 0) {
      subscription?.remove();
      subscription = null;
    }
  };
}
