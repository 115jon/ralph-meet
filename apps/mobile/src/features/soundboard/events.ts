import { Option, Schema } from "effect";

// The soundboard's voice-session events, as the web sends and plays them
// (src/components/chat/SoundboardPicker.tsx, src/lib/voice/soundboard.ts) and
// the voice room checks them (realtime/voice-room.ts sanitizeSoundboardEvent).
// A play goes out on the voice socket as VoiceAppEvent; the room relays it to
// everyone in the call, the sender too, and each phone or browser plays the
// clip itself. Pure: no React Native, so it is tested in Node.

/** The server key of a DM call; a voice channel's is its server id. */
export const DM_CALL_SERVER_KEY = "dm-call";

/** The four sounds every client has (synthesized on the web, files here). */
export const DEFAULT_SOUNDS = [
  { id: "ping", name: "Ping" },
  { id: "pop", name: "Pop" },
  { id: "chime", name: "Chime" },
  { id: "tada", name: "Ta-da" },
] as const;
export type DefaultSoundId = (typeof DEFAULT_SOUNDS)[number]["id"];

/** The web picker's send volume (its slider defaults to 80%). */
export const SEND_VOLUME = 0.8;

const UPLOAD_PATH = "/api/soundboard/uploads/";
const MYINSTANTS_PREFIX = "https://www.myinstants.com/media/sounds/";

export function soundboardServerKey(serverId: string): string {
  return serverId || DM_CALL_SERVER_KEY;
}

/**
 * The web's createSoundboardPlaybackId: deterministic, so playing the same
 * sound again restarts it, and the room checks the owner part is the sender.
 */
export function playbackId(userId: string, soundId: string): string {
  return `sb1:${userId.length}:${userId}:${soundId}`;
}

/** The owner part of a playback id, or null when it is not one. */
export function playbackOwner(id: string): string | null {
  const match = /^sb1:(\d+):/.exec(id);
  if (!match?.[1]) return null;
  const length = Number(match[1]);
  const start = match[0].length;
  const owner = id.slice(start, start + length);
  return owner.length === length && id.charAt(start + length) === ":"
    ? owner
    : null;
}

export function uploadUrl(soundId: string): string {
  return `${UPLOAD_PATH}${encodeURIComponent(soundId)}`;
}

export function isUploadUrl(url: string): boolean {
  return url.startsWith(UPLOAD_PATH);
}

export function isMyInstantsUrl(url: string): boolean {
  return url.startsWith(MYINSTANTS_PREFIX);
}

export function isDefaultSoundId(id: string): id is DefaultSoundId {
  return DEFAULT_SOUNDS.some((sound) => sound.id === id);
}

/** One sound the sheet can play. */
export interface PlayableSound {
  readonly id: string;
  readonly name: string;
  readonly emoji: string | null;
  readonly kind: "server" | "myinstants" | "default";
  /** The upload path or the MyInstants URL; none for a default sound. */
  readonly url: string | null;
  /** The catalog's own volume, 0..1. */
  readonly volume: number;
  /** A server upload's server (a DM call names it as source_server_id). */
  readonly serverId: string | null;
}

/** soundboard.play as the voice room accepts it (sanitizeSoundboardEvent). */
export type PlayPayload = {
  readonly type: "soundboard.play";
  readonly server_key: string;
  readonly user_id: string;
  readonly playback_id: string;
  readonly sound_id: string;
  readonly name: string;
  /** 0..1. */
  readonly volume: number;
  /** An upload path or a MyInstants URL; absent for a default sound. */
  media_url?: string;
  /** A DM call's upload: the server it belongs to. */
  source_server_id?: string;
};

/**
 * The VoiceAppEvent `d` that plays `sound` for everyone. In a DM call only
 * defaults and uploads from a server you are in are accepted, the latter
 * with its source_server_id; the room re-issues its URL as a capability.
 */
export function playPayload(
  sound: PlayableSound,
  serverKey: string,
  userId: string,
): PlayPayload {
  const media = sound.kind !== "default" ? sound.url : null;
  const source =
    serverKey === DM_CALL_SERVER_KEY && sound.kind === "server"
      ? sound.serverId
      : null;
  const d: PlayPayload = {
    type: "soundboard.play",
    server_key: serverKey,
    user_id: userId,
    playback_id: playbackId(userId, sound.id),
    sound_id: sound.id,
    name: sound.name,
    volume: Math.min(1, Math.max(0, SEND_VOLUME * sound.volume)),
  };
  if (media) d.media_url = media;
  if (source) d.source_server_id = source;
  return d;
}

/** Whether `sound` can be played in this call (see playPayload). */
export function playableIn(sound: PlayableSound, serverKey: string): boolean {
  if (sound.kind === "default") return true;
  if (serverKey === DM_CALL_SERVER_KEY) {
    return sound.kind === "server" && sound.serverId !== null;
  }
  // A voice channel takes its own server's uploads and MyInstants clips.
  return sound.kind === "myinstants" || sound.serverId === serverKey;
}

// ── Incoming ─────────────────────────────────────────────────────────────

const PlayEvent = Schema.Struct({
  type: Schema.Literal("soundboard.play"),
  server_key: Schema.String,
  playback_id: Schema.String,
  user_id: Schema.optional(Schema.String),
  sound_id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  media_url: Schema.optional(Schema.String),
  data_url: Schema.optional(Schema.String),
  volume: Schema.optional(Schema.Finite),
});

const StopEvent = Schema.Struct({
  type: Schema.Literal("soundboard.stop"),
  server_key: Schema.String,
  playback_id: Schema.optional(Schema.String),
  user_id: Schema.optional(Schema.String),
});

const SoundboardEvent = Schema.Union([PlayEvent, StopEvent]);
export type SoundboardEvent = typeof SoundboardEvent.Type;
export type SoundboardPlay = typeof PlayEvent.Type;

const decodeEvent = Schema.decodeUnknownOption(SoundboardEvent);

/** A soundboard event this app acts on, or null (others, malformed). */
export function decodeSoundboardEvent(event: unknown): SoundboardEvent | null {
  return Option.getOrNull(decodeEvent(event));
}

/** Who played it: the sender's user id, or the playback id's owner. */
export function eventOwner(event: SoundboardPlay): string | null {
  return event.user_id ?? playbackOwner(event.playback_id);
}

/** Where a play's audio comes from. */
export type ClipSource =
  | { readonly kind: "default"; readonly id: DefaultSoundId }
  /** API-relative: fetched with the session's Bearer token. */
  | { readonly kind: "api"; readonly path: string }
  /** A capability URL (DM calls) or MyInstants: fetched bare. */
  | {
      readonly kind: "url";
      readonly url: string;
      readonly apiRelative: boolean;
    }
  | { readonly kind: "data"; readonly dataUrl: string };

export function clipSource(event: SoundboardPlay): ClipSource | null {
  const media = event.media_url;
  if (media) {
    if (isUploadUrl(media)) {
      // A DM call's capability (?cap=) stands in for a session.
      return media.includes("cap=")
        ? { kind: "url", url: media, apiRelative: true }
        : { kind: "api", path: media };
    }
    if (isMyInstantsUrl(media)) {
      return { kind: "url", url: media, apiRelative: false };
    }
    return null;
  }
  if (event.data_url?.startsWith("data:audio/")) {
    return { kind: "data", dataUrl: event.data_url };
  }
  if (event.sound_id && isDefaultSoundId(event.sound_id)) {
    return { kind: "default", id: event.sound_id };
  }
  return null;
}
