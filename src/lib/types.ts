import type { MediaContentFilter } from "@/lib/media-content-filter";
import type { AvatarDisplay } from "@/lib/avatar-display";
import type { DisplayNameStyle } from "@/lib/profile-customization";
import type { PresencePlatform } from "@/lib/presence-platform";

// ============================================================================
// Gateway protocol re-exports. The wire protocol (opcodes, codes, payload
// schemas, codec) lives in @/lib/gateway-protocol; these names stay here for
// existing imports.
// ============================================================================

export {
  GatewayCloseCode,
  GatewayOp as VoiceOpcode,
} from "./gateway-protocol/opcodes";
export type {
  CallIdPayload,
  CallInitiatePayload,
  ClientDisconnectPayload,
  NegotiationDonePayload,
  PushTrackDescriptor,
  ResumePayload,
  SessionDescriptionPayload,
} from "./gateway-protocol";
import type {
  ChatGatewayServerMessage,
  MainGatewayClientMessage,
  RoomGatewayServerMessage,
  VoiceGatewayClientMessage,
  VoiceGatewayServerMessage,
} from "./gateway-protocol";

/** Any frame a browser gateway may send (main or voice gateway). */
export type ClientMessage =
  | MainGatewayClientMessage
  | VoiceGatewayClientMessage;

/** Any decoded frame a browser gateway may receive (main or voice gateway). */
export type ServerMessage =
  | ChatGatewayServerMessage
  | RoomGatewayServerMessage
  | VoiceGatewayServerMessage;

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

// ── Shared Data Types ───────────────────────────────────────────────────────

/** ICE server configuration for WebRTC */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** Info about a published track on the SFU */
export interface TrackInfo {
  participant_id: string;
  /** Stable Ralph alias used by the UI (for example, cam-audio-<participant>). */
  track_name: string;
  /** Opaque PartyTracks/SFU track identifier used only at the transport boundary. */
  sfu_track_name?: string;
  session_id: string;
  mid?: string;
  kind: "audio" | "video";
  track?: MediaStreamTrack;
}

/** A participant in the room — Discord-style voice state */
export interface VoiceState {
  id: string;
  clerk_user_id?: string;
  name: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_display?: AvatarDisplay | string | null;
  stream_preview_url?: string | null;
  self_mute: boolean;
  self_deaf: boolean;
  self_stream: boolean;
  self_stream_audio?: boolean;
  self_video: boolean;
  spatial_audio_enabled?: boolean;
  spatial_audio_high_fidelity?: boolean;
  suppress: boolean;
  status?: "online" | "idle" | "dnd" | "offline";
  custom_status?: string;
  tracks: TrackInfo[];
}

/** High-frequency voice-state update without cached profile fields. */
export type VoiceStateDelta = Omit<
  VoiceState,
  "name" | "username" | "display_name" | "avatar_url" | "avatar_display"
>;

export interface StreamWatchSnapshotPayload {
  type: "stream.watch.snapshot";
  watchers_by_streamer: Record<string, string[]>;
}

export interface StreamWatchStartPayload {
  type: "stream.watch.start";
  streamer_user_id: string;
}

export interface StreamWatchStopPayload {
  type: "stream.watch.stop";
  streamer_user_id: string;
}

export interface StreamWatchClearPayload {
  type: "stream.watch.clear";
}

export type StreamWatchAppEventPayload =
  | StreamWatchSnapshotPayload
  | StreamWatchStartPayload
  | StreamWatchStopPayload
  | StreamWatchClearPayload;

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
  | "PRESENCE_LIST"
  | "CHANNEL_UPDATE"
  | "CHANNEL_DELETE"
  | "GUILD_MEMBER_ADD"
  | "GUILD_MEMBER_REMOVE"
  | "GUILD_MEMBER_UPDATE"
  | "USER_SERVERS_UPDATE"
  | "USER_PROFILE_UPDATE"
  | "MESSAGE_PIN"
  | "MESSAGE_UNPIN"
  | "RELATIONSHIP_ADD"
  | "RELATIONSHIP_REMOVE"
  | "READ_STATE_UPDATE"
  | "NOTIFICATIONS_READ"
  | "NOTIFICATIONS_CLEAR"
  | "CALL_RING"
  | "CALL_RINGING"
  | "CALL_START"
  | "CALL_ACCEPTED"
  | "CALL_END";

/** User object */
export interface User {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_display?: AvatarDisplay | string | null;
  banner_url?: string | null;
  banner_content_type?: string | null;
  nameplate_url?: string | null;
  nameplate_content_type?: string | null;
  profile_accent_color?: string | null;
  profile_background_color?: string | null;
  profile_banner_color?: string | null;
  display_name_style?: DisplayNameStyle | string | null;
  theme_preference?: string | null;
  theme_sync_enabled?: boolean;
  media_content_filter?: MediaContentFilter | null;
  updated_at?: string;
  created_at?: string | null;
  bio?: string | null;
  pronouns?: string | null;
  status?: "online" | "idle" | "dnd" | "offline";
  custom_status?: string | null;
  presence_platforms?: PresencePlatform[];
}

