// ── Client → server payloads ────────────────────────────────────────────────
// What each Durable Object accepts in `d`, per opcode. The DOs check `d`
// against these at the socket edge (see codec.ts) and hand the handler a
// typed value; a payload that fails gets an Error frame with the rule's
// `invalid` message and code 4000, as the ad-hoc checks did before.
//
// Compatibility rules for editing this file (old clients keep talking to new
// Durable Objects during a deploy, and the other way round):
// - Never reject an unknown key. `Schema.Struct` with `Schema.is` only checks
//   the keys it declares; the handler gets the original object.
// - Never make an optional field required, and keep nullability as wide as
//   the handler tolerates.
// - Declare only what the handler reads. TypeScript then rejects a handler
//   that reads a field this file does not check.
// - Rules that need server state (permissions, the participant id, a DB row)
//   stay in the handler.

import { Schema } from "effect";
import { GatewayOp } from "./opcodes";
import type { PayloadRules } from "./codec";

// ── Limits shared with the handlers ────────────────────────────────────────

const MAX_NEGOTIATION_TRACKS = 32;
const MAX_SDP_LENGTH = 1_000_000;
const MAX_TRACK_ID_LENGTH = 200;
const MAX_SFU_SESSION_ID_LENGTH = 4_096;
const MAX_MID_LENGTH = 64;

const NullableString = Schema.NullOr(Schema.String);
const TrackKind = Schema.Literals(["audio", "video"]);
const TrackId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_TRACK_ID_LENGTH),
);
const Mid = Schema.String.check(Schema.isMaxLength(MAX_MID_LENGTH));

// ── Main gateway (MeetingRoom) ─────────────────────────────────────────────

const IdentifyPayload = Schema.Struct({
  name: Schema.String,
  username: Schema.optional(NullableString),
  display_name: Schema.optional(NullableString),
  avatar_url: Schema.optional(NullableString),
  /** A string or an AvatarDisplay object; the room stores what it gets. */
  avatar_display: Schema.optional(
    Schema.NullOr(
      Schema.Union([
        Schema.String,
        Schema.Record(Schema.String, Schema.Unknown),
      ]),
    ),
  ),
  /** Normalized by the server; unknown values fall back to "web". */
  platform: Schema.optional(Schema.Unknown),
  supports_voice_state_deltas: Schema.optional(Schema.Boolean),
  standby: Schema.optional(Schema.Boolean),
});

const ResumePayload = Schema.Struct({
  session_id: Schema.String,
  seq_ack: Schema.Number,
});

const VoiceStateUpdateClientPayload = Schema.Struct({
  self_mute: Schema.optional(Schema.Boolean),
  self_deaf: Schema.optional(Schema.Boolean),
  self_video: Schema.optional(Schema.Boolean),
  self_stream: Schema.optional(Schema.Boolean),
  self_stream_audio: Schema.optional(Schema.Boolean),
  stream_preview_url: Schema.optional(NullableString),
  spatial_audio_enabled: Schema.optional(Schema.Boolean),
  spatial_audio_high_fidelity: Schema.optional(Schema.Boolean),
  /** Shape-checked by the room (isSpatialAudioState); ignored when invalid. */
  spatial_audio_state: Schema.optional(Schema.Unknown),
  promote_standby: Schema.optional(Schema.Boolean),
});

const MessageCreatePayload = Schema.Struct({
  channel_id: Schema.String,
  content: Schema.String,
  reply_to_id: Schema.optional(Schema.String),
  nonce: Schema.optional(Schema.String),
});

const MessageUpdatePayload = Schema.Struct({
  message_id: Schema.String,
  content: Schema.String,
});

const MessageDeletePayload = Schema.Struct({
  message_id: Schema.String,
  channel_id: Schema.String,
});

const ChannelPayload = Schema.Struct({ channel_id: Schema.String });

const ReactionPayload = Schema.Struct({
  channel_id: Schema.String,
  message_id: Schema.String,
  emoji: Schema.String,
});

/** Validated against the known statuses by the room; others are ignored. */
const PresenceUpdateClientPayload = Schema.Struct({
  status: Schema.String,
});

const VoiceChannelJoinPayload = Schema.Struct({
  channel_id: Schema.String,
  self_mute: Schema.optional(Schema.Boolean),
  /** Normalized by the room; out-of-range values are replaced. */
  started_at: Schema.optional(Schema.Unknown),
});

/**
 * Clients name the channel they are leaving so a late leave for an old
 * channel cannot drop them from the one they joined since. A leave without
 * a channel (the forced disconnect sends `{}`) applies to the current one.
 */
const VoiceChannelLeavePayload = Schema.Struct({
  channel_id: Schema.optional(Schema.String),
});

const ServerSubscribePayload = Schema.Struct({
  server_id: Schema.String,
});

