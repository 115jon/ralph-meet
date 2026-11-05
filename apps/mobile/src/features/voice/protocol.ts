import {
  compilePayloadDecoder,
  ErrorPayload,
  GatewayOp,
  HelloPayload,
  type DecodedMessage,
  type PayloadRules,
} from "@ralph/protocol";
import type { IceServer, TrackInfo } from "@ralph/voice-media";
import { Schema } from "effect";

export type { IceServer, TrackInfo };

// Server → client payloads of the two call sockets, the parts this app reads.
// Mirrors the web's src/lib/gateway-protocol/server-payloads.ts (which carries
// web-only types, so it is not shared): looser than what the Durable Objects
// send, extra keys pass, and a frame that fails is logged and dropped by
// RealtimeSocket.

const OptionalText = Schema.optional(Schema.NullOr(Schema.String));
const OptionalFlag = Schema.optional(Schema.Boolean);

/** A published track as the voice room describes it. */
export const TrackInfoSchema = Schema.Struct({
  participant_id: Schema.String,
  /** Ralph's alias, e.g. `cam-audio-<participant id>`. */
  track_name: Schema.String,
  /** The SFU's track name; tracks without one are legacy and never pulled. */
  sfu_track_name: Schema.optional(Schema.String),
  session_id: Schema.String,
  kind: Schema.String,
  /** A simulcast camera's layer RIDs, highest first; absent for one layer. */
  simulcast_rids: Schema.optional(Schema.Array(Schema.String)),
});
/** A track as the voice room sent it; see toTrackInfo. */
export type WireTrackInfo = typeof TrackInfoSchema.Type;

/**
 * A wire track in the shape the shared media layer (@ralph/voice-media)
 * takes, or null for a kind it cannot pull (neither audio nor video).
 */
export function toTrackInfo(track: WireTrackInfo): TrackInfo | null {
  if (track.kind !== "audio" && track.kind !== "video") return null;
  const info: TrackInfo = {
    participant_id: track.participant_id,
    track_name: track.track_name,
    session_id: track.session_id,
    kind: track.kind,
  };
  if (track.sfu_track_name !== undefined) {
    info.sfu_track_name = track.sfu_track_name;
  }
  if (track.simulcast_rids) info.simulcast_rids = [...track.simulcast_rids];
  return info;
}

export function toTrackInfos(tracks: readonly WireTrackInfo[]): TrackInfo[] {
  return tracks.flatMap((track) => toTrackInfo(track) ?? []);
}

const IceServerSchema = Schema.Struct({
  urls: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  username: Schema.optional(Schema.String),
  credential: Schema.optional(Schema.String),
});
export type WireIceServer = typeof IceServerSchema.Type;

/** The room's ICE servers as the PartyTracks transport takes them. */
export function toIceServers(
  servers: readonly WireIceServer[] | undefined,
): IceServer[] {
  return (servers ?? []).map((server) => {
    const ice: IceServer = {
      urls: typeof server.urls === "string" ? [server.urls] : [...server.urls],
    };
    if (server.username !== undefined) ice.username = server.username;
    if (server.credential !== undefined) ice.credential = server.credential;
    return ice;
  });
}

/**
 * A room participant. Join and leave carry the full state; an update may be
 * a delta without the profile fields (we Identify with
 * supports_voice_state_deltas), so only `id` is required.
 */
export const VoiceStateSchema = Schema.Struct({
  id: Schema.String,
  user_id: OptionalText,
  name: Schema.optional(Schema.String),
  username: OptionalText,
  display_name: OptionalText,
  avatar_url: OptionalText,
  self_mute: OptionalFlag,
  self_deaf: OptionalFlag,
  self_video: OptionalFlag,
  self_stream: OptionalFlag,
});
export type VoiceState = typeof VoiceStateSchema.Type;

const IceServers = Schema.Array(IceServerSchema);
const VoiceStates = Schema.Array(VoiceStateSchema);
const TrackInfos = Schema.Array(TrackInfoSchema);

// ── Room socket (MeetingRoom, /api/channels/:slug/ws) ───────────────────────

const MediaReadyPayload = Schema.Struct({
  participant_id: Schema.String,
  ice_servers: IceServers,
  voice_token: Schema.String,
});

const ReadyPayload = Schema.Struct({
  participant_id: Schema.String,
  // Absent when the join's admission already carried them (ADMISSION.md).
  ice_servers: Schema.optional(IceServers),
  voice_token: Schema.optional(Schema.String),
  participants: Schema.optional(VoiceStates),
});

const ResumedPayload = Schema.Struct({
  voice_token: Schema.optional(Schema.String),
  ice_servers: Schema.optional(IceServers),
  participants: Schema.optional(VoiceStates),
});

const VoiceStateUpdatePayload = Schema.Struct({
  participant: VoiceStateSchema,
  action: Schema.Literals(["join", "leave", "update"]),
});

