// ── Server → client payloads ────────────────────────────────────────────────
// What the browser gateways accept in `d`, per opcode. Clients check frames
// against these at the socket edge (see codec.ts); a frame that fails is
// logged and dropped, an opcode a client does not know is ignored.
//
// These are deliberately looser than what the Durable Objects send: a field
// is required only when the client reads it without a fallback. Nested domain
// objects (VoiceState, TrackInfo, IceServer, spatial audio state, Dispatch
// data) are checked only to be objects; their shape is the server's to keep.
// Extra keys are never rejected, and the client receives the original object.

import { Schema } from "effect";
import type {
  IceServer,
  TrackInfo,
  VoiceState,
  VoiceStateDelta,
} from "../types";
import type { SharedSpatialAudioState } from "../voice/spatial-audio";
import { GatewayOp } from "./opcodes";
import type { PayloadRules } from "./codec";

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A nested object the client trusts the server to shape. Only "is a non-array
 * object" (and, with `idKey`, "has that string key") is checked; `T` is the
 * static type clients already use for it.
 */
function serverObject<T extends object>(identifier: string, idKey?: string) {
  return Schema.declare(
    (value: unknown): value is T =>
      isObject(value) &&
      (idKey === undefined ||
        typeof (value as Record<string, unknown>)[idKey] === "string"),
    { identifier },
  );
}

const IceServerObject = serverObject<IceServer>("IceServer");
const TrackInfoObject = serverObject<TrackInfo>("TrackInfo");
const VoiceStateObject = serverObject<VoiceState>("VoiceState", "id");
const VoiceStateOrDeltaObject = serverObject<VoiceState | VoiceStateDelta>(
  "VoiceStateOrDelta",
  "id",
);
const SpatialAudioStateObject = serverObject<SharedSpatialAudioState>(
  "SharedSpatialAudioState",
);

const IceServers = Schema.mutable(Schema.Array(IceServerObject));
const TrackInfos = Schema.mutable(Schema.Array(TrackInfoObject));
const VoiceStates = Schema.mutable(Schema.Array(VoiceStateObject));
const NullableString = Schema.NullOr(Schema.String);

// ── Both gateways ──────────────────────────────────────────────────────────

/** Used when a Hello carries no interval (no current server omits it). */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 45_000;

const HelloPayload = Schema.Struct({
  heartbeat_interval: Schema.optional(Schema.Finite),
  gateway_version: Schema.optional(Schema.Unknown),
});

const ErrorPayload = Schema.Struct({
  code: Schema.Number,
  message: Schema.String,
  /** Native screen-share errors only. */
  request_id: Schema.optional(Schema.String),
  operation: Schema.optional(Schema.Literal("push")),
  push_prefix: Schema.optional(Schema.Literal("screen")),
});

// ── Main gateway (MeetingRoom) ─────────────────────────────────────────────

const MediaReadyPayload = Schema.Struct({
  participant_id: Schema.String,
  ice_servers: IceServers,
  voice_token: Schema.String,
});

const ReadyPayload = Schema.Struct({
  participant_id: Schema.String,
  ice_servers: IceServers,
  voice_token: Schema.String,
  participants: Schema.optional(VoiceStates),
  heartbeat_interval: Schema.optional(Schema.Unknown),
  spatial_audio_state: Schema.optional(SpatialAudioStateObject),
});

const ResumedPayload = Schema.Struct({
  /** Fresh voice token for re-authenticating on the Voice Gateway */
  voice_token: Schema.optional(Schema.String),
  /** Fresh ICE/TURN credentials to apply to existing PeerConnections */
  ice_servers: Schema.optional(IceServers),
  /** Current room participants for hibernation/reconnect reconciliation */
  participants: Schema.optional(VoiceStates),
  spatial_audio_state: Schema.optional(SpatialAudioStateObject),
});

/** Join and leave carry a full VoiceState; update may carry a delta. */
const VoiceStateUpdatePayload = Schema.Union([
  Schema.Struct({
    participant: VoiceStateObject,
    action: Schema.Literals(["join", "leave"]),
    spatial_audio_state: Schema.optional(SpatialAudioStateObject),
  }),
  Schema.Struct({
    participant: VoiceStateOrDeltaObject,
    action: Schema.Literal("update"),
    spatial_audio_state: Schema.optional(SpatialAudioStateObject),
  }),
]);

const ProfileUpdatePayload = Schema.Struct({
  participant_id: Schema.String,
  name: Schema.String,
  username: Schema.optional(NullableString),
  display_name: Schema.optional(NullableString),
  avatar_url: Schema.optional(NullableString),
  avatar_display: Schema.optional(NullableString),
});

/** The event payload is routed by `event` in the chat store, not checked here. */
const DispatchPayload = Schema.Struct({
  event: Schema.String,
  data: Schema.optional(Schema.Unknown),
  /** Replay cursor; also read generically by readReplaySeq. */
  seq: Schema.optional(Schema.Number),
});

/** The chat store reads only the session id from Ready. */
const ChatReadyPayload = Schema.Struct({
  participant_id: Schema.optional(Schema.String),
});

/**
 * Server opcodes the chat store handles on /api/gateway. `null`: the payload
 * is not decoded (HeartbeatACK may arrive with no `d`; Resumed is not read).
 */
export const chatGatewayServerRules = {
  [GatewayOp.Hello]: { schema: HelloPayload, invalid: "Invalid Hello" },
  [GatewayOp.HeartbeatACK]: null,
  [GatewayOp.Ready]: { schema: ChatReadyPayload, invalid: "Invalid Ready" },
  [GatewayOp.Resumed]: null,
  [GatewayOp.Error]: { schema: ErrorPayload, invalid: "Invalid Error" },
  [GatewayOp.Dispatch]: {
    schema: DispatchPayload,
    invalid: "Invalid Dispatch",
  },
} as const satisfies PayloadRules;