const CallInitiatePayload = Schema.Struct({
  target_user_id: Schema.String,
  channel_id: Schema.String,
});

const CallIdPayload = Schema.Struct({ call_id: Schema.String });

/**
 * Every client opcode the main gateway handles. `null`: the payload is not
 * read and not decoded (Heartbeat stays on the cheapest path). Any other
 * opcode is answered with "Unknown opcode".
 */
export const mainGatewayClientRules = {
  [GatewayOp.Identify]: {
    schema: IdentifyPayload,
    invalid: "Invalid identify payload",
  },
  [GatewayOp.Heartbeat]: null,
  [GatewayOp.Resume]: {
    schema: ResumePayload,
    invalid: "Invalid resume payload",
  },
  [GatewayOp.RefreshVoiceCredentials]: null,
  [GatewayOp.VoiceStateUpdate]: {
    schema: VoiceStateUpdateClientPayload,
    invalid: "Invalid voice state payload",
  },
  [GatewayOp.ProfileRefresh]: null,
  [GatewayOp.ClientDisconnect]: null,
  [GatewayOp.MessageCreate]: {
    schema: MessageCreatePayload,
    invalid: "Invalid message payload",
  },
  [GatewayOp.MessageUpdate]: {
    schema: MessageUpdatePayload,
    invalid: "Invalid message payload",
  },
  [GatewayOp.MessageDelete]: {
    schema: MessageDeletePayload,
    invalid: "Invalid message payload",
  },
  [GatewayOp.TypingStart]: {
    schema: ChannelPayload,
    invalid: "Invalid typing payload",
  },
  [GatewayOp.ReactionAdd]: {
    schema: ReactionPayload,
    invalid: "Invalid reaction payload",
  },
  [GatewayOp.ReactionRemove]: {
    schema: ReactionPayload,
    invalid: "Invalid reaction payload",
  },
  [GatewayOp.ChannelSubscribe]: {
    schema: ChannelPayload,
    invalid: "Invalid channel payload",
  },
  [GatewayOp.ChannelUnsubscribe]: {
    schema: ChannelPayload,
    invalid: "Invalid channel payload",
  },
  [GatewayOp.PresenceUpdate]: {
    schema: PresenceUpdateClientPayload,
    invalid: "Invalid presence payload",
  },
  [GatewayOp.VoiceChannelJoin]: {
    schema: VoiceChannelJoinPayload,
    invalid: "Invalid voice channel payload",
  },
  [GatewayOp.VoiceChannelLeave]: {
    schema: VoiceChannelLeavePayload,
    invalid: "Invalid voice channel payload",
  },
  [GatewayOp.ServerSubscribe]: {
    schema: ServerSubscribePayload,
    invalid: "Invalid server payload",
  },
  [GatewayOp.CallInitiate]: {
    schema: CallInitiatePayload,
    invalid: "Invalid call payload",
  },
  [GatewayOp.CallAccept]: {
    schema: CallIdPayload,
    invalid: "Invalid call payload",
  },
  [GatewayOp.CallDecline]: {
    schema: CallIdPayload,
    invalid: "Invalid call payload",
  },
  [GatewayOp.CallEnd]: {
    schema: CallIdPayload,
    invalid: "Invalid call payload",
  },
} as const satisfies PayloadRules;

// ── Voice gateway (VoiceRoom) ──────────────────────────────────────────────

const VoiceIdentifyPayload = Schema.Struct({
  participant_id: Schema.String,
  voice_token: Schema.String,
  /** Opt-in flag; anything but `true` means "not supported". */
  supports_listen_together_snapshot_events: Schema.optional(Schema.Unknown),
});

/** A published track as a client announces it (Video, op 12). */
const TrackInfoWire = Schema.Struct({
  participant_id: TrackId,
  track_name: TrackId,
  sfu_track_name: Schema.optional(TrackId),
  session_id: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_SFU_SESSION_ID_LENGTH),
  ),
  mid: Schema.optional(Mid),
  kind: TrackKind,
}).check(
  // Only PartyTracks (sfu_track_name) session ids may be long.
  Schema.makeFilter(
    (track) =>
      track.sfu_track_name !== undefined ||
      track.session_id.length <= MAX_TRACK_ID_LENGTH,
  ),
);

const TrackNames = Schema.mutable(Schema.Array(TrackId)).check(
  Schema.isMaxLength(MAX_NEGOTIATION_TRACKS),
);

const VideoClientPayload = Schema.Struct({
  tracks: Schema.mutable(Schema.Array(TrackInfoWire)).check(
    Schema.isMaxLength(MAX_NEGOTIATION_TRACKS),
  ),
});

const TrackNamesPayload = Schema.Struct({ track_names: TrackNames });

const SpeakingClientPayload = Schema.Struct({ speaking: Schema.Finite });

