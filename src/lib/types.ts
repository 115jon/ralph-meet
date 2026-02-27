// ============================================================================
// Discord-Style Voice Gateway Protocol — Type Definitions
//
// Opcode-based signaling protocol inspired by Discord's Voice Gateway.
// All messages follow the shape: { op: number, d: payload }
// ============================================================================

// ── Opcodes ─────────────────────────────────────────────────────────────────

export enum VoiceOpcode {
  /** C→S: Initial identification (join room) */
  Identify = 0,
  /** C→S: SDP offer for push/pull tracks */
  SelectProtocol = 1,
  /** S→C: Confirm identification, send ICE/TURN config + roster */
  Ready = 2,
  /** C→S: Heartbeat keepalive */
  Heartbeat = 3,
  /** S→C: SDP answer/offer from the SFU */
  SessionDescription = 4,
  /** C↔S: Speaking state with bitfield flags */
  Speaking = 5,
  /** S→C: Heartbeat acknowledgement */
  HeartbeatACK = 6,
  /** C→S: Resume a previous session after reconnect */
  Resume = 7,
  /** S→C: First message after WS connect — contains heartbeat_interval */
  Hello = 8,
  /** S→C: Confirm session resume success */
  Resumed = 9,
  /** S→C: Notification that a negotiation has completed on SFU */
  NegotiationDone = 10,
  /** C→S: Graceful disconnect */
  ClientDisconnect = 11,
  /** C↔S: Video/track subscription (pull request or track publish notification) */
  Video = 12,
  /** C↔S: Stop/remove tracks */
  StopTracks = 13,
  /** C→S: SDP answer for pull renegotiation */
  Answer = 14,
  /** S→C: Participant join/leave notification */
  VoiceStateUpdate = 15,
  /** S→C: Profile info broadcast */
  ProfileUpdate = 16,
  /** C→S: Request server to re-fetch verified profile */
  ProfileRefresh = 17,
  /** S→C: Error */
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
  /** S→C: Presence update broadcast */
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

  // ── Voice Gateway specific (100+) ─────────────────────────────────

  /** C→S: Authenticate on Voice Gateway with token from Main GW */
  VoiceIdentify = 100,
  /** S→C: Voice Gateway confirm authentication */
  VoiceReady = 101,
}

// ── Speaking Flags (bitfield) ───────────────────────────────────────────────

export enum SpeakingFlags {
  NONE = 0,
  /** Normal microphone audio */
  MICROPHONE = 1 << 0,
  /** Screen share / soundshare audio */
  SOUNDSHARE = 1 << 1,
  /** Priority speaker */
  PRIORITY = 1 << 2,
  /** Camera video active (custom — Discord uses Voice State Update for this) */
  VIDEO = 1 << 3,
}

// ── Error Codes ─────────────────────────────────────────────────────────────

export enum VoiceCloseCode {
  UnknownOpcode = 4001,
  NotAuthenticated = 4003,
  AlreadyAuthenticated = 4005,
  SessionInvalid = 4006,
  SessionTimeout = 4009,
  ServerNotFound = 4014,
  UnknownProtocol = 4015,
  AuthenticationFailed = 4004,
}

// ── Shared Data Types ───────────────────────────────────────────────────────

/** ICE server configuration for WebRTC */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** Describes a track to push (local → SFU) */
export interface PushTrackDescriptor {
  track_name: string;
  mid?: string;
  kind: "audio" | "video";
  rid?: string;
}

/** Info about a published track on the SFU */
export interface TrackInfo {
  participant_id: string;
  track_name: string;
  session_id: string;
  mid?: string;
  rid?: string;
  kind: "audio" | "video";
  track?: any; // The MediaStreamTrack object
}

