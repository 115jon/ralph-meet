// ── Gateway opcodes and codes ───────────────────────────────────────────────
// One numeric opcode space shared by the two gateway sockets:
//
// - the main gateway (MeetingRoom DO): chat, presence, calls and the room
//   roster. The chat store and RoomGateway both speak it (/api/gateway and
//   /api/channels/:slug/ws).
// - the voice gateway (VoiceRoom DO): media metadata, speaking and app events.
//   VoiceGateway speaks it.
//
// The two sockets accept different subsets of client opcodes (see
// client-payloads.ts), but a number never means two things, so one enum is
// the honest model. This file has no imports: the Workers and the browser
// bundle both load it.

export enum GatewayOp {
  /** C→S main: Initial identification (join room) */
  Identify = 0,
  /** C→S voice: Native Rust screen-share SDP offer */
  SelectProtocol = 1,
  /** S→C main: Confirm identification, send ICE/TURN config + roster */
  Ready = 2,
  /** C→S both: Heartbeat keepalive. Sent raw as HEARTBEAT_FRAME. */
  Heartbeat = 3,
  /** S→C voice: Native screen-share SDP answer from the SFU */
  SessionDescription = 4,
  /** C↔S voice: Speaking state with bitfield flags */
  Speaking = 5,
  /** S→C both: Heartbeat acknowledgement */
  HeartbeatACK = 6,
  /** C→S main: Resume a previous session after reconnect */
  Resume = 7,
  /** S→C both: First message after WS connect — contains heartbeat_interval */
  Hello = 8,
  /** S→C main: Confirm session resume success */
  Resumed = 9,
  /** S→C voice: Native screen-share negotiation completed on the SFU */
  NegotiationDone = 10,
  /** C↔S both: Graceful disconnect (S→C on voice: a participant left) */
  ClientDisconnect = 11,
  /** C↔S voice: PartyTracks publication metadata */
  Video = 12,
  /** C↔S voice: Stop/remove tracks */
  StopTracks = 13,
  /** C↔S main: Voice state (C→S mute/camera changes, S→C join/leave/update) */
  VoiceStateUpdate = 15,
  /** S→C main: Profile info broadcast */
  ProfileUpdate = 16,
  /** C→S main: Request server to re-fetch verified profile */
  ProfileRefresh = 17,
  /** S→C both: Error */
  Error = 18,

  // ── Chat opcodes (19–32) ──────────────────────────────────────────

  /** S→C: Dispatch event (MESSAGE_CREATE, TYPING_START, etc.) */
  Dispatch = 19,
  /** C→S: Send a chat message */
  MessageCreate = 20,
  /** C→S: Edit a message */
  MessageUpdate = 21,
  /** C→S: Delete a message */
  MessageDelete = 22,
  /** C→S: Typing indicator */
  TypingStart = 23,
  /** C→S: Add reaction */
  ReactionAdd = 24,
  /** C→S: Remove reaction */
  ReactionRemove = 25,
  /** C→S: Set own presence (S→C presence goes out as a Dispatch) */
  PresenceUpdate = 26,
  /** C→S: Subscribe to a channel's events */
  ChannelSubscribe = 27,
  /** C→S: Unsubscribe from a channel */
  ChannelUnsubscribe = 28,
  /** S→C: Channel updated */
  ChannelUpdate = 29,
  /** S→C: Channel deleted */
  ChannelDelete = 30,
  /** S→C: Server member add/remove/update */
  GuildMemberUpdate = 31,
  /** S→C: Relationship update (friend request, etc.) */
  RelationshipUpdate = 32,

  // ── Voice channel sidebar opcodes (33–35) ─────────────────────────

  /** C→S: Join a voice channel */
  VoiceChannelJoin = 33,
  /** C→S: Leave a voice channel */
  VoiceChannelLeave = 34,
  /** C→S: Subscribe to server events */
  ServerSubscribe = 35,

  // ── Call opcodes (36–41) ───────────────────────────────────────────

  /** C→S: Initiate a 1:1 call */
  CallInitiate = 36,
  /** C→S: Accept an incoming call */
  CallAccept = 37,
  /** C→S: Decline an incoming call */
  CallDecline = 38,
  /** C→S: End an active call or cancel an outgoing ring */
  CallEnd = 39,
  /** C→S: Refresh voice token and TURN credentials without reconnecting RoomGW */
  RefreshVoiceCredentials = 40,
  /** S→C: Media credentials before full room/profile Ready */
  MediaReady = 41,

  // ── Voice Gateway specific (100+) ─────────────────────────────────

  /** C→S: Authenticate on Voice Gateway with token from Main GW */
  VoiceIdentify = 100,
  /** S→C: Voice Gateway confirm authentication */
  VoiceReady = 101,
  /** C→S: Native Rust publisher confirms screen tracks are flowing */
  TracksReady = 102,
  /** C<->S: Lightweight voice-session app events (activities, soundboard) */
  VoiceAppEvent = 106,
}

/**
 * Opcodes of the retired browser SFU negotiation (14, 103-105, 107, 108).
 * Old builds may still send them; the voice gateway answers each with
 * "Browser SFU negotiation is unsupported" instead of "Unknown opcode".
 */
export const RETIRED_BROWSER_SFU_OPS: ReadonlySet<number> = new Set([
  14, 103, 104, 105, 107, 108,
]);

/**
 * The heartbeat exactly as clients send it: no `d`, no extra fields, no
 * whitespace. Keep it byte-stable; heartbeats are never schema-decoded.
 */
export const HEARTBEAT_FRAME = '{"op":3}';

/**
 * Codes carried in `Error` frames (`d.code`) and, for some, as WebSocket close
 * codes. Clients compare against these, never against message text.
 */
export enum GatewayCloseCode {
  /** Bad request: a payload failed validation or a business rule. */
  InvalidPayload = 4000,
  /** Missing, non-numeric or unknown opcode. */
  UnknownOpcode = 4001,
  /** The frame is not JSON. */
  InvalidJson = 4002,
  /** Not identified, not allowed, or unavailable for this access mode. */
  NotAuthenticated = 4003,
  /** Voice token rejected; also "not found" replies on the main gateway. */
  AuthenticationFailed = 4004,
  AlreadyAuthenticated = 4005,
  /** Resume impossible (unknown session or continuity lost): Identify again. */
  SessionInvalid = 4006,
  /** Realtime admission rejected: the client must not reconnect. */
  AdmissionRejected = 4008,
  SessionTimeout = 4009,
  ServerNotFound = 4014,
  UnknownProtocol = 4015,
  /** Per-opcode rate limit exceeded. */
  RateLimited = 4290,
}