const ProfileUpdatePayload = Schema.Struct({
  participant_id: Schema.String,
  name: Schema.String,
  username: OptionalText,
  display_name: OptionalText,
  avatar_url: OptionalText,
});

const roomServerRules = {
  [GatewayOp.Hello]: { schema: HelloPayload, invalid: "Invalid Hello" },
  [GatewayOp.HeartbeatACK]: null,
  [GatewayOp.MediaReady]: {
    schema: MediaReadyPayload,
    invalid: "Invalid MediaReady",
  },
  [GatewayOp.Ready]: {
    schema: ReadyPayload,
    invalid: "Invalid Ready",
  },
  [GatewayOp.Resumed]: {
    schema: ResumedPayload,
    invalid: "Invalid Resumed",
  },
  [GatewayOp.VoiceStateUpdate]: {
    schema: VoiceStateUpdatePayload,
    invalid: "Invalid VoiceStateUpdate",
  },
  [GatewayOp.ProfileUpdate]: {
    schema: ProfileUpdatePayload,
    invalid: "Invalid ProfileUpdate",
  },
  [GatewayOp.Error]: { schema: ErrorPayload, invalid: "Invalid Error" },
} as const satisfies PayloadRules;

export const decodeRoomServerFrame = compilePayloadDecoder(roomServerRules);
export type RoomServerMessage = DecodedMessage<typeof roomServerRules>;

// ── Voice socket (VoiceRoom, /api/channels/:slug/voice) ─────────────────────

const VoiceReadyPayload = Schema.Struct({
  tracks: Schema.optional(TrackInfos),
  speaking: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
});

const VideoPayload = Schema.Struct({
  participant_id: Schema.String,
  tracks: TrackInfos,
});

const SpeakingPayload = Schema.Struct({
  participant_id: Schema.String,
  speaking: Schema.Number,
});

const ClientDisconnectPayload = Schema.Struct({
  participant_id: Schema.String,
});

const StopTracksPayload = Schema.Struct({
  track_names: Schema.Array(Schema.String),
  tracks: Schema.optional(TrackInfos),
});

/**
 * VoiceAppEvent (106): a lightweight session event the voice room relays to
 * every participant, the sender included (realtime/voice-room.ts
 * handleVoiceAppEvent). Only the envelope is checked here; the soundboard
 * decodes the events it knows (features/soundboard/events.ts).
 */
const VoiceAppEventPayload = Schema.Record(Schema.String, Schema.Unknown);
export type VoiceAppEvent = typeof VoiceAppEventPayload.Type;

/** Push this publication again under a new SFU track (listeners cannot pull it). */
const RepublishRequestPayload = Schema.Struct({
  track_name: Schema.String,
  sfu_track_name: Schema.optional(Schema.String),
  session_id: Schema.optional(Schema.String),
});
export type RepublishRequest = typeof RepublishRequestPayload.Type;

const voiceServerRules = {
  [GatewayOp.Hello]: { schema: HelloPayload, invalid: "Invalid Hello" },
  [GatewayOp.HeartbeatACK]: null,
  [GatewayOp.VoiceReady]: {
    schema: VoiceReadyPayload,
    invalid: "Invalid VoiceReady",
  },
  [GatewayOp.Video]: { schema: VideoPayload, invalid: "Invalid Video" },
  [GatewayOp.Speaking]: {
    schema: SpeakingPayload,
    invalid: "Invalid Speaking",
  },
  [GatewayOp.ClientDisconnect]: {
    schema: ClientDisconnectPayload,
    invalid: "Invalid ClientDisconnect",
  },
  [GatewayOp.StopTracks]: {
    schema: StopTracksPayload,
    invalid: "Invalid StopTracks",
  },
  [GatewayOp.RepublishRequest]: {
    schema: RepublishRequestPayload,
    invalid: "Invalid RepublishRequest",
  },
  [GatewayOp.VoiceAppEvent]: {
    schema: VoiceAppEventPayload,
    invalid: "Invalid VoiceAppEvent",
  },
  [GatewayOp.Error]: { schema: ErrorPayload, invalid: "Invalid Error" },
} as const satisfies PayloadRules;

export const decodeVoiceServerFrame = compilePayloadDecoder(voiceServerRules);
export type VoiceServerMessage = DecodedMessage<typeof voiceServerRules>;

/** Bit 0 of the Speaking flags: microphone audio (src/lib/types.ts SpeakingFlags). */
export const SPEAKING_MICROPHONE = 1;

/** The voice room's slug for a server voice channel (buildVoiceChannelRoomSlug). */
export function voiceRoomSlug(serverId: string, channelId: string): string {
  return `voice-${serverId}-${channelId}`;
}

/** A DM call's room: both user ids, sorted, as the server names it. */
export function dmCallRoomSlug(userId: string, peerId: string): string {
  const [a, b] = [userId, peerId].sort();
  return `dm-call-${a}-${b}`;
}