/** A participant in the room — Discord-style voice state */
export interface VoiceState {
  id: string;
  clerk_user_id?: string;
  name: string;
  avatar_url?: string;
  self_mute: boolean;
  self_deaf: boolean;
  self_stream: boolean;
  self_stream_audio?: boolean;
  self_video: boolean;
  suppress: boolean;
  status?: "online" | "idle" | "dnd" | "offline";
  custom_status?: string;
  push_session_id?: string;
  pull_session_id?: string;
  tracks: TrackInfo[];
}

// ── Client → Server Payloads ────────────────────────────────────────────────

export interface IdentifyPayload {
  name: string;
  avatar_url?: string;
  clerk_user_id?: string;
}

export interface SelectProtocolPayload {
  sdp?: string;
  push_tracks: PushTrackDescriptor[];
  pull_tracks: TrackInfo[];
}

export interface HeartbeatPayload {
  seq_ack: number;
}

export interface ResumePayload {
  session_id: string;
  seq_ack: number;
}

export interface AnswerPayload {
  sdp: string;
}

export interface SpeakingPayloadClient {
  speaking: number; // SpeakingFlags bitfield
  delay?: number;
  ssrc?: number;
}

export interface VideoPayloadClient {
  tracks: TrackInfo[];
}

export interface StopTracksPayloadClient {
  track_names: string[];
}

// ── Server → Client Payloads ────────────────────────────────────────────────

export interface HelloPayload {
  heartbeat_interval: number;
  gateway_version?: number;
}

export interface ReadyPayload {
  participant_id: string;
  ice_servers: IceServer[];
  participants: VoiceState[];
  heartbeat_interval: number;
  /** Token for authenticating on the Voice Gateway */
  voice_token: string;
}

export interface SessionDescriptionPayload {
  sdp: string;
  session_id: string;
  tracks: TrackInfo[];
  sdp_type: "answer" | "offer";
}

export interface HeartbeatACKPayload {
  seq: number;
}

export interface ResumedPayload { }

export interface SpeakingPayloadServer {
  participant_id: string;
  speaking: number; // SpeakingFlags bitfield
  delay?: number;
  ssrc?: number;
}

export interface VoiceStateUpdatePayload {
  participant: VoiceState;
  action: "join" | "leave" | "update";
}

/** C→S: Client sends mute/camera state changes */
export interface VoiceStateUpdateClientPayload {
  self_mute?: boolean;
  self_deaf?: boolean;
  self_video?: boolean;
  self_stream?: boolean;
  self_stream_audio?: boolean;
}

export interface VideoPayloadServer {
  participant_id: string;
  tracks: TrackInfo[];
}

export interface StopTracksPayloadServer {
  participant_id: string;
  track_names: string[];
}

export interface ProfileUpdatePayload {
  participant_id: string;
  name: string;
  avatar_url?: string;
}

export interface ErrorPayload {
  code: number;
  message: string;
}

/** C→S: Authenticate on Voice Gateway */
export interface VoiceIdentifyPayload {
  participant_id: string;
  voice_token: string;
}

/** S→C: Voice Gateway auth confirmed */
export interface VoiceReadyPayload {
  participant_id: string;
  tracks?: TrackInfo[];
  speaking?: Record<string, number>;
}

// ── Chat Data Types ─────────────────────────────────────────────────────────

/** Dispatch event names (used in Dispatch opcode) */
export type DispatchEvent =
  | "MESSAGE_CREATE"
  | "MESSAGE_UPDATE"
  | "MESSAGE_DELETE"
  | "TYPING_START"
  | "REACTION_ADD"
  | "REACTION_REMOVE"
  | "PRESENCE_UPDATE"
  | "CHANNEL_UPDATE"
  | "CHANNEL_DELETE"
  | "GUILD_MEMBER_ADD"
  | "GUILD_MEMBER_REMOVE"
  | "GUILD_MEMBER_UPDATE"
  | "MESSAGE_PIN"
  | "MESSAGE_UNPIN"
  | "RELATIONSHIP_ADD"
  | "RELATIONSHIP_REMOVE";