/** Server opcodes RoomGateway handles (MeetingRoom, room or global socket). */
export const roomGatewayServerRules = {
  [GatewayOp.Hello]: { schema: HelloPayload, invalid: "Invalid Hello" },
  [GatewayOp.HeartbeatACK]: null,
  [GatewayOp.MediaReady]: {
    schema: MediaReadyPayload,
    invalid: "Invalid MediaReady",
  },
  [GatewayOp.Ready]: { schema: ReadyPayload, invalid: "Invalid Ready" },
  [GatewayOp.Resumed]: { schema: ResumedPayload, invalid: "Invalid Resumed" },
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

// ── Voice gateway (VoiceRoom) ──────────────────────────────────────────────

const VoiceReadyPayload = Schema.Struct({
  participant_id: Schema.optional(Schema.String),
  tracks: Schema.optional(TrackInfos),
  speaking: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
});

export const SessionDescriptionPayload = Schema.Struct({
  sdp: Schema.String,
  session_id: Schema.String,
  tracks: TrackInfos,
  sdp_type: Schema.Literal("answer"),
  request_id: Schema.optional(Schema.String),
  operation: Schema.Literal("push"),
  push_prefix: Schema.Literal("screen"),
});

export const NegotiationDonePayload = Schema.Struct({
  session_id: Schema.String,
  request_id: Schema.optional(Schema.String),
  operation: Schema.Literal("push"),
  push_prefix: Schema.Literal("screen"),
});

const VideoServerPayload = Schema.Struct({
  participant_id: Schema.String,
  tracks: TrackInfos,
});

const SpeakingServerPayload = Schema.Struct({
  participant_id: Schema.String,
  speaking: Schema.Number,
});

export const ClientDisconnectPayload = Schema.Struct({
  participant_id: Schema.String,
});

const StopTracksServerPayload = Schema.Struct({
  participant_id: Schema.optional(Schema.String),
  track_names: Schema.mutable(Schema.Array(Schema.String)),
  tracks: Schema.optional(TrackInfos),
});

const VoiceAppEventServerPayload = Schema.Record(Schema.String, Schema.Unknown);

/**
 * Names the publication to push again. The SFU track and session are the ones
 * listeners failed to pull; a publisher that has moved on ignores the request.
 */
export const RepublishRequestPayload = Schema.Struct({
  track_name: Schema.String,
  sfu_track_name: Schema.optional(Schema.String),
  session_id: Schema.optional(Schema.String),
});

/** Server opcodes VoiceGateway handles. */
export const voiceGatewayServerRules = {
  [GatewayOp.Hello]: { schema: HelloPayload, invalid: "Invalid Hello" },
  [GatewayOp.HeartbeatACK]: null,
  [GatewayOp.VoiceReady]: {
    schema: VoiceReadyPayload,
    invalid: "Invalid VoiceReady",
  },
  [GatewayOp.SessionDescription]: {
    schema: SessionDescriptionPayload,
    invalid: "Invalid SessionDescription",
  },
  [GatewayOp.NegotiationDone]: {
    schema: NegotiationDonePayload,
    invalid: "Invalid NegotiationDone",
  },
  [GatewayOp.Video]: { schema: VideoServerPayload, invalid: "Invalid Video" },
  [GatewayOp.Error]: { schema: ErrorPayload, invalid: "Invalid Error" },
  [GatewayOp.Speaking]: {
    schema: SpeakingServerPayload,
    invalid: "Invalid Speaking",
  },
  [GatewayOp.ClientDisconnect]: {
    schema: ClientDisconnectPayload,
    invalid: "Invalid ClientDisconnect",
  },
  [GatewayOp.StopTracks]: {
    schema: StopTracksServerPayload,
    invalid: "Invalid StopTracks",
  },
  [GatewayOp.VoiceAppEvent]: {
    schema: VoiceAppEventServerPayload,
    invalid: "Invalid VoiceAppEvent",
  },
  [GatewayOp.RepublishRequest]: {
    schema: RepublishRequestPayload,
    invalid: "Invalid RepublishRequest",
  },
} as const satisfies PayloadRules;

// ── Payload types ──────────────────────────────────────────────────────────

type HelloPayload = typeof HelloPayload.Type;
type ErrorPayload = typeof ErrorPayload.Type;
type MediaReadyPayload = typeof MediaReadyPayload.Type;
type ReadyPayload = typeof ReadyPayload.Type;
type ResumedPayload = typeof ResumedPayload.Type;
type VoiceStateUpdatePayload = typeof VoiceStateUpdatePayload.Type;
type ProfileUpdatePayload = typeof ProfileUpdatePayload.Type;
type DispatchPayload = typeof DispatchPayload.Type;
type ChatReadyPayload = typeof ChatReadyPayload.Type;
type VoiceReadyPayload = typeof VoiceReadyPayload.Type;
export type SessionDescriptionPayload = typeof SessionDescriptionPayload.Type;
export type NegotiationDonePayload = typeof NegotiationDonePayload.Type;
type VideoServerPayload = typeof VideoServerPayload.Type;
type SpeakingServerPayload = typeof SpeakingServerPayload.Type;
export type ClientDisconnectPayload = typeof ClientDisconnectPayload.Type;
type StopTracksServerPayload = typeof StopTracksServerPayload.Type;
type VoiceAppEventServerPayload = typeof VoiceAppEventServerPayload.Type;
export type RepublishRequestPayload = typeof RepublishRequestPayload.Type;