const PushTrackDescriptor = Schema.Struct({
  track_name: Schema.String.check(Schema.isMaxLength(MAX_TRACK_ID_LENGTH)),
  mid: Schema.optional(Mid),
  kind: TrackKind,
});

/**
 * The native screen publisher's push-only offer. The room also checks that
 * the SDP is not blank and every track is `screen-…-<participant id>` and
 * unique, which needs the socket's participant id.
 */
const SelectProtocolPayload = Schema.Struct({
  sdp: Schema.String.check(Schema.isMaxLength(MAX_SDP_LENGTH)),
  push_prefix: Schema.Literal("screen"),
  /** Browser SFU offers set this; native screen offers never do. */
  media_mode: Schema.optional(Schema.Undefined),
  push_tracks: Schema.mutable(Schema.Array(PushTrackDescriptor)).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_NEGOTIATION_TRACKS),
  ),
  pull_tracks: Schema.mutable(Schema.Tuple([])),
  request_id: Schema.optional(TrackId),
});

/**
 * A listener reporting a publication the SFU does not find. The room checks
 * it against its own track row before asking the publisher to republish.
 */
const TrackUnavailablePayload = Schema.Struct({
  participant_id: TrackId,
  track_name: TrackId,
  session_id: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_SFU_SESSION_ID_LENGTH),
  ),
  sfu_track_name: Schema.optional(TrackId),
});

/** App events are routed by `type` inside the room; only the envelope is checked here. */
const VoiceAppEventPayload = Schema.Record(Schema.String, Schema.Unknown);

/** The reply to a SelectProtocol that fails its schema. */
const BROWSER_SFU_UNSUPPORTED = "Browser SFU negotiation is unsupported";

export const voiceGatewayClientRules = {
  [GatewayOp.VoiceIdentify]: {
    schema: VoiceIdentifyPayload,
    invalid: "Invalid voice identify payload",
  },
  [GatewayOp.Heartbeat]: null,
  [GatewayOp.SelectProtocol]: {
    schema: SelectProtocolPayload,
    invalid: BROWSER_SFU_UNSUPPORTED,
  },
  [GatewayOp.Video]: {
    schema: VideoClientPayload,
    invalid: "Invalid video payload",
  },
  [GatewayOp.StopTracks]: {
    schema: TrackNamesPayload,
    invalid: "Invalid stop tracks payload",
  },
  [GatewayOp.TracksReady]: {
    schema: TrackNamesPayload,
    invalid: "Invalid tracks ready payload",
  },
  [GatewayOp.Speaking]: {
    schema: SpeakingClientPayload,
    invalid: "Invalid speaking payload",
  },
  [GatewayOp.ClientDisconnect]: null,
  [GatewayOp.VoiceAppEvent]: {
    schema: VoiceAppEventPayload,
    invalid: "Voice app event payload must be a plain object",
  },
  [GatewayOp.TrackUnavailable]: {
    schema: TrackUnavailablePayload,
    invalid: "Invalid track unavailable payload",
  },
} as const satisfies PayloadRules;

// ── Payload types ──────────────────────────────────────────────────────────

type IdentifyPayload = typeof IdentifyPayload.Type;
type ResumePayload = typeof ResumePayload.Type;
type VoiceStateUpdateClientPayload = typeof VoiceStateUpdateClientPayload.Type;
type MessageCreatePayload = typeof MessageCreatePayload.Type;
type MessageUpdatePayload = typeof MessageUpdatePayload.Type;
type MessageDeletePayload = typeof MessageDeletePayload.Type;
type ChannelPayload = typeof ChannelPayload.Type;
type ReactionPayload = typeof ReactionPayload.Type;
type PresenceUpdateClientPayload = typeof PresenceUpdateClientPayload.Type;
type VoiceChannelJoinPayload = typeof VoiceChannelJoinPayload.Type;
type VoiceChannelLeavePayload = typeof VoiceChannelLeavePayload.Type;
type ServerSubscribePayload = typeof ServerSubscribePayload.Type;
type CallInitiatePayload = typeof CallInitiatePayload.Type;
type CallIdPayload = typeof CallIdPayload.Type;
type VoiceIdentifyPayload = typeof VoiceIdentifyPayload.Type;
type TrackInfoWire = typeof TrackInfoWire.Type;
type VideoClientPayload = typeof VideoClientPayload.Type;
type TrackNamesPayload = typeof TrackNamesPayload.Type;
type SpeakingClientPayload = typeof SpeakingClientPayload.Type;
type PushTrackDescriptor = typeof PushTrackDescriptor.Type;
type SelectProtocolPayload = typeof SelectProtocolPayload.Type;
type VoiceAppEventPayload = typeof VoiceAppEventPayload.Type;
type TrackUnavailablePayload = typeof TrackUnavailablePayload.Type;