/** User object */
export interface User {
  id: string;
  username: string;
  avatar_url?: string;
  bio?: string;
  status?: "online" | "idle" | "dnd" | "offline";
  custom_status?: string;
}

/** Server object */
export interface Server {
  id: string;
  name: string;
  owner_id: string;
  icon_url?: string;
  created_at: string;
}

/** Role object */
export interface Role {
  id: string;
  server_id: string;
  name: string;
  color: string | null;
  permissions: number;
  position: number;
  is_default: boolean;
  created_at: string;
}

/** Server Member object */
export interface ServerMember {
  server_id: string;
  user_id: string;
  joined_at: string;
  roles: Role[];
  user: User;
}

/** Channel object */
export interface Channel {
  id: string;
  server_id?: string;
  name: string;
  description?: string;
  channel_type: "text" | "voice" | "dm";
  category_id?: string;
  position: number;
  created_at: string;
}

/** Category object */
export interface Category {
  id: string;
  server_id: string;
  name: string;
  rank: number;
}

/** Message object */
export interface Message {
  id: string;
  channel_id: string;
  author_id: string;
  author?: User;
  content: string;
  reply_to_id?: string;
  reply_to?: Message;
  is_pinned: boolean;
  created_at: string;
  updated_at?: string;
  attachments?: Attachment[];
  reactions?: Reaction[];
  /** Client-generated nonce for optimistic dedup */
  nonce?: string;
  /** True while the message is still being sent (optimistic) */
  pending?: boolean;
}

/** Attachment object */
export interface Attachment {
  id: string;
  message_id?: string;
  filename: string;
  file_key: string;
  content_type?: string;
  size_bytes: number;
  url?: string;
}

/** Reaction summary for a message */
export interface Reaction {
  emoji: string;
  count: number;
  me: boolean;
  users?: string[];
}

/** Invite object */
export interface Invite {
  code: string;
  server_id: string;
  server?: Server;
  inviter_id: string;
  inviter?: User;
  max_uses?: number;
  uses: number;
  expires_at?: string;
}

/** Relationship object */
export interface Relationship {
  user: User;
  type: number;
  created_at: string;
}



// ── Chat Client → Server Payloads ───────────────────────────────────────────

/** C→S: Send a chat message */
export interface MessageCreatePayload {
  channel_id: string;
  content: string;
  reply_to_id?: string;
  nonce?: string;
}

/** C→S: Edit a message */
export interface MessageUpdatePayload {
  message_id: string;
  content: string;
}

/** C→S: Delete a message */
export interface MessageDeletePayload {
  message_id: string;
  channel_id: string;
}

/** C→S: Typing indicator */
export interface TypingStartPayload {
  channel_id: string;
}

/** C→S: Add reaction */
export interface ReactionAddPayload {
  channel_id: string;
  message_id: string;
  emoji: string;
}

/** C→S: Remove reaction */
export interface ReactionRemovePayload {
  channel_id: string;
  message_id: string;
  emoji: string;
}

/** C→S: Subscribe to channel events */
export interface ChannelSubscribePayload {
  channel_id: string;
}

/** C→S: Unsubscribe from channel events */
export interface ChannelUnsubscribePayload {
  channel_id: string;
}

// ── Chat Server → Client Payloads ───────────────────────────────────────────

/** S→C: Dispatch wrapper */
export interface DispatchPayload {
  event: DispatchEvent;
  data: unknown;
}

/** S→C: Ready payload expanded with chat data */
export interface ChatReadyData {
  user: User;
  servers: Server[];
  channels: Channel[];
  categories: Category[];
  dm_channels: Channel[];
  relationships: Relationship[];
  read_states: Array<{ channel_id: string; last_read_at: string }>;
}

/** S→C: Presence update */
export interface PresenceUpdatePayload {
  user_id: string;
  status: "online" | "idle" | "dnd" | "offline";
  custom_status?: string;
}