/** Server object */
export interface Server {
  id: string;
  name: string;
  owner_id: string;
  icon_url?: string | null;
  invites_paused?: boolean;
  allow_public_shares?: boolean;
  show_source_in_shares?: boolean;
  allow_share_indexing?: boolean;
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
export interface VoiceChannelStatusMedia {
  id: string;
  provider: "klipy" | "tenor" | "external" | string;
  media_type?: "gifs" | "stickers" | "clips" | "memes";
  title?: string | null;
  alt_text?: string | null;
  source_url?: string | null;
  preview_url: string;
  preview_width: number;
  preview_height: number;
  preview_content_type:
    | "image/gif"
    | "image/apng"
    | "image/webp"
    | "image/png"
    | "image/jpeg"
    | "video/mp4"
    | "video/webm";
}

export interface VoiceChannelStatus {
  text?: string | null;
  media?: VoiceChannelStatusMedia | null;
}

export interface VoiceChannelStatusMediaAsset {
  id: string;
  server_id: string;
  channel_id: string;
  user_id: string;
  filename: string;
  content_type: VoiceChannelStatusMedia["preview_content_type"];
  size_bytes: number;
  created_at: string;
  media: VoiceChannelStatusMedia;
}

export interface Channel {
  id: string;
  server_id?: string;
  name: string;
  description?: string | null;
  channel_type: "text" | "voice" | "dm";
  category_id?: string;
  position: number;
  created_at: string;
  permissions?: number;
  allow_public_shares?: boolean | null;
  voice_status?: VoiceChannelStatus | null;
}

/** Category object */
export interface Category {
  id: string;
  server_id: string;
  name: string;
  rank: number;
}

export interface EmbedAuthor {
  name: string;
  url?: string;
  iconURL?: string;
  isVerified?: boolean;
}

export interface EmbedProvider {
  name: string;
  url?: string;
}

export interface EmbedThumbnail {
  url: string;
  width?: number;
  height?: number;
}

export interface EmbedVideo {
  url: string;
  width?: number;
  height?: number;
  kind?: "direct" | "player";
  contentType?: string;
  durationSeconds?: number;
}

export interface EmbedMedia {
  type: "image" | "video";
  url: string;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  contentType?: string;
  isGif?: boolean;
  altText?: string;
  durationSeconds?: number;
}

export interface EmbedFooter {
  text: string;
  iconURL?: string;
}

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface EmbedMetrics {
  replies?: number;
  retweets?: number;
  likes?: number;
  impressions?: number;
  comments?: number;
  views?: number;
}

export interface EmbedAudio {
  title?: string;
  artist?: string;
  url?: string;
  artworkUrl?: string;
}

export interface EmbedExternalCard {
  url?: string;
  title?: string;
  description?: string;
  domain?: string;
  image?: EmbedThumbnail;
}

export interface EmbedInfo {
  id: string;
  url: string;
  type: "video" | "rich" | "link" | "image";
  unavailable?: boolean;
  /**
   * The link points straight at an image, GIF or video file; render the
   * media bare (no card). Set by the server's direct-media detection.
   */
  direct?: boolean;
  /**
   * How a link card shows its image: "large" under the text (the page asked
   * for summary_large_image or the image is wide) or a small "thumbnail"
   * beside it. Absent on embeds stored before this existed: treat as large.
   */
  imageLayout?: "large" | "thumbnail";
  rawTitle?: string;
  rawDescription?: string;
  author?: EmbedAuthor;
  provider?: EmbedProvider;
  color?: string;
  thumbnail?: EmbedThumbnail;
  media?: EmbedMedia[];
  video?: EmbedVideo;
  audio?: EmbedAudio;
  externalCard?: EmbedExternalCard;
  referencedTweet?: {
    type: "quoted" | "retweeted";
    url?: string;
    rawDescription?: string;
    author?: EmbedAuthor;
    media?: EmbedMedia[];
    externalCard?: EmbedExternalCard;
    metrics?: EmbedMetrics;
    timestamp?: string;
  };
  footer?: EmbedFooter;
  timestamp?: string;
  metrics?: EmbedMetrics;
  fields: EmbedField[];
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
  attachment_count?: number;
  is_pinned: boolean;
  created_at: string;
  updated_at?: string;
  attachments?: Attachment[];
  reactions?: Reaction[];
  embeds?: EmbedInfo[];
  /** Client-generated nonce for optimistic dedup */
  nonce?: string;
  /** True while the message is still being sent (optimistic) */
  pending?: boolean;
  /** Number of replies to this message (for thread badge) */
  reply_count?: number;
  /** Durable server revision used to reject reordered realtime updates */
  content_revision?: number;
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
  downloadUrl?: string;
  is_nsfw?: boolean;
  isGif?: boolean;
  alt_text?: string | null;
  thumbnailUrl?: string | null;
  sourceUrl?: string | null;
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
  channel_id?: string;
  channel_name?: string;
  inviter_id: string;
  inviter?: User;
  max_uses?: number;
  uses: number;
  temporary?: boolean;
  expires_at?: string;
  created_at?: string;
}

/** Relationship object */
export interface Relationship {
  user: User;
  type: number;
  created_at: string;
}

/** Notification object */
export interface Notification {
  id: string;
  type: "mention" | "reply" | "dm";
  channel_id: string;
  server_id: string | null;
  message_id: string;
  from_user: {
    id: string;
    username: string;
    display_name?: string | null;
    avatar_url?: string | null;
    avatar_display?: AvatarDisplay | string | null;
  };
  content: string;
  is_read: boolean;
  created_at: string;
  // Denormalized for display
  channel_name?: string;
  server_name?: string;
}

/** Server Audit Log object */
export interface ServerAuditLog {
  id: string;
  server_id: string;
  actor_id: string;
  actor?: User; // Joined in API response
  action_type: string;
  target_id?: string | null;
  changes?: Record<string, unknown> | null;
  reason?: string | null;
  created_at: string;
}

// ── SFU Event Types (for React consumer layer) ──────────────────────────────

export interface SFUEventMap {
  joined: {
    participantId: string;
    iceServers: IceServer[];
    participants: VoiceState[];
    spatialAudioState?: import("@/lib/voice/spatial-audio").SharedSpatialAudioState;
  };
  "voice-state-update": {
    participant: VoiceState | VoiceStateDelta;
    action: "join" | "leave" | "update";
  };
  "participant-joined": { participant: VoiceState };
  "participants-sync": {
    participants: VoiceState[];
    spatialAudioState?: import("@/lib/voice/spatial-audio").SharedSpatialAudioState;
  };
  "participant-left": { participantId: string };
  "remote-track": {
    participantId: string;
    track: MediaStreamTrack;
    trackInfo: TrackInfo;
    action?: "add" | "remove";
  };
  "tracks-published": { participantId: string; tracks: TrackInfo[] };
  "tracks-stopped": { participantId: string; trackNames: string[] };
  speaking: { participantId: string; speaking: number };
  "vad-speaking": { participantId: string; isSpeaking: boolean };
  "audio-stalled": boolean;
  "outbound-audio-stalled": boolean;
  "profile-update": {
    participantId: string;
    name: string;
    username?: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    avatarDisplay?: AvatarDisplay | string | null;
  };
  "connection-state": { state: string };
  "voice-ready": { speaking?: Record<string, number> };
  disconnected: never;
  kicked: never;
  /** A call socket's ticket was refused twice: the session is gone. */
  "auth-failed": never;
  error: { message: string };
  "audio-resumed": {};
  "voice-reconnected": never;
  "voice-token-expired": never;
  "app-event": Record<string, unknown>;
}

// ── Connection Stats Types ──────────────────────────────────────────────────

/**
 * One point of the uplink time-series behind the voice stats charts, taken
 * once per stats tick. Rates are per interval, not cumulative.
 */
export interface ConnectionSample {
  /** Epoch ms of the stats tick. */
  t: number;
  /** Outbound transport bitrate, kbps. */
  bitrate: number;
  /** Outbound audio loss the SFU reported for the last interval, percent. */
  loss: number;
  /** Outbound audio jitter the SFU reported, ms. */
  jitter: number;
  /** Media-path round trip (RTCP), ms; 0 until the first receiver report. */
  rtt: number;
}

export interface VoiceConnectionStats {
  ping: number;
  avgPing: number;
  pingHistory: { time: string; ping: number }[];
  /** Outbound audio jitter from the SFU's receiver report, ms. */
  jitter: number;
  /** The last ~2 minutes of samples, oldest first (bounded ring). */
  samples: ConnectionSample[];
  localAddress: string;
  remoteAddress: string;
  packetsSent: number;
  packetsReceived: number;
  packetsLost: number;
  packetLossRate: number;
  bytesSent: number;
  bytesReceived: number;
  availableOutgoingBitrate: number;
  outboundBitrate: number;
  inboundBitrate: number;
  codec: { name: string; id: number } | null;
  audioLevel: number;
  sampleRate: number;
  framesEncoded: number;
  timestamp: number;
  serverIdentifier: string;
  connectionState: string;
  publishConnectionState: string;
  subscribeConnectionState: string;
  remoteTrackCount: number;
}
