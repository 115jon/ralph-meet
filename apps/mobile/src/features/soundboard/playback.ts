import { create } from "zustand";

import { useSession } from "@/features/auth/session";
import {
  onSoundEnded,
  playBundled,
  playDataUrl,
  playUrl,
  stopSound,
} from "@/features/voice/call-sounds";
import { peerSettings } from "@/features/voice/peer-settings";
import { useVoiceStore } from "@/features/voice/store";
import { mediaSource } from "@/lib/api";
import { showToast } from "@/ui";

import {
  clipSource,
  decodeSoundboardEvent,
  eventOwner,
  playbackId,
  soundboardServerKey,
  type PlayableSound,
  type SoundboardPlay,
} from "./events";

// Hearing the soundboard in a call: every soundboard.play the voice room
// relays (ours included, which is how we hear our own) is played here on the
// call's audio route, unless its owner's soundboard is muted for us, every
// soundboard is muted for this call, or we are deafened. A playing clip's
// playback id is kept until it ends, so the sheet can light its LED.

interface SoundboardState {
  /** Playback ids playing now. */
  readonly playing: Readonly<Record<string, true>>;
  /** "Mute all soundboards", for the call in progress only. */
  readonly muteAll: boolean;
}

export const useSoundboardStore = create<SoundboardState>()(() => ({
  playing: {},
  muteAll: false,
}));

/** Playback id → its owner, for a stop without a playback id. */
const owners = new Map<string, string>();
const PREVIEW_PREFIX = "preview:";

function setPlaying(id: string, on: boolean): void {
  useSoundboardStore.setState((state) => {
    if ((state.playing[id] === true) === on) return state;
    const playing = { ...state.playing };
    if (on) playing[id] = true;
    else delete playing[id];
    return { playing };
  });
}

let stopListening: (() => void) | null = null;

function listen(): void {
  stopListening ??= onSoundEnded((end) => {
    owners.delete(end.id);
    setPlaying(end.id, false);
    if (end.error) console.warn(`[Soundboard] ${end.id}: ${end.error}`);
  });
}

function currentServerKey(): string | null {
  const call = useVoiceStore.getState().call;
  return call ? soundboardServerKey(call.serverId) : null;
}

/** The clip for `event` on the call's route; false when it could not start. */
async function playClip(id: string, event: SoundboardPlay): Promise<boolean> {
  const source = clipSource(event);
  if (!source) return false;
  const volume = Math.min(1, Math.max(0, event.volume ?? 1));
  switch (source.kind) {
    case "default":
      return playBundled(id, `soundboard-${source.id}`, volume);
    case "data":
      return playDataUrl(id, source.dataUrl, volume);
    case "api": {
      const { uri, headers } = mediaSource(source.path);
      await playUrl(id, uri, headers ?? null, volume);
      return true;
    }
    case "url": {
      // A capability URL needs no session; MyInstants is someone else's.
      const { uri } = mediaSource(source.url);
      await playUrl(id, uri, null, volume);
      return true;
    }
  }
}

function play(event: SoundboardPlay): void {
  const call = useVoiceStore.getState().call;
  if (!call || call.deafened) return;
  const owner = eventOwner(event);
  const self = useSession.getState().user?.id ?? null;
  const own = owner !== null && owner === self;
  if (!own) {
    if (useSoundboardStore.getState().muteAll) return;
    if (owner && peerSettings(owner).soundboardMuted) return;
  }
  listen();
  const id = event.playback_id;
  if (owner) owners.set(id, owner);
  setPlaying(id, true);
  playClip(id, event)
    .then((started) => {
      if (!started) throw new Error("No playable clip");
    })
    .catch((error: unknown) => {
      console.warn("[Soundboard] Could not play", event.name, error);
      owners.delete(id);
      setPlaying(id, false);
      if (own) soundboardFailed();
    });
}

function soundboardFailed(): void {
  const label = useVoiceStore.getState().call?.channelName ?? "Soundboard";
  showToast({ label, text: "Could not play this sound", led: "danger" });
}

/** A VoiceAppEvent from the call (see VoiceSession onAppEvent). */
export function handleSoundboardEvent(raw: unknown): void {
  const event = decodeSoundboardEvent(raw);
  if (!event || event.server_key !== currentServerKey()) return;
  if (event.type === "soundboard.play") {
    play(event);
    return;
  }
  if (event.playback_id) {
    stopSound(event.playback_id);
    return;
  }
  // No playback id: everything that person is playing.
  for (const [id, owner] of owners) {
    if (owner === event.user_id) stopSound(id);
  }
}

/** The room refused one of ours (rate limit, a clip it does not accept). */
export function handleSoundboardRejected(): void {
  soundboardFailed();
}

/** Plays `sound` only here: the sheet's long-press preview. */
export function previewSound(sound: PlayableSound): void {
  const serverKey = currentServerKey();
  const self = useSession.getState().user?.id;
  if (!serverKey || !self) return;
  listen();
  const id = `${PREVIEW_PREFIX}${sound.id}`;
  setPlaying(id, true);
  playClip(id, {
    type: "soundboard.play",
    server_key: serverKey,
    playback_id: playbackId(self, sound.id),
    sound_id: sound.id,
    name: sound.name,
    media_url: sound.kind === "default" ? undefined : (sound.url ?? undefined),
    volume: sound.volume,
  }).catch(() => setPlaying(id, false));
}

/** Whether `sound` is playing, sent by us or previewed. */
export function useSoundPlaying(sound: PlayableSound): boolean {
  const self = useSession((s) => s.user?.id ?? null);
  return useSoundboardStore(
    (s) =>
      (self !== null && s.playing[playbackId(self, sound.id)] === true) ||
      s.playing[`${PREVIEW_PREFIX}${sound.id}`] === true,
  );
}

/** Their soundboard was just muted for us: stop what they are playing. */
export function stopSoundsOf(userId: string): void {
  for (const [id, owner] of owners) {
    if (owner === userId) stopSound(id);
  }
}

export function setMuteAllSoundboards(muteAll: boolean): void {
  useSoundboardStore.setState({ muteAll });
  if (!muteAll) return;
  const self = useSession.getState().user?.id;
  for (const [id, owner] of owners) {
    if (owner !== self) stopSound(id);
  }
}

/** The call ended: silence what is playing and forget the call's mute-all. */
export function resetSoundboard(): void {
  for (const id of Object.keys(useSoundboardStore.getState().playing)) {
    stopSound(id);
  }
  owners.clear();
  useSoundboardStore.setState({ playing: {}, muteAll: false });
}