/** S→C: Guild member update */
export interface GuildMemberUpdatePayload {
  server_id: string;
  user_id: string;
  user?: User;
  action: "add" | "remove" | "update";
  role?: number;
}

/** S→C: Relationship update */
export interface RelationshipUpdatePayload {
  user_id: string;
  target_user_id: string;
  target_user?: User;
  type: 0 | 1 | 2 | 3;
  action: "add" | "remove";
}

// ── Gateway Message Types ───────────────────────────────────────────────────

export type ClientMessage =
  | { op: VoiceOpcode.Identify; d: IdentifyPayload }
  | { op: VoiceOpcode.SelectProtocol; d: SelectProtocolPayload }
  | { op: VoiceOpcode.Heartbeat; d: HeartbeatPayload }
  | { op: VoiceOpcode.Resume; d: ResumePayload }
  | { op: VoiceOpcode.ClientDisconnect; d: Record<string, never> }
  | { op: VoiceOpcode.Speaking; d: SpeakingPayloadClient }
  | { op: VoiceOpcode.Video; d: VideoPayloadClient }
  | { op: VoiceOpcode.StopTracks; d: StopTracksPayloadClient }
  | { op: VoiceOpcode.Answer; d: AnswerPayload }
  | { op: VoiceOpcode.ProfileRefresh; d: Record<string, never> }
  | { op: VoiceOpcode.VoiceIdentify; d: VoiceIdentifyPayload }
  | { op: VoiceOpcode.VoiceStateUpdate; d: VoiceStateUpdateClientPayload }
  // Chat opcodes
  | { op: VoiceOpcode.MessageCreate; d: MessageCreatePayload }
  | { op: VoiceOpcode.MessageUpdate; d: MessageUpdatePayload }
  | { op: VoiceOpcode.MessageDelete; d: MessageDeletePayload }
  | { op: VoiceOpcode.TypingStart; d: TypingStartPayload }
  | { op: VoiceOpcode.ReactionAdd; d: ReactionAddPayload }
  | { op: VoiceOpcode.ReactionRemove; d: ReactionRemovePayload }
  | { op: VoiceOpcode.ChannelSubscribe; d: ChannelSubscribePayload }
  | { op: VoiceOpcode.ChannelUnsubscribe; d: ChannelUnsubscribePayload };

export type ServerMessage =
  | { op: VoiceOpcode.Hello; d: HelloPayload }
  | { op: VoiceOpcode.Ready; d: ReadyPayload }
  | { op: VoiceOpcode.SessionDescription; d: SessionDescriptionPayload }
  | { op: VoiceOpcode.HeartbeatACK; d: HeartbeatACKPayload }
  | { op: VoiceOpcode.Resumed; d: ResumedPayload }
  | { op: VoiceOpcode.NegotiationDone; d: Record<string, never> }
  | { op: VoiceOpcode.Speaking; d: SpeakingPayloadServer }
  | { op: VoiceOpcode.VoiceStateUpdate; d: VoiceStateUpdatePayload }
  | { op: VoiceOpcode.Video; d: VideoPayloadServer }
  | { op: VoiceOpcode.StopTracks; d: StopTracksPayloadServer }
  | { op: VoiceOpcode.ProfileUpdate; d: ProfileUpdatePayload }
  | { op: VoiceOpcode.Error; d: ErrorPayload }
  | { op: VoiceOpcode.VoiceReady; d: VoiceReadyPayload }
  // Chat opcodes
  | { op: VoiceOpcode.Dispatch; d: DispatchPayload }
  | { op: VoiceOpcode.PresenceUpdate; d: PresenceUpdatePayload }
  | { op: VoiceOpcode.ChannelUpdate; d: Channel }
  | { op: VoiceOpcode.ChannelDelete; d: { channel_id: string } }
  | { op: VoiceOpcode.GuildMemberUpdate; d: GuildMemberUpdatePayload }
  | { op: VoiceOpcode.RelationshipUpdate; d: RelationshipUpdatePayload };
