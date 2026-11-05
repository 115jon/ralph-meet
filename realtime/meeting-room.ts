// ============================================================================
// MeetingRoom — Cloudflare Durable Object for room presence & state
//
// Discord-style Main Gateway: handles Identify, Heartbeat, Resume, Speaking,
// VoiceStateUpdate, ProfileUpdate/Refresh. Issues voice_token for VoiceRoom.
//
// Media signaling (SelectProtocol, SessionDescription, Video, StopTracks,
// Answer) is handled by the separate VoiceRoom DO.
// ============================================================================

import { DurableObject } from "cloudflare:workers";
import {
  resolveVisibleChannelPermissions,
  type ChannelVisibilityOverride,
  type ChannelVisibilityRole,
} from "../src/lib/channel-visibility";
import { getDisplayName } from "../src/lib/display-name";
import {
  decodeMainGatewayClientFrame,
  GatewayCloseCode as CloseCode,
  GatewayOp as Op,
  VOICE_MOVED_CLOSE_REASON,
  type CallRecord,
  type MainClientPayload,
} from "../src/lib/gateway-protocol";
import { clog } from "../src/lib/console-logger";
import {
  isReconnectWithinGrace,
  shouldKeepResumableSession,
} from "./connection-lifecycle";
import {
  normalizePresencePlatform,
  type PresencePlatform,
} from "../src/lib/presence-platform";
import {
  getNextVoicePresenceAlarmTime,
  refreshVoiceMemberIdentity,
} from "../src/lib/voice-presence";
import { filterVoiceChannelStatesPayload } from "../src/lib/voice-channel-state-filter";
import {
  hasChannelPermission,
  resolveChannelAccess,
  resolveChannelAccessForUsers,
} from "../src/lib/channel-access";
import { PERMISSIONS } from "../src/lib/permissions";
import {
  parseVoiceMoveGrantRecord,
  parseVoiceMoveGrantUse,
  parseVoiceMoveRequest,
  VOICE_MOVE_GRANT_PATH,
  VOICE_MOVE_GRANT_USE_PATH,
  VOICE_MOVE_PATH,
  VoiceMoveGrantLedger,
  type VoiceMoveNotice,
} from "./voice-move";
import {
  buildVoiceRosterMembers,
  isNewerVoiceRoster,
  isVoiceRosterSession,
  nextVoiceRosterSeq,
  parseVoiceRosterMembers,
  parseVoiceRosterPull,
  parseVoiceRosterPushReply,
  parseVoiceRosterSnapshot,
  resolveRoomVoiceChannelId,
  voiceRosterFingerprint,
  VoiceRosterPusher,
  VOICE_ROSTER_GATEWAY,
  VOICE_ROSTER_HINT_MIN_AGE_MS,
  VOICE_ROSTER_PATH,
  VOICE_ROSTER_PULL_PATH,
  VOICE_ROSTER_PUSH_ALARM_RETRY_MS,
  VOICE_ROSTER_REVALIDATE_MS,
  type VoiceRosterMember,
  type VoiceRosterSnapshot,
  voiceRosterSessionOf,
} from "./voice-roster";
import { initRealtimeTicketNonces } from "./realtime-admission";
import {
  acceptSocket,
  admitSocket,
  isOpcodeAllowed,
  isSpentTicketReason,
  isSilent,
  rateLimitedError,
  readSocketFrame,
  refusedFieldError,
  requestedGatewayVersion,
  sendFrame,
  silentAt,
  SOCKET_HEARTBEAT_INTERVAL_MS as HEARTBEAT_INTERVAL_MS,
  SocketRateLimiter,
  unauthorizedUpgrade,
  unknownOpcodeError,
  type SocketRole,
} from "./socket-core";
import { resolveMeetingProfile } from "./meeting-room/profile-resolver";
import { ProfileRequestCoordinator } from "./meeting-room/profile-request-coordinator";
import { getCachedTurnCredentials as resolveTurnCredentials } from "./meeting-room/turn-credentials";
import { issueVoiceToken } from "./voice-token";
import {
  VOICE_JOIN_GRANT_CHECK_PATH,
  VOICE_JOIN_GRANT_PATH,
  createVoiceJoinGrantSequence,
  parseVoiceJoinGrantQuery,
  serializeVoiceJoinGrantUpdate,
  type VoiceJoinGrantQuery,
} from "./voice-join-grant";
import {
  scheduleMessagePostprocessing,
  scheduleR2Cleanup,
  scheduleServerMemberCacheInvalidation,
  type BackgroundTaskEnvelope,
} from "../src/lib/background-tasks";
import { recordR2CleanupFailure } from "../src/services/r2-cleanup.service";
import {
  callRingTokens,
  insertCallRecord,
  isMissedRingStop,
  planCallRing,
  sendCallRingPushes,
  sendCallRingStopPushes,
  type CallRingStopReason,
} from "../src/services/call.service";
import { fcmSenderFor } from "../src/server/fcm";
import {
  fetchMessageAttachmentKeys,
  type MessagePostprocessingTask,
} from "../src/services/message.service";
import {
  getSpatialAudioStorageKey,
  isSpatialAudioState,
  normalizeStoredResumableSession,
  normalizeStoredVoiceChannelMembers,
  normalizeStoredWsAttachment,
  ACTIVE_CALLS_STORAGE_KEY,
  PENDING_CALLS_STORAGE_KEY,
  restoreActiveCalls,
  restorePendingCalls,
  serializeActiveCalls,
  serializePendingCalls,
  type StoredActiveCall,
  SPATIAL_AUDIO_STORAGE_PREFIX,
  type StoredPendingCall,
  type StoredSpatialAudioState,
} from "./meeting-room-persistence";

const log = clog("ChatGW");
const meetingLog = clog("MeetingRoom");
const identifyLog = clog("handleIdentify");
const presenceLog = clog("handlePresenceUpdate");

interface Env {
  CALLS_APP_ID: string;
  CALLS_APP_SECRET: string;
  TURN_TOKEN_ID: string;
  TURN_TOKEN_SECRET: string;
  DB: D1Database;
  BUCKET: R2Bucket;
  CACHE: KVNamespace;
  BACKGROUND_TASKS?: Queue<BackgroundTaskEnvelope>;
  DEBUG?: string;
  VOICE_ROOM?: DurableObjectNamespace;
  /** This class's own namespace: rooms push rosters to the global gateway. */
  MEETING_ROOM?: DurableObjectNamespace;
  /** Service-account JSON for FCM; unset = no call ring pushes. */
  FCM_SERVICE_ACCOUNT?: string;
  /** Verifies voice move grants on VoiceChannelJoin (the ticket secret). */
  REALTIME_TICKET_SECRET?: string;
}

// Opcodes, codes and payload schemas: src/lib/gateway-protocol.

const MAX_STREAM_PREVIEW_URL_BYTES = 4_096;
const MAX_WEBSOCKET_ATTACHMENT_BYTES = 16_384;

// ── Shared interfaces ───────────────────────────────────────────────────────

interface TrackInfo {
  participant_id: string;
  track_name: string;
  session_id: string;
  mid?: string;
  kind: "audio" | "video";
}

interface VoiceState {
  id: string;
  user_id?: string;
  name: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_display?: string | null;
  platform?: PresencePlatform;
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
  tracks: TrackInfo[];
}

// ── Gateway message shapes ──────────────────────────────────────────────────

/** An outbound frame. Inbound frames are decoded by the gateway protocol. */
interface ServerMsg {
  op: number;
  d: any;
}

type VoiceStateDelta = Omit<
  VoiceState,
  "name" | "username" | "display_name" | "avatar_url" | "avatar_display"
>;

// Data stored on each WebSocket via serializeAttachment/deserializeAttachment
interface WsAttachment {
  admission?: {
    accessMode: "authenticated" | "public-demo";
    participantId: string;
    subject: string;
  };
  id: string;
  name: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_display?: string | null;
  platform?: PresencePlatform;
  user_id?: string;
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
  tracks: TrackInfo[];
  last_heartbeat?: number;
  /** Heartbeat ACK counter. It is not the replay cursor. */
  seq: number;
  /** Monotonic cursor for replayable outbound dispatches. */
  outbound_seq?: number;
  subscribed_channels: string[];
  subscribed_servers: string[];
  /** Channel ID the user is currently in voice for (global gateway only) */
  voice_channel_id?: string;
  /** Client can merge profile-less VOICE_CHANNEL_STATE_UPDATE members. */
  supports_voice_state_deltas?: boolean;
  standby?: boolean;
  /** Room: when this session joined voice (Identify or standby promotion). */
  voice_joined_at?: number;
  /**
   * Room: arrival order of that join (nextVoiceJoinOrder). One voice session
   * per user: the newest join wins, whichever Identify finishes first.
   */
  voice_join_order?: number;
}

interface ReplayEntry {
  seq: number;
  msg: ServerMsg;
  scope?:
    | { kind: "global" }
    | { kind: "channel"; channelId: string }
    | { kind: "server"; serverId: string };
}

interface ResumableSessionSnapshot {
  attachment: WsAttachment;
  replay: ReplayEntry[];
  persist_writes?: number;
}

interface VoiceChannelMember {
  user_id: string;
  name: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_display?: string | null;
  stream_preview_url?: string | null;
  connected?: boolean;
  connection_state?: "connected" | "reconnecting";
  disconnected_at?: number | null;
  reconnect_expires_at?: number | null;
  self_mute: boolean;
  self_deaf: boolean;
  self_video: boolean;
  self_stream: boolean;
  self_stream_audio?: boolean;
  spatial_audio_enabled?: boolean;
  spatial_audio_high_fidelity?: boolean;
  joined_at?: number;
}

/** Fields a client sets for its member over the global socket (op 15). */
interface VoiceMemberHint {
  stream_preview_url?: string | null;
  spatial_audio_enabled?: boolean;
  spatial_audio_high_fidelity?: boolean;
}

/** Global gateway: where one channel's roster comes from (vc:source:<id>). */
interface VoiceRosterSource {
  /** The room object that owns the channel; null for a pre-push entry. */
  roomSlug: string | null;
  /** Seq of the last snapshot applied; older or equal ones are ignored. */
  seq: number;
  /** When a push, a pull or a re-sent seq last confirmed the roster. */
  confirmedAt: number;
  /** Per member: VoiceMemberHint fields a client set (op 15, global). */
  hints?: Record<string, VoiceMemberHint>;
}

interface ProfileIdentity {
  name: string;
  username?: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_display: string | null;
}

interface ProfileIdentityPatch {
  name?: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_display?: string | null;
}

/** A pending (ringing) or active call between two users */
type SpatialAudioState = StoredSpatialAudioState;
interface PendingCall extends StoredPendingCall {
  timeout: ReturnType<typeof setTimeout>;
}

// ── Constants ───────────────────────────────────────────────────────────────

const PROFILE_REFRESH_COOLDOWN_MS = 10_000;
const PRUNE_ALARM_INTERVAL_MS = 300_000; // 5 min safety-net — client zombie detection fires first
const CALL_RING_TIMEOUT_MS = 30_000; // auto-cancel after 30s
/** POST /call-accept and /call-decline answers. */
const REST_ANSWER_STATUS = {
  ok: 200,
  not_callee: 403,
  not_found: 404,
} as const;
const RESUME_GRACE_PERIOD_MS = 120_000; // 2 min — keep session resumable after disconnect
/** How long a replaced voice session id answers Resume with SessionReplaced. */
const REPLACED_VOICE_SESSION_TTL_MS = 60 * 60 * 1000;
const REPLACED_VOICE_SESSIONS_STORAGE_KEY = "replacedVoiceSessions";
/** Close reason (with CloseCode.SessionReplaced) when voice moves device. */
const VOICE_SESSION_REPLACED_REASON = "Voice moved to another device";
/** Room: its roster state (channel id, seq, fingerprints, retry deadline). */
const VOICE_ROSTER_STATE_STORAGE_KEY = "vc:roster";
/** Global: per-channel VoiceRosterSource records. */
const VOICE_ROSTER_SOURCE_PREFIX = "vc:source:";
/**
 * Global: a sidebar entry stored before rooms pushed rosters (no source) is
 * kept this long for its room to push, then dropped.
 */
const VOICE_ROSTER_LEGACY_GRACE_MS = 120_000;
/** Global: an emptied channel keeps its last seq this long (late pushes). */
const VOICE_ROSTER_TOMBSTONE_MS = 10 * 60 * 1000;
/** Moved sessions' VoiceMove notices, replayed to a Resume of one. */
const MOVED_VOICE_SESSIONS_STORAGE_KEY = "movedVoiceSessions";
const MAX_REPLAY_BUFFER_BYTES = 256_000;
const MAX_REPLAY_PERSIST_WRITES = 32;
/** Per-opcode limits per minute (SocketRateLimiter). */
const WS_RATE_LIMITS: Record<number, number> = {
  [Op.MessageCreate]: 30,
  [Op.MessageUpdate]: 30,
  [Op.MessageDelete]: 30,
  [Op.ReactionAdd]: 60,
  [Op.ReactionRemove]: 60,
  [Op.CallInitiate]: 6,
  [Op.CallAccept]: 12,
  [Op.CallDecline]: 12,
  [Op.CallEnd]: 12,
  [Op.VoiceStateUpdate]: 60,
};

type PresenceStatus = "online" | "idle" | "dnd" | "offline";
const PRESENCE_STATUSES: ReadonlySet<string> = new Set<PresenceStatus>([
  "online",
  "idle",
  "dnd",
  "offline",
]);

function isPresenceStatus(status: string): status is PresenceStatus {
  return PRESENCE_STATUSES.has(status);
}

// ── MeetingRoom Durable Object ──────────────────────────────────────────────

export class MeetingRoom extends DurableObject<Env> {
  private sessions: Map<WebSocket, WsAttachment> = new Map();
  private _roomSlug: string = "unknown";
  private profileRefreshCooldowns: Map<string, number> = new Map();
  private profileRequestCoordinator = new ProfileRequestCoordinator();
  /** Sockets whose close or error has been delivered (see handleIdentify). */
  private readonly closedSockets = new WeakSet<WebSocket>();
  private profileIdentities: Map<string, ProfileIdentity> = new Map();
  private resumableSessions: Map<string, WsAttachment> = new Map();
  /** Voice sessions another device took over: participantId -> replaced at. */
  private replacedVoiceSessions: Map<string, number> = new Map();
  /** Voice sessions a moderator moved: participantId -> where they went. */
  private movedVoiceSessions = new Map<
    string,
    { userId: string; notice: VoiceMoveNotice; movedAt: number }
  >();
  /** Global gateway: each user's latest move grant, spent once per use. */
  private readonly voiceMoveGrants: VoiceMoveGrantLedger;
  private readonly rateLimiter: SocketRateLimiter;
  /** Non-standby Identify calls in flight: participantId -> admitted subject. */
  private identifyingVoiceJoins = new Map<string, string>();
  private readonly nextVoiceJoinGrantSeq = createVoiceJoinGrantSequence();
  /** Per-participant replay buffer: participantId → bounded replay entries. */
  private replayBuffers: Map<string, ReplayEntry[]> = new Map();
  /** Limits storage writes while a disconnected session is being replayed. */
  private replayPersistWrites: Map<string, number> = new Map();
  private static readonly MAX_REPLAY_BUFFER = 100;
  /** Sockets whose subscriptions are being restored before Resumed is sent. */
  private resumingSockets = new Set<WebSocket>();
  private pendingResumeMessages = new Map<WebSocket, ReplayEntry[]>();
  private resumeOverflowedSockets = new Set<WebSocket>();
  /** Channel → Set<WebSocket> — tracks which clients are subscribed to which channels (typing/presence only) */
  private channelSubscriptions: Map<string, Set<WebSocket>> = new Map();
  /** Server → Set<WebSocket> — tracks which clients are members of which servers (message delivery) */
  private serverSubscriptions: Map<string, Set<WebSocket>> = new Map();
  /** Voice channel presence: channelId → Map<userId, member info> */
  private voiceChannelMembers: Map<string, Map<string, VoiceChannelMember>> =
    new Map();
  /** Pending calls: calleeId → PendingCall (only one pending per callee) */
  private pendingCalls: Map<string, PendingCall> = new Map();
  /** Recently accepted calls (callId), acts as a TTL cache to prevent Op 33/Op 37 race conditions */
  private acceptedCalls: Set<string> = new Set();
  /** Answered DM calls by channel id, until the channel empties (call records). */
  private activeCalls: Map<string, StoredActiveCall> = new Map();
  /** Voice channel started timestamps: channelId → epoch ms when first member joined */
  private voiceChannelStartedAt: Map<string, number> = new Map();
  /** Shared spatial audio layouts: room/channel id -> state */
  private spatialAudioStates: Map<string, SpatialAudioState> = new Map();
  /** Channel metadata cache used for permission-filtered voice state delivery */
  private channelMetaCache: Map<
    string,
    { server_id: string | null; channel_type: string }
  > = new Map();
  /** Resumable session expiry: participantId → epoch ms when disconnect happened */
  private resumableSessionExpiry: Map<string, number> = new Map();
  /** Dirty storage keys pending batch flush */
  private dirtyStorage: Map<string, unknown> = new Map();
  /** Per-channel voice member keys scheduled for deletion */
  private deletedVcKeys: Set<string> = new Set();
  /** Serializes shared-state storage writes while keeping the hot path in memory. */
  private durableStateWrite: Promise<void> = Promise.resolve();

  // ── Voice roster authority (realtime/VOICE_ROSTER.md) ──────────────────
  // Room objects own their channel's roster and push it to the global
  // gateway; the global gateway mirrors it into voiceChannelMembers.

  /** Room: the voice channel this room reports its roster for. */
  private voiceRosterChannelId: string | null = null;
  /** Room: seq of the last roster snapshot built (strictly increasing). */
  private voiceRosterSeq = 0;
  /** Room: fingerprint of the snapshot that holds voiceRosterSeq. */
  private voiceRosterFingerprint: string | null = null;
  /** Room: fingerprint the global gateway last acknowledged. */
  private voiceRosterDelivered: string | null = null;
  /** Room: when the roster last went from empty to non-empty. */
  private voiceRosterStartedAt: number | null = null;
  /** Room: the members of the snapshot that holds voiceRosterSeq. */
  private voiceRosterMembers: VoiceRosterMember[] = [];
  /**
   * Room: members the last roster had that a reset of this object dropped
   * (their sockets went without close events, so no session was held for
   * resume). Shown as reconnecting until the user's session is back or
   * RESUME_GRACE_PERIOD_MS from when they were lost, so a deploy or a reset
   * does not empty the channel (and end its call) under people who
   * reconnect within seconds. Derived from voiceRosterMembers on start.
   */
  private voiceRosterResetHeld = new Map<
    string,
    { member: VoiceRosterMember; disconnectedAt: number }
  >();
  /** Room: a push ran out of retries; the alarm tries again from here. */
  private voiceRosterRetryAt: number | null = null;
  /** Room: arrival order of the last voice join (see voice_join_order). */
  private lastVoiceJoinOrder = 0;
  private readonly voiceRosterPusher = new VoiceRosterPusher({
    send: () => this.pushVoiceRoster(),
    onDelivered: () => {
      if (this.voiceRosterRetryAt !== null) {
        this.voiceRosterRetryAt = null;
        this.persistVoiceRosterState();
        this.flushDirtyStorage();
      }
    },
    onGiveUp: () => {
      meetingLog.warn("Voice roster push failed; the alarm will retry");
      this.voiceRosterRetryAt = Date.now() + VOICE_ROSTER_PUSH_ALARM_RETRY_MS;
      this.persistVoiceRosterState();
      this.flushDirtyStorage();
      this.ctx.waitUntil(this.scheduleAlarm());
    },
    waitUntil: (promise) => this.ctx.waitUntil(promise),
  });
  /** Global: where each channel's roster comes from, and how fresh it is. */
  private voiceRosterSources = new Map<string, VoiceRosterSource>();
  /** Global: channels with a roster pull in flight. */
  private voiceRosterPulls = new Set<string>();
  /** Global: when each channel's roster was last pulled (success or not). */
  private voiceRosterPullAttempts = new Map<string, number>();

  constructor(
    public ctx: DurableObjectState<{}>,
    public env: Env,
  ) {
    super(ctx, env);

    initRealtimeTicketNonces(this.ctx.storage.sql);
    this.voiceMoveGrants = new VoiceMoveGrantLedger(this.ctx.storage.sql);
    this.rateLimiter = new SocketRateLimiter(
      this.ctx.storage.sql,
      WS_RATE_LIMITS,
    );

    // Cloudflare's auto-response absorbs messages at the edge, preventing the DO
    // from updating the `last_heartbeat` timestamp, which causes the zombie
    // pruning alarm to falsely evict active users after 5 minutes.

    // Restore sessions from hibernation-safe WebSocket attachments
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const attachment = normalizeStoredWsAttachment<WsAttachment>(
          ws.deserializeAttachment(),
        );
        if (attachment) {
          this.sessions.set(ws, attachment);

          // Rebuild channel subscriptions from session data
          if (attachment.subscribed_channels) {
            for (const chId of attachment.subscribed_channels) {
              let subs = this.channelSubscriptions.get(chId);
              if (!subs) {
                subs = new Set();
                this.channelSubscriptions.set(chId, subs);
              }
              subs.add(ws);
            }
          }
          // Rebuild server subscriptions from session data
          if (attachment.subscribed_servers) {
            for (const sId of attachment.subscribed_servers) {
              let subs = this.serverSubscriptions.get(sId);
              if (!subs) {
                subs = new Set();
                this.serverSubscriptions.set(sId, subs);
              }
              subs.add(ws);
            }
          }
        }
      } catch {
        // Corrupted attachment — skip
      }
    }

    // Restore voice channel members from storage (async, blockConcurrencyWhile)
    this.ctx.blockConcurrencyWhile(async () => {
      // Restore roomSlug (survives hibernation)
      const storedSlug = (await this.ctx.storage.get("roomSlug")) as
        | string
        | undefined;
      if (storedSlug) this.roomSlug = storedSlug;

      // Restore resumable sessions from storage
      const storedResumable = (await this.ctx.storage.get(
        "resumableSessions",
      )) as Record<string, unknown> | undefined;
      if (storedResumable) {
        for (const [id, stored] of Object.entries(storedResumable)) {
          const restored = normalizeStoredResumableSession<
            WsAttachment,
            ReplayEntry
          >(stored);
          if (!restored) continue;
          this.resumableSessions.set(id, restored.attachment);
          this.replayBuffers.set(id, this.trimReplayBuffer(restored.replay));
          this.replayPersistWrites.set(
            id,
            this.normalizeReplayPersistWrites(restored.persistWrites),
          );
        }
      }

      // Restore voice channel members from per-channel keys (vc:members:*)
      const vcEntries = await this.ctx.storage.list({ prefix: "vc:members:" });
      for (const [key, value] of vcEntries) {
        const channelId = key.slice("vc:members:".length);
        const memberMap = new Map<string, VoiceChannelMember>();
        for (const m of normalizeStoredVoiceChannelMembers<VoiceChannelMember>(
          value,
        )) {
          memberMap.set(m.user_id, m);
        }
        if (memberMap.size > 0) {
          this.voiceChannelMembers.set(channelId, memberMap);
        }
      }

      // Global: where each mirrored roster comes from. An entry with no
      // source predates room pushes (it came from a client's op 33): its
      // room gets VOICE_ROSTER_LEGACY_GRACE_MS to push, then it is dropped.
      const sourceEntries = await this.ctx.storage.list({
        prefix: VOICE_ROSTER_SOURCE_PREFIX,
      });
      for (const [key, value] of sourceEntries) {
        const source = this.normalizeVoiceRosterSource(value);
        if (source) {
          this.voiceRosterSources.set(
            key.slice(VOICE_ROSTER_SOURCE_PREFIX.length),
            source,
          );
        }
      }
      const bootedAt = Date.now();
      for (const channelId of this.voiceChannelMembers.keys()) {
        if (!this.voiceRosterSources.has(channelId)) {
          this.voiceRosterSources.set(channelId, {
            roomSlug: null,
            seq: 0,
            confirmedAt: bootedAt,
          });
        }
      }

      // Room: its roster state.
      const rosterState = (await this.ctx.storage.get(
        VOICE_ROSTER_STATE_STORAGE_KEY,
      )) as Record<string, unknown> | undefined;
      if (rosterState) {
        if (typeof rosterState.channel_id === "string") {
          this.voiceRosterChannelId = rosterState.channel_id;
        }
        if (typeof rosterState.seq === "number") {
          this.voiceRosterSeq = rosterState.seq;
        }
        if (typeof rosterState.fingerprint === "string") {
          this.voiceRosterFingerprint = rosterState.fingerprint;
        }
        if (typeof rosterState.delivered === "string") {
          this.voiceRosterDelivered = rosterState.delivered;
        }
        if (typeof rosterState.started_at === "number") {
          this.voiceRosterStartedAt = rosterState.started_at;
        }
        this.voiceRosterMembers =
          parseVoiceRosterMembers(rosterState.members) ?? [];
        if (typeof rosterState.retry_at === "number") {
          this.voiceRosterRetryAt = rosterState.retry_at;
        }
      }

      // Restore voice channel started timestamps
      const storedStartedAt = (await this.ctx.storage.get(
        "voiceChannelStartedAt",
      )) as Record<string, number> | undefined;
      if (storedStartedAt) {
        for (const [channelId, ts] of Object.entries(storedStartedAt)) {
          this.voiceChannelStartedAt.set(channelId, ts);
        }
      }

      const storedMoved = (await this.ctx.storage.get(
        MOVED_VOICE_SESSIONS_STORAGE_KEY,
      )) as Record<string, unknown> | undefined;
      for (const [id, stored] of Object.entries(storedMoved ?? {})) {
        const move = stored as { userId?: unknown; movedAt?: unknown } | null;
        const parsed = parseVoiceMoveRequest({
          user_id: move?.userId,
          notice: (stored as { notice?: unknown } | null)?.notice,
        });
        if (parsed && typeof move?.movedAt === "number") {
          this.movedVoiceSessions.set(id, {
            userId: parsed.userId,
            notice: parsed.notice,
            movedAt: move.movedAt,
          });
        }
      }

      const storedReplaced = (await this.ctx.storage.get(
        REPLACED_VOICE_SESSIONS_STORAGE_KEY,
      )) as Record<string, unknown> | undefined;
      if (storedReplaced) {
        for (const [id, replacedAt] of Object.entries(storedReplaced)) {
          if (typeof replacedAt === "number") {
            this.replacedVoiceSessions.set(id, replacedAt);
          }
        }
      }

      // Restore resumable session expiry map
      const storedExpiry = (await this.ctx.storage.get(
        "resumableSessionExpiry",
      )) as Record<string, number> | undefined;
      if (storedExpiry) {
        for (const [id, ts] of Object.entries(storedExpiry)) {
          this.resumableSessionExpiry.set(id, ts);
        }
      }

      // Restore pending calls and recreate only process-local timeout optimizations.
      try {
        const storedPendingCalls = await this.ctx.storage.get<unknown>(
          PENDING_CALLS_STORAGE_KEY,
        );
        const restored = restorePendingCalls(storedPendingCalls, Date.now());
        for (const [calleeId, call] of restored.calls) {
          const pendingCall: PendingCall = {
            ...call,
            timeout: this.schedulePendingCallTimeout(call),
          };
          this.pendingCalls.set(calleeId, pendingCall);
        }
        if (restored.hadInvalidEntries) {
          if (restored.calls.size > 0) {
            await this.ctx.storage.put(
              PENDING_CALLS_STORAGE_KEY,
              serializePendingCalls(restored.calls),
            );
          } else {
            await this.ctx.storage.delete(PENDING_CALLS_STORAGE_KEY);
          }
        }
      } catch (error) {
        log.error("Failed to restore pending calls", error);
      }

      try {
        this.activeCalls = restoreActiveCalls(
          await this.ctx.storage.get<unknown>(ACTIVE_CALLS_STORAGE_KEY),
        );
      } catch (error) {
        log.error("Failed to restore active calls", error);
      }

      // Restore valid spatial layouts from per-room storage keys.
      try {
        const spatialEntries = await this.ctx.storage.list({
          prefix: SPATIAL_AUDIO_STORAGE_PREFIX,
        });
        for (const [key, value] of spatialEntries) {
          const roomKey = key.slice(SPATIAL_AUDIO_STORAGE_PREFIX.length);
          if (roomKey && isSpatialAudioState(value)) {
            this.spatialAudioStates.set(roomKey, value);
          } else {
            await this.ctx.storage.delete(key);
          }
        }
      } catch (error) {
        log.error("Failed to restore spatial audio states", error);
      }

      // Subscriptions came back with each socket's attachment (above). They
      // are not re-checked against D1 here: this runs on every wake from
      // hibernation, blocks every message until it finishes, and one D1
      // query per subscription per session could run into the 30 s limit,
      // which resets the object and drops every socket. Resume re-checks a
      // returning session's subscriptions; channel and server dispatches
      // check access when they are sent.

      if (this.roomSlug === VOICE_ROSTER_GATEWAY) {
        // Pull rosters the rooms may have changed while this object was
        // gone (a push that failed for good, a room that was reset).
        this.ctx.waitUntil(
          this.revalidateVoiceRosters(VOICE_ROSTER_REVALIDATE_MS / 2),
        );
      } else if (this.voiceRosterChannelId) {
        // Members whose sessions did not survive a reset are held for the
        // resume grace instead of leaving at once.
        this.holdVoiceMembersLostInReset(Date.now());
        this.syncVoiceRoster();
        this.flushDirtyStorage();
      }

      if (
        this.sessions.size > 0 ||
        this.resumableSessionExpiry.size > 0 ||
        this.pendingCalls.size > 0 ||
        this.voiceRosterSources.size > 0 ||
        this.voiceRosterResetHeld.size > 0 ||
        this.voiceRosterRetryAt !== null
      ) {
        this.ctx.waitUntil(this.scheduleAlarm());
      }
    });

    // Schedule prune alarm if there are live sessions
    if (this.sessions.size > 0 || this.pendingCalls.size > 0) {
      this.ctx.waitUntil(this.scheduleAlarm());
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const gatewayVersion = requestedGatewayVersion(url);

    // Extract channel ID or slug from URL path
    const channelMatch = url.pathname.match(/\/api\/channels\/([^/]+)\/ws/);
    if (channelMatch) {
      this.roomSlug = channelMatch[1];
      // Persist for hibernation survival
      this.ctx.storage.put("roomSlug", this.roomSlug).catch(() => {});
    }
    // Also support /api/gateway (global gateway)
    if (url.pathname === "/api/gateway") {
      this.roomSlug = "global-gateway";
      this.ctx.storage.put("roomSlug", this.roomSlug).catch(() => {});
    }

    if (url.pathname.endsWith("/ws") || url.pathname === "/api/gateway") {
      const expectedAudience =
        url.pathname === "/api/gateway" ? "global" : "room";
      const admitted = admitSocket(request.headers, this.ctx.storage.sql, {
        audience: expectedAudience,
        roomSlug: this.roomSlug,
      });
      if (!admitted.ok) {
        if (isSpentTicketReason(admitted.reason)) {
          log.warn(`Realtime admission refused: ${admitted.reason}`);
        }
        return unauthorizedUpgrade();
      }
      const { admission } = admitted;
      if (
        expectedAudience === "room" &&
        admission.accessMode === "authenticated" &&
        !this.voiceRosterChannelId
      ) {
        // The channel this room reports its roster for: from the ticket,
        // which the worker issued after checking the channel.
        const channelId = resolveRoomVoiceChannelId(this.roomSlug, admission);
        if (channelId) {
          this.voiceRosterChannelId = channelId;
          this.persistVoiceRosterState();
          this.flushDirtyStorage();
        }
      }

      log.info(`New connection, gateway_version=${gatewayVersion}`);
      return acceptSocket(
        this.ctx,
        {
          admission: {
            accessMode: admission.accessMode,
            participantId: admission.participantId,
            subject: admission.subject,
          },
        },
        gatewayVersion,
      ).response;
    }

    // Internal broadcast endpoint — called by REST API routes after persisting to D1
    if (url.pathname === "/broadcast" && request.method === "POST") {
      try {
        const body = (await request.json()) as {
          channel_id?: string;
          server_id?: string;
          member_user_id?: string;
          target_user_id?: string;
          event: string;
          data: unknown;
          broadcast_all?: boolean;
        };
        const dispatchMsg = {
          op: Op.Dispatch,
          d: { event: body.event, data: body.data },
        };
        if (
          body.event === "USER_PROFILE_UPDATE" &&
          this.isPlainObject(body.data) &&
          typeof body.data.user_id === "string" &&
          [
            "name",
            "username",
            "display_name",
            "avatar_url",
            "avatar_display",
          ].some((field) =>
            Object.prototype.hasOwnProperty.call(body.data, field),
          )
        ) {
          await this.applyPartialProfileIdentity(body.data.user_id, body.data);
        }
        log.info(
          `Internal broadcast: event=${body.event}, type=${body.broadcast_all ? "all" : body.target_user_id ? "user" : "channel"}, recipient=${body.target_user_id || body.channel_id || "all"}`,
        );

        if (body.broadcast_all) {
          const channelId = this.getDispatchChannelId(dispatchMsg);
          if (channelId) {
            await this.broadcastToChannel(channelId, dispatchMsg);
          } else {
            this.broadcast(dispatchMsg);
          }
        } else if (body.target_user_id) {
          this.broadcastToUser(body.target_user_id, dispatchMsg);
        } else if (body.server_id) {
          await this.broadcastToServerMembers(body.server_id, dispatchMsg);
        } else if (body.member_user_id) {
          await this.broadcastToUserServers(body.member_user_id, dispatchMsg);
        } else if (body.channel_id) {
          await this.broadcastToChannel(body.channel_id, dispatchMsg);
        }
        this.flushDirtyStorage();
        return new Response("OK", { status: 200 });
      } catch (e) {
        return new Response(`Broadcast error: ${e}`, { status: 500 });
      }
    }

    // Room -> global gateway: the room's roster changed.
    if (url.pathname === VOICE_ROSTER_PATH && request.method === "POST") {
      const snapshot = parseVoiceRosterSnapshot(
        await request.json().catch(() => null),
      );
      if (!snapshot || this.roomSlug !== VOICE_ROSTER_GATEWAY) {
        return Response.json({ error: "invalid" }, { status: 400 });
      }
      const applied = this.applyVoiceRosterSnapshot(snapshot);
      // The seq held for the channel, so a room whose seq fell behind it
      // (see raiseVoiceRosterSeqAbove) counts from above it.
      const source = this.voiceRosterSources.get(snapshot.channel_id);
      this.flushDirtyStorage();
      return Response.json(
        source?.roomSlug === snapshot.room_slug
          ? { applied, seq: source.seq }
          : { applied },
      );
    }

    // Global gateway -> room: what is the roster now?
    if (url.pathname === VOICE_ROSTER_PULL_PATH && request.method === "POST") {
      const pull = parseVoiceRosterPull(await request.json().catch(() => null));
      if (!pull || this.roomSlug === VOICE_ROSTER_GATEWAY) {
        return Response.json({ error: "invalid" }, { status: 400 });
      }
      if (this.roomSlug === "unknown") {
        // Never admitted a socket since its storage was written: the pull
        // was addressed to this object by its slug.
        this.roomSlug = pull.roomSlug;
        this.ctx.storage.put("roomSlug", this.roomSlug).catch(() => {});
      }
      if (!this.voiceRosterChannelId) {
        // A room that has not admitted a ticket naming its channel since it
        // started reporting: the gateway's record came from this room.
        this.voiceRosterChannelId = pull.channelId;
      }
      if (this.voiceRosterChannelId !== pull.channelId) {
        return Response.json({ error: "channel_mismatch" }, { status: 409 });
      }
      let snapshot = this.currentVoiceRoster();
      if (snapshot.seq < pull.minSeq) {
        // The gateway would ignore this snapshot as older than its own.
        this.raiseVoiceRosterSeqAbove(pull.minSeq);
        snapshot = { ...snapshot, seq: this.voiceRosterSeq };
      }
      // The answer delivers this snapshot; no push needed for it.
      this.voiceRosterDelivered = this.voiceRosterFingerprint;
      this.persistVoiceRosterState();
      this.flushDirtyStorage();
      return Response.json(snapshot);
    }

    if (
      url.pathname === VOICE_JOIN_GRANT_CHECK_PATH &&
      request.method === "POST"
    ) {
      const query = parseVoiceJoinGrantQuery(
        await request.json().catch(() => null),
      );
      if (!query) {
        return Response.json({ granted: false }, { status: 400 });
      }
      return Response.json({ granted: this.isVoiceJoinGranted(query) });
    }

    if (url.pathname === "/voice-session-check" && request.method === "POST") {
      try {
        const body = (await request.json()) as {
          user_id?: string;
          channel_id?: string;
          session_id?: string | null;
          require_exact_session?: boolean;
          require_channel_match?: boolean;
        };

        const userId = typeof body.user_id === "string" ? body.user_id : "";
        const channelId =
          typeof body.channel_id === "string" ? body.channel_id : "";
        const sessionId =
          typeof body.session_id === "string" && body.session_id.trim()
            ? body.session_id.trim()
            : null;
        const requireExactSession = body.require_exact_session === true;
        const requireChannelMatch = body.require_channel_match !== false;

        if (!userId || (requireChannelMatch && !channelId)) {
          return Response.json(
            { error: "Missing voice session lookup fields" },
            { status: 400 },
          );
        }

        let userMatchedScope = false;
        let exactSessionMatched = false;

        if (requireChannelMatch && this.roomSlug === VOICE_ROSTER_GATEWAY) {
          // Who is in the channel is the room's roster, mirrored here; a
          // chat session's own say (op 33) no longer counts.
          userMatchedScope =
            this.voiceChannelMembers.get(channelId)?.has(userId) ?? false;
        } else {
          for (const attachment of this.sessions.values()) {
            if (attachment.user_id !== userId) continue;
            if (
              requireChannelMatch &&
              attachment.voice_channel_id !== channelId
            )
              continue;

            userMatchedScope = true;
            if (sessionId && attachment.id === sessionId) {
              exactSessionMatched = true;
              break;
            }
          }
        }

        return Response.json({
          allowed: requireExactSession ? exactSessionMatched : userMatchedScope,
          connected: userMatchedScope,
          exact_session_matched: exactSessionMatched,
        });
      } catch (error) {
        return Response.json(
          { error: `Voice session check error: ${error}` },
          { status: 500 },
        );
      }
    }

    // POST /api/calls/:id/accept|decline (src/server/routes/calls.ts): the
    // callee answers or declines a ring without a socket, e.g. from a phone
    // notification. The worker has checked who is asking.
    if (
      (url.pathname === "/call-accept" || url.pathname === "/call-decline") &&
      request.method === "POST"
    ) {
      const body: unknown = await request.json().catch(() => null);
      const callId =
        this.isPlainObject(body) && typeof body.call_id === "string"
          ? body.call_id
          : "";
      const userId =
        this.isPlainObject(body) && typeof body.user_id === "string"
          ? body.user_id
          : "";
      if (!callId || !userId) {
        return Response.json({ error: "invalid" }, { status: 400 });
      }
      const result =
        url.pathname === "/call-accept"
          ? this.acceptCallFromRest(callId, userId)
          : this.declineCallFromRest(callId, userId);
      this.flushDirtyStorage();
      return Response.json(result === "ok" ? { ok: true } : { error: result }, {
        status: REST_ANSWER_STATUS[result],
      });
    }

    // POST /api/voice/move (src/server/routes/voice-move.ts), on the source
    // channel's room: hand the user's voice session(s) the move and end them
    // here. The worker has checked the mover's permissions.
    if (url.pathname === VOICE_MOVE_PATH && request.method === "POST") {
      const move = parseVoiceMoveRequest(
        await request.json().catch(() => null),
      );
      if (!move || !this.grantsVoiceJoins) {
        return Response.json({ error: "invalid" }, { status: 400 });
      }
      const moved = this.moveVoiceSessions(move.userId, move.notice);
      // Moved out while held after a reset: off this room's roster too.
      this.voiceRosterResetHeld.delete(move.userId);
      this.flushDirtyStorage();
      return Response.json({ moved });
    }

    // Global gateway: the route's new grant becomes the user's only live one.
    if (url.pathname === VOICE_MOVE_GRANT_PATH && request.method === "POST") {
      const grant = parseVoiceMoveGrantRecord(
        await request.json().catch(() => null),
      );
      if (!grant) return Response.json({ error: "invalid" }, { status: 400 });
      this.voiceMoveGrants.record(grant);
      return Response.json({ recorded: true });
    }

    // Global gateway: the ticket route spends a grant for one ticket.
    if (
      url.pathname === VOICE_MOVE_GRANT_USE_PATH &&
      request.method === "POST"
    ) {
      const use = parseVoiceMoveGrantUse(
        await request.json().catch(() => null),
      );
      if (!use) return Response.json({ error: "invalid" }, { status: 400 });
      return Response.json({
        ok: this.voiceMoveGrants.spend(
          use.user_id,
          use.jti,
          use.channel_id,
          use.use,
        ),
      });
    }

    if (url.pathname === "/disconnect-session" && request.method === "POST") {
      try {
        const body = (await request.json()) as {
          user_id?: string;
          channel_id?: string;
          session_id?: string | null;
        };

        const userId = typeof body.user_id === "string" ? body.user_id : "";
        const channelId =
          typeof body.channel_id === "string" ? body.channel_id : undefined;
        const sessionId =
          typeof body.session_id === "string" && body.session_id.trim()
            ? body.session_id.trim()
            : null;

        if (!userId || !sessionId) {
          return Response.json(
            { error: "Missing disconnect session fields" },
            { status: 400 },
          );
        }

        const disconnected = await this.disconnectSessionImmediately(
          userId,
          sessionId,
          channelId,
        );
        this.flushDirtyStorage();
        return Response.json({ disconnected }, { status: 200 });
      } catch (error) {
        return Response.json(
          { error: `Disconnect session error: ${error}` },
          { status: 500 },
        );
      }
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, rawMsg: string | ArrayBuffer) {
    if (this.env.DEBUG && typeof rawMsg === "string")
      log.info(`webSocketMessage received: ${rawMsg.substring(0, 100)}`);
    const read = readSocketFrame(rawMsg);
    if (!read.ok) {
      this.sendTo(ws, read.error);
      return;
    }
    const frame = read.frame;

    if (
      this.getSessionAdmission(ws)?.accessMode === "public-demo" &&
      !this.isAllowedPublicDemoOpcode(frame.op)
    ) {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.NotAuthenticated,
          message: "Operation is unavailable in public demo rooms",
        },
      });
      return;
    }

    // An opcode of the other MeetingRoom role answers as an unknown one.
    const role = this.socketRole;
    if (role && !isOpcodeAllowed(role, frame.op)) {
      this.sendTo(ws, unknownOpcodeError(role, frame.op));
      this.flushDirtyStorage();
      return;
    }

    if (this.isRateLimited(ws, frame.op)) {
      this.sendTo(ws, rateLimitedError());
      return;
    }

    const decoded = decodeMainGatewayClientFrame(frame);
    if (!decoded.ok) {
      if (decoded.reason === "invalid-payload") {
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: CloseCode.InvalidPayload, message: decoded.invalid },
        });
        return;
      }
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.UnknownOpcode,
          message: `Unknown opcode: ${frame.op}`,
        },
      });
      this.flushDirtyStorage();
      return;
    }

    const refused = role ? refusedFieldError(role, frame) : null;
    if (refused) {
      this.sendTo(ws, refused);
      return;
    }

    const msg = decoded.message;
    switch (msg.op) {
      case Op.Identify:
        await this.handleIdentify(ws, msg.d);
        break;

      case Op.Heartbeat:
        this.handleHeartbeat(ws);
        break;

      case Op.Resume:
        await this.handleResume(ws, msg.d);
        break;

      case Op.RefreshVoiceCredentials:
        await this.handleRefreshVoiceCredentials(ws);
        break;

      case Op.VoiceStateUpdate:
        this.handleVoiceStateUpdate(ws, msg.d);
        break;

      case Op.ProfileRefresh:
        await this.handleProfileRefresh(ws);
        break;

      case Op.ClientDisconnect:
        await this.handleLeave(ws, true);
        break;

      // ── Chat opcodes ───────────────────────────────────────────────

      case Op.MessageCreate:
        await this.handleMessageCreate(ws, msg.d);
        break;

      case Op.MessageUpdate:
        await this.handleMessageUpdate(ws, msg.d);
        break;

      case Op.MessageDelete:
        await this.handleMessageDelete(ws, msg.d);
        break;

      case Op.TypingStart:
        await this.handleTypingStart(ws, msg.d);
        break;

      case Op.ReactionAdd:
        await this.handleReactionAdd(ws, msg.d);
        break;

      case Op.ReactionRemove:
        await this.handleReactionRemove(ws, msg.d);
        break;

      case Op.ChannelSubscribe:
        await this.handleChannelSubscribe(ws, msg.d);
        break;

      case Op.ChannelUnsubscribe:
        this.handleChannelUnsubscribe(ws, msg.d);
        break;

      case Op.PresenceUpdate:
        this.handlePresenceUpdate(ws, msg.d);
        break;

      case Op.VoiceChannelJoin:
        this.handleVoiceChannelJoin(ws, msg.d);
        break;

      case Op.VoiceChannelLeave:
        this.handleVoiceChannelLeave(ws, msg.d);
        break;

      case Op.ServerSubscribe:
        await this.handleServerSubscribe(ws, msg.d);
        break;

      case Op.CallInitiate:
        await this.handleCallInitiate(ws, msg.d);
        break;

      case Op.CallAccept:
        this.handleCallAccept(ws, msg.d);
        break;

      case Op.CallDecline:
        this.handleCallDecline(ws, msg.d);
        break;

      case Op.CallEnd:
        this.handleCallEnd(ws, msg.d);
        break;

      default: {
        // Every opcode in mainGatewayClientRules has a case above.
        const unhandled: never = msg;
        void unhandled;
      }
    }

    // Flush any dirty storage keys accumulated during this message cycle
    this.flushDirtyStorage();
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.closedSockets.add(ws);
    await this.handleLeave(ws, false, false);
    this.flushDirtyStorage();
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket) {
    this.closedSockets.add(ws);
    await this.handleLeave(ws, false, false);
    this.flushDirtyStorage();
  }

  // ── Alarm: zombie pruning ──────────────────────────────────────────────

  async alarm() {
    const now = Date.now();
    try {
      const zombies: WebSocket[] = [];

      for (const [ws, session] of this.sessions) {
        // Use last_heartbeat as the primary liveness signal.
        const lastActivity = session.last_heartbeat ?? 0;

        if (isSilent(lastActivity, now)) {
          log.info(
            `Pruning zombie: ${session.id} (${session.name}), ` +
              `last_activity=${Math.round((now - lastActivity) / 1000)}s ago`,
          );
          zombies.push(ws);
        }
      }

      for (const ws of zombies) {
        try {
          await this.handleLeave(ws, false, true);
        } catch (e) {
          log.error(`alarm: handleLeave threw for zombie session:`, e);
        }
      }

      // Prune expired resumable sessions
      let resumableChanged = false;
      for (const [id, disconnectedAt] of this.resumableSessionExpiry) {
        if (now - disconnectedAt >= RESUME_GRACE_PERIOD_MS) {
          log.info(
            `Pruning expired resumable session: ${id} (disconnected ${Math.round((now - disconnectedAt) / 1000)}s ago)`,
          );
          // Broadcast the deferred VoiceStateUpdate "leave" — the abrupt
          // disconnect path skips this to avoid premature removal from
          // other clients' participant lists during brief reconnects.
          const expiredSession = this.resumableSessions.get(id);
          if (expiredSession) this.revokeVoiceJoin(expiredSession);
          if (expiredSession && !expiredSession.standby) {
            this.broadcast({
              op: Op.VoiceStateUpdate,
              d: {
                participant: this.buildVoiceState(expiredSession),
                action: "leave",
              },
            });
          }
          this.resumableSessions.delete(id);
          this.replayBuffers.delete(id);
          this.replayPersistWrites.delete(id);
          this.resumableSessionExpiry.delete(id);
          resumableChanged = true;
        }
      }
      if (resumableChanged) {
        this.persistResumableSessions();
        this.persistResumableSessionExpiry();
      }
      if (this.pruneReplacedVoiceSessions(now)) {
        this.persistReplacedVoiceSessions();
      }

      // Pending calls use durable deadlines so a hibernated room still stops
      // ringing and removes the call from storage.
      for (const pending of this.pendingCalls.values()) {
        if (pending.expiresAt > now) continue;
        await this.expirePendingCall(pending);
      }

      if (this.roomSlug === VOICE_ROSTER_GATEWAY) {
        // Mirrored rosters: drop pre-push entries no room claimed, forget
        // emptied channels' seqs, and pull any channel gone quiet.
        this.pruneVoiceRosterSources(now);
        await this.revalidateVoiceRosters(VOICE_ROSTER_REVALIDATE_MS);
      } else if (
        this.voiceRosterRetryAt !== null &&
        this.voiceRosterRetryAt <= now
      ) {
        // Pushed back again if this attempt also runs out of retries.
        this.voiceRosterRetryAt = now + VOICE_ROSTER_PUSH_ALARM_RETRY_MS;
        this.persistVoiceRosterState();
        this.voiceRosterPusher.request();
      }

      // Flush any dirty storage accumulated during alarm processing
      this.flushDirtyStorage();
    } catch (e) {
      log.error(`alarm(): uncaught exception — state may be inconsistent:`, e);
    } finally {
      // ALWAYS reschedule if there are active sessions, even after an exception.
      // Without this, a transient error would stop zombie pruning permanently.
      if (
        this.sessions.size > 0 ||
        this.resumableSessionExpiry.size > 0 ||
        this.pendingCalls.size > 0 ||
        this.voiceRosterSources.size > 0 ||
        this.voiceRosterResetHeld.size > 0 ||
        this.voiceRosterRetryAt !== null
      ) {
        await this.scheduleAlarm(true);
      }
    }
  }

  private getNextAlarmTime(now: number) {
    const deadlines: number[] = [];

    for (const [, session] of this.sessions) {
      if (session.last_heartbeat)
        deadlines.push(silentAt(session.last_heartbeat));
    }
    for (const disconnectedAt of this.resumableSessionExpiry.values()) {
      deadlines.push(disconnectedAt + RESUME_GRACE_PERIOD_MS);
    }
    for (const { disconnectedAt } of this.voiceRosterResetHeld.values()) {
      deadlines.push(disconnectedAt + RESUME_GRACE_PERIOD_MS);
    }
    for (const pending of this.pendingCalls.values()) {
      deadlines.push(pending.expiresAt);
    }
    for (const [channelId, source] of this.voiceRosterSources) {
      if (source.roomSlug === null) {
        deadlines.push(source.confirmedAt + VOICE_ROSTER_LEGACY_GRACE_MS);
      } else if (this.voiceChannelMembers.has(channelId)) {
        // From the last pull attempt too: a room that does not answer is
        // asked again a minute later, not in a loop.
        deadlines.push(
          Math.max(
            source.confirmedAt,
            this.voiceRosterPullAttempts.get(channelId) ?? 0,
          ) + VOICE_ROSTER_REVALIDATE_MS,
        );
      } else {
        deadlines.push(source.confirmedAt + VOICE_ROSTER_TOMBSTONE_MS);
      }
    }
    if (this.voiceRosterRetryAt !== null) {
      deadlines.push(this.voiceRosterRetryAt);
    }

    return getNextVoicePresenceAlarmTime(
      now,
      PRUNE_ALARM_INTERVAL_MS,
      deadlines,
    );
  }

  private async scheduleAlarm(rethrow = false) {
    const now = Date.now();
    try {
      const nextAlarm = this.getNextAlarmTime(now);
      const currentAlarm = await this.ctx.storage.getAlarm();
      if (
        currentAlarm === null ||
        currentAlarm <= now ||
        nextAlarm < currentAlarm
      ) {
        await this.ctx.storage.setAlarm(nextAlarm);
      }
    } catch (error) {
      if (rethrow) throw error;
      log.error("Failed to schedule meeting-room alarm", error);
    }
  }

  private scheduleDurableStateWrite(
    operation: () => Promise<unknown>,
    description: string,
  ): Promise<void> {
    const write = this.durableStateWrite
      .then(operation)
      .then(() => undefined)
      .catch((error) => {
        log.error(`Failed to persist ${description}`, error);
      });
    this.durableStateWrite = write;
    this.ctx.waitUntil(write);
    return write;
  }

  // ── Batched storage writes ─────────────────────────────────────────────

  /** Mark a storage key as dirty — will be flushed in batch at end of message cycle */
  private markDirty(key: string, value: unknown) {
    this.dirtyStorage.set(key, value);
  }

  /** Flush all dirty storage keys in a single batch put */
  private flushDirtyStorage() {
    // Every message, close, alarm and internal request ends here: the place
    // to notice that this room's voice roster changed.
    this.syncVoiceRoster();
    // Delete any per-channel voice member keys that were removed
    if (this.deletedVcKeys.size > 0) {
      const keys = [...this.deletedVcKeys];
      this.deletedVcKeys.clear();
      this.ctx.waitUntil(this.ctx.storage.delete(keys).catch(() => {}));
    }
    if (this.dirtyStorage.size === 0) return;
    const entries = Object.fromEntries(this.dirtyStorage);
    this.dirtyStorage.clear();
    this.ctx.waitUntil(
      this.ctx.storage.put(entries).catch((error) => {
        log.error("Failed to flush Durable Object storage", error);
        if (
          !Object.prototype.hasOwnProperty.call(entries, "resumableSessions")
        ) {
          return;
        }

        // Never keep serving a warm snapshot whose replay write failed. The
        // client will reconnect and reconcile message history from REST.
        this.resumableSessions.clear();
        this.replayBuffers.clear();
        this.replayPersistWrites.clear();
        this.resumableSessionExpiry.clear();
        this.ctx.waitUntil(
          this.ctx.storage
            .delete(["resumableSessions", "resumableSessionExpiry"])
            .catch((deleteError) => {
              log.error(
                "Failed to clear stale resumable snapshots",
                deleteError,
              );
            }),
        );
      }),
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private persist(ws: WebSocket, data: WsAttachment) {
    // A socket that closed (or whose session was ended) never comes back:
    // a persist that finishes after an await must not re-add it.
    if (this.closedSockets.has(ws)) return;
    const wasEmpty = this.sessions.size === 0;
    const admission =
      data.admission ?? this.getSessionAdmission(ws) ?? undefined;
    const nextData = admission ? { ...data, admission } : data;
    const serializedBytes = new TextEncoder().encode(
      JSON.stringify(nextData),
    ).byteLength;
    const compactData: WsAttachment = {
      ...nextData,
      stream_preview_url: null,
      avatar_url: null,
      avatar_display: null,
      username: undefined,
      display_name: null,
      tracks: [],
      subscribed_channels: nextData.subscribed_channels.slice(-32),
      subscribed_servers: nextData.subscribed_servers.slice(-32),
      name: nextData.name.slice(0, 256),
    };
    try {
      ws.serializeAttachment(
        serializedBytes > MAX_WEBSOCKET_ATTACHMENT_BYTES
          ? compactData
          : nextData,
      );
    } catch (error) {
      try {
        ws.serializeAttachment(compactData);
      } catch (compactError) {
        meetingLog.error("Failed to serialize WebSocket attachment", {
          error,
          compactError,
        });
      }
    }
    this.sessions.set(ws, nextData);
    if (wasEmpty) this.ctx.waitUntil(this.scheduleAlarm());
  }

  private getSessionAdmission(
    ws: WebSocket,
  ): WsAttachment["admission"] | undefined {
    const attachment =
      ws.deserializeAttachment() as Partial<WsAttachment> | null;
    return attachment?.admission;
  }

  private isAllowedPublicDemoOpcode(op: number): boolean {
    return (
      op === Op.Identify ||
      op === Op.Heartbeat ||
      op === Op.Resume ||
      op === Op.RefreshVoiceCredentials ||
      op === Op.VoiceStateUpdate ||
      op === Op.ClientDisconnect
    );
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  private isRateLimited(ws: WebSocket, op: number): boolean {
    const session = this.getSession(ws);
    return this.rateLimiter.isLimited(
      op,
      session?.id,
      session?.user_id ?? this.getSessionAdmission(ws)?.subject,
    );
  }

  /**
   * This object's socket role: the global gateway or a channel room. Null
   * while it has not learned its slug (it never admitted a socket since its
   * storage was written); its sockets then keep every main-gateway opcode,
   * as before roles were enforced.
   */
  private get socketRole(): Extract<SocketRole, "global" | "room"> | null {
    if (this.roomSlug === VOICE_ROSTER_GATEWAY) return "global";
    if (this.roomSlug === "unknown") return null;
    return "room";
  }

  private getPresencePlatformsForUser(
    userId: string,
    options?: { excludeWs?: WebSocket },
  ): PresencePlatform[] {
    const orderedPlatforms: PresencePlatform[] = [];
    const seen = new Set<PresencePlatform>();

    for (const [sessionWs, session] of this.sessions) {
      if (options?.excludeWs && sessionWs === options.excludeWs) continue;
      if (session.user_id !== userId) continue;
      const platform = normalizePresencePlatform(session.platform);
      if (!platform || seen.has(platform)) continue;
      seen.add(platform);
      orderedPlatforms.push(platform);
    }

    return orderedPlatforms;
  }

  private getPresenceStatusForUser(
    userId: string,
    options?: { excludeWs?: WebSocket },
  ): "online" | "idle" | "dnd" | "offline" {
    for (const [sessionWs, session] of this.sessions) {
      if (options?.excludeWs && sessionWs === options.excludeWs) continue;
      if (session.user_id !== userId) continue;
      if (session.status) {
        return session.status;
      }
    }
    return "offline";
  }

  private buildPresenceSnapshotForUser(
    userId: string,
    options?: { excludeWs?: WebSocket },
  ) {
    return {
      user_id: userId,
      status: this.getPresenceStatusForUser(userId, options),
      platforms: this.getPresencePlatformsForUser(userId, options),
    };
  }

  private buildPresenceListPayload() {
    const userIds = new Set<string>();

    for (const [, session] of this.sessions) {
      if (session.user_id) {
        userIds.add(session.user_id);
      }
    }

    const users = Array.from(userIds).map((userId) =>
      this.buildPresenceSnapshotForUser(userId),
    );
    return {
      user_ids: users
        .filter((user) => user.status !== "offline")
        .map((user) => user.user_id),
      users,
    };
  }

  /** Persist voice channel members to per-channel storage keys */
  private persistVoiceChannelMembers() {
    // Track which channels currently have entries
    const activeChannelIds = new Set<string>();
    for (const [channelId, members] of this.voiceChannelMembers) {
      if (members.size > 0) {
        activeChannelIds.add(channelId);
        this.markDirty(`vc:members:${channelId}`, Array.from(members.values()));
      }
    }
  }

  /** Mark a voice channel's storage key for deletion (called when channel becomes empty) */
  private deleteVoiceChannelStorage(channelId: string) {
    this.deletedVcKeys.add(`vc:members:${channelId}`);
    // Also remove from dirty in case it was just marked
    this.dirtyStorage.delete(`vc:members:${channelId}`);
    this.deleteSpatialAudioState(channelId);
  }

  private schedulePendingCallTimeout(
    call: StoredPendingCall,
  ): ReturnType<typeof setTimeout> {
    return setTimeout(
      () => {
        const pending = this.pendingCalls.get(call.calleeId);
        if (!pending || pending.callId !== call.callId) return;
        void this.expirePendingCall(pending);
      },
      Math.max(0, call.expiresAt - Date.now()),
    );
  }

  private async expirePendingCall(pending: PendingCall) {
    const current = this.pendingCalls.get(pending.calleeId);
    if (!current || current.callId !== pending.callId) return;

    clearTimeout(pending.timeout);
    this.pendingCalls.delete(pending.calleeId);
    await this.persistPendingCalls();

    const timeoutMessage = {
      op: Op.Dispatch,
      d: {
        event: "CALL_RING_STOP",
        data: { call_id: pending.callId, reason: "timeout" },
      },
    };
    this.broadcastToUser(pending.callerId, timeoutMessage);
    this.broadcastToUser(pending.calleeId, timeoutMessage);
    this.settleRing(pending, "timeout");
    log.info(
      `Call ${pending.callId} ring timed out (caller stays in voice channel)`,
    );
  }

  private persistPendingCalls(): Promise<void> {
    const serializedPendingCalls = serializePendingCalls(this.pendingCalls);
    const write = this.scheduleDurableStateWrite(
      () =>
        this.ctx.storage.put(PENDING_CALLS_STORAGE_KEY, serializedPendingCalls),
      "pending calls",
    );
    if (this.pendingCalls.size > 0) {
      this.ctx.waitUntil(this.scheduleAlarm());
    }
    return write;
  }

  private persistSpatialAudioState(roomKey: string, state: SpatialAudioState) {
    this.scheduleDurableStateWrite(
      () => this.ctx.storage.put(getSpatialAudioStorageKey(roomKey), state),
      `spatial audio state for ${roomKey}`,
    );
  }

  private deleteSpatialAudioState(roomKey: string) {
    this.spatialAudioStates.delete(roomKey);
    this.scheduleDurableStateWrite(
      () => this.ctx.storage.delete(getSpatialAudioStorageKey(roomKey)),
      `spatial audio state for ${roomKey}`,
    );
  }

  /** Persist voice channel started-at timestamps to storage */
  private persistVoiceChannelStartedAt() {
    const serialized: Record<string, number> = {};
    for (const [channelId, ts] of this.voiceChannelStartedAt) {
      serialized[channelId] = ts;
    }
    this.markDirty("voiceChannelStartedAt", serialized);
  }

  private buildVoiceChannelStatesPayload() {
    const voiceStates: Record<string, VoiceChannelMember[]> = {};
    const voiceStartedAt: Record<string, number> = {};
    const spatialAudioStates: Record<string, SpatialAudioState> = {};
    for (const [channelId, members] of this.voiceChannelMembers) {
      if (members.size > 0) {
        voiceStates[channelId] = Array.from(members.values());
        const startedAt = this.voiceChannelStartedAt.get(channelId);
        if (startedAt) {
          voiceStartedAt[channelId] = startedAt;
        }
        const spatial = this.spatialAudioStates.get(channelId);
        if (spatial) spatialAudioStates[channelId] = spatial;
      }
    }
    return {
      voice_states: voiceStates,
      voice_started_at: voiceStartedAt,
      spatial_audio_states: spatialAudioStates,
    };
  }

  private buildVoiceChannelStateUpdateMessage(
    channelId: string,
    includeProfiles = false,
  ): ServerMsg {
    const members = this.voiceChannelMembers.get(channelId);
    return {
      op: Op.Dispatch,
      d: {
        event: "VOICE_CHANNEL_STATE_UPDATE",
        data: {
          channel_id: channelId,
          members: members
            ? Array.from(members.values()).map((member) => {
                if (includeProfiles) return member;
                const {
                  name: _name,
                  username: _username,
                  display_name: _displayName,
                  avatar_url: _avatarUrl,
                  avatar_display: _avatarDisplay,
                  ...state
                } = member;
                return state;
              })
            : [],
          started_at: this.voiceChannelStartedAt.get(channelId) ?? null,
          spatial_audio_state: this.spatialAudioStates.get(channelId),
        },
      },
    };
  }

  private async getChannelMeta(
    channelId: string,
  ): Promise<{ server_id: string | null; channel_type: string } | null> {
    const cached = this.channelMetaCache.get(channelId);
    if (cached) return cached;

    const channel = await this.env.DB.prepare(
      "SELECT server_id, channel_type FROM channels WHERE id = ? LIMIT 1",
    )
      .bind(channelId)
      .first<{ server_id: string | null; channel_type: string }>()
      .catch(() => null);

    if (!channel) return null;
    this.channelMetaCache.set(channelId, channel);
    return channel;
  }

  private async fetchServerMemberRolesForUser(
    serverId: string,
    userId: string,
  ): Promise<ChannelVisibilityRole[]> {
    const { results } = await this.env.DB.prepare(
      `SELECT r.id, r.permissions, r.is_default
       FROM server_members sm
       JOIN member_roles mr ON mr.server_id = sm.server_id AND mr.user_id = sm.user_id
       JOIN roles r ON r.id = mr.role_id
       WHERE sm.server_id = ? AND sm.user_id = ?`,
    )
      .bind(serverId, userId)
      .all()
      .catch(() => ({ results: [] }));

    return (results ?? []) as ChannelVisibilityRole[];
  }

  private async canUserAccessVoiceChannel(
    channelId: string,
    userId: string,
  ): Promise<boolean> {
    const channel = await this.getChannelMeta(channelId);
    if (!channel) return false;

    if (channel.channel_type === "dm" || channel.server_id === null) {
      const recipient = await this.env.DB.prepare(
        "SELECT 1 FROM dm_recipients WHERE channel_id = ? AND user_id = ? LIMIT 1",
      )
        .bind(channelId, userId)
        .first()
        .catch(() => null);

      return !!recipient;
    }

    const userRoles = await this.fetchServerMemberRolesForUser(
      channel.server_id,
      userId,
    );
    if (userRoles.length === 0) return false;

    const roleIds = userRoles.map((role) => role.id);
    const placeholders =
      roleIds.length > 0 ? roleIds.map(() => "?").join(",") : "''";
    const { results: overrides } = await this.env.DB.prepare(
      `SELECT channel_id, target_id, target_type, allow, deny
       FROM channel_permission_overrides
       WHERE channel_id = ?
         AND (
           (target_type = 'user' AND target_id = ?) OR
           (target_type = 'role' AND target_id IN (${placeholders}))
         )`,
    )
      .bind(channelId, userId, ...roleIds)
      .all()
      .catch(() => ({ results: [] }));

    const visiblePermissions = resolveVisibleChannelPermissions(
      [{ id: channelId }],
      userId,
      userRoles,
      (overrides ?? []) as ChannelVisibilityOverride[],
    );

    return visiblePermissions[channelId] !== undefined;
  }

  private async sendVoiceChannelStates(ws: WebSocket) {
    const session = this.getSession(ws);
    if (!session?.user_id) return;

    const data = this.buildVoiceChannelStatesPayload();
    const visibleChannelIds = new Set<string>();

    for (const channelId of Object.keys(data.voice_states)) {
      if (await this.canUserAccessVoiceChannel(channelId, session.user_id)) {
        visibleChannelIds.add(channelId);
      }
    }

    const filtered = filterVoiceChannelStatesPayload(data, visibleChannelIds);
    if (Object.keys(filtered.voice_states).length === 0) return;

    this.sendTo(ws, {
      op: Op.Dispatch,
      d: {
        event: "VOICE_CHANNEL_STATES",
        data: filtered,
      },
    });
  }

  private async broadcastVoiceChannelState(
    channelId: string,
    excludeWs?: WebSocket,
    includeProfiles = false,
  ) {
    for (const [ws, session] of this.sessions) {
      if (ws === excludeWs || !session.user_id) continue;
      if (!(await this.canUserAccessVoiceChannel(channelId, session.user_id)))
        continue;

      const message = this.buildVoiceChannelStateUpdateMessage(
        channelId,
        includeProfiles || session.supports_voice_state_deltas !== true,
      );
      this.sendReplayable(ws, session, message, {
        kind: "channel",
        channelId,
      });
    }
  }

  private getSession(ws: WebSocket): WsAttachment | undefined {
    return this.sessions.get(ws);
  }

  private getSessionSocket(sessionId: string): WebSocket | undefined {
    for (const [ws, session] of this.sessions) {
      if (session.id === sessionId) {
        return ws;
      }
    }
    return undefined;
  }

  private requireSession(ws: WebSocket): WsAttachment | null {
    const session = this.getSession(ws);
    if (!session) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.NotAuthenticated, message: "Not identified" },
      });
      return null;
    }
    return session;
  }

  private buildVoiceState(data: WsAttachment): VoiceState {
    return {
      id: data.id,
      user_id: data.user_id,
      name: data.name,
      username: data.username,
      display_name: data.display_name,
      avatar_url: data.avatar_url,
      avatar_display: data.avatar_display,
      platform: data.platform,
      stream_preview_url: data.stream_preview_url,
      self_mute: data.self_mute,
      self_deaf: data.self_deaf,
      self_stream: data.self_stream,
      self_stream_audio: data.self_stream_audio,
      self_video: data.self_video,
      spatial_audio_enabled: data.spatial_audio_enabled,
      spatial_audio_high_fidelity: data.spatial_audio_high_fidelity,
      suppress: data.suppress,
      status: data.status,
      tracks: [...data.tracks],
    };
  }

  /**
   * The roster a Ready or Resumed carries: live non-standby sessions (but
   * `exceptWs`) and non-standby sessions held for resume within grace. A
   * held session is still in the call: its abrupt close broadcast no leave
   * and its voice tracks stay. Clients replace their participant list with
   * this roster, so leaving it out made them drop that participant, and its
   * streams (a screen share included), until they rejoined.
   */
  private buildRoomRoster(exceptWs?: WebSocket): VoiceState[] {
    const participants: VoiceState[] = [];
    const liveIds = new Set<string>();
    for (const [otherWs, data] of this.sessions) {
      liveIds.add(data.id);
      if (otherWs === exceptWs || data.standby) continue;
      participants.push(this.buildVoiceState(data));
    }
    const now = Date.now();
    for (const [id, held] of this.resumableSessions) {
      if (liveIds.has(id) || held.standby) continue;
      const disconnectedAt = this.resumableSessionExpiry.get(id);
      if (
        disconnectedAt === undefined ||
        now - disconnectedAt >= RESUME_GRACE_PERIOD_MS
      ) {
        continue;
      }
      participants.push(this.buildVoiceState(held));
    }
    return participants;
  }

  private buildVoiceStateDelta(data: WsAttachment): VoiceStateDelta {
    return {
      id: data.id,
      user_id: data.user_id,
      platform: data.platform,
      stream_preview_url: data.stream_preview_url,
      self_mute: data.self_mute,
      self_deaf: data.self_deaf,
      self_stream: data.self_stream,
      self_stream_audio: data.self_stream_audio,
      self_video: data.self_video,
      spatial_audio_enabled: data.spatial_audio_enabled,
      spatial_audio_high_fidelity: data.spatial_audio_high_fidelity,
      suppress: data.suppress,
      status: data.status,
      tracks: [...data.tracks],
    };
  }

  private buildVoiceStateUpdateMessage(
    participant: WsAttachment,
    recipient: WsAttachment,
    spatialAudioState?: SpatialAudioState,
  ): ServerMsg {
    return {
      op: Op.VoiceStateUpdate,
      d: {
        participant:
          recipient.supports_voice_state_deltas === true
            ? this.buildVoiceStateDelta(participant)
            : this.buildVoiceState(participant),
        action: "update",
        spatial_audio_state: spatialAudioState,
      },
    };
  }

  private broadcastVoiceStateUpdate(
    participantWs: WebSocket,
    participant: WsAttachment,
    spatialAudioState?: SpatialAudioState,
  ) {
    const liveSessionIds = new Set(
      [...this.sessions.values()].map((session) => session.id),
    );
    for (const [ws, recipient] of this.sessions) {
      if (ws === participantWs) continue;
      this.sendReplayable(
        ws,
        recipient,
        this.buildVoiceStateUpdateMessage(
          participant,
          recipient,
          spatialAudioState,
        ),
      );
    }
    for (const [sessionId, recipient] of this.resumableSessions) {
      if (liveSessionIds.has(sessionId)) continue;
      this.queueResumable(
        recipient,
        this.buildVoiceStateUpdateMessage(
          participant,
          recipient,
          spatialAudioState,
        ),
      );
    }
  }

  private async disconnectSessionImmediately(
    userId: string,
    sessionId: string,
    channelId?: string,
  ): Promise<boolean> {
    const ws = this.getSessionSocket(sessionId);
    if (ws) {
      const session = this.getSession(ws);
      if (!session || session.user_id !== userId) return false;
      if (
        channelId &&
        session.voice_channel_id &&
        session.voice_channel_id !== channelId
      )
        return false;

      await this.handleLeave(ws, true, true);
      return true;
    }

    const resumable = this.resumableSessions.get(sessionId);
    if (!resumable || resumable.user_id !== userId) {
      return false;
    }

    if (
      channelId &&
      resumable.voice_channel_id &&
      resumable.voice_channel_id !== channelId
    ) {
      return false;
    }

    // A room's roster drops the held session once it is gone (flush).
    delete resumable.voice_channel_id;

    if (resumable.user_id) {
      this.cleanupCallsForUser(resumable.user_id, "disconnected");
    }

    this.revokeVoiceJoin(resumable);
    this.resumableSessions.delete(sessionId);
    this.replayBuffers.delete(sessionId);
    this.persistResumableSessions();
    this.resumableSessionExpiry.delete(sessionId);
    this.persistResumableSessionExpiry();

    if (!resumable.standby) {
      this.broadcast({
        op: Op.VoiceStateUpdate,
        d: {
          participant: this.buildVoiceState(resumable),
          action: "leave",
        },
      });
    }

    return true;
  }

  // ── Voice rosters: room side ───────────────────────────────────────────
  // realtime/VOICE_ROSTER.md. The room is the authority on its channel's
  // voice roster; every change goes to the global gateway as a full
  // snapshot with a strictly increasing seq.

  private persistVoiceRosterState(): void {
    this.markDirty(VOICE_ROSTER_STATE_STORAGE_KEY, {
      channel_id: this.voiceRosterChannelId,
      seq: this.voiceRosterSeq,
      fingerprint: this.voiceRosterFingerprint,
      delivered: this.voiceRosterDelivered,
      started_at: this.voiceRosterStartedAt,
      members: this.voiceRosterMembers,
      retry_at: this.voiceRosterRetryAt,
    });
  }

  /**
   * On start: members of the last roster with no live session and no session
   * held for resume were dropped by a reset (no close event ran for their
   * sockets). Hold them as reconnecting, from when that was noticed (or from
   * their stored disconnected_at, if they were already reconnecting), for
   * the rest of the resume grace.
   */
  private holdVoiceMembersLostInReset(now: number): void {
    const present = new Set<string>();
    for (const session of this.sessions.values()) {
      if (isVoiceRosterSession(session)) present.add(session.user_id);
    }
    for (const [id, session] of this.resumableSessions) {
      if (
        this.resumableSessionExpiry.has(id) &&
        isVoiceRosterSession(session)
      ) {
        present.add(session.user_id);
      }
    }
    for (const member of this.voiceRosterMembers) {
      if (present.has(member.user_id)) continue;
      const disconnectedAt = Math.min(member.disconnected_at ?? now, now);
      if (now - disconnectedAt >= RESUME_GRACE_PERIOD_MS) continue;
      this.voiceRosterResetHeld.set(member.user_id, { member, disconnectedAt });
    }
    if (this.voiceRosterResetHeld.size > 0) {
      meetingLog.info(
        `Voice roster: holding ${this.voiceRosterResetHeld.size} member(s) a reset dropped`,
      );
    }
  }

  /**
   * Room: the gateway holds `seq` for this channel, above this room's (the
   * room lost its stored seq and the clock gave a lower one). Count from
   * above it, so the next snapshot, pushed or pulled, is applied.
   */
  private raiseVoiceRosterSeqAbove(seq: number): void {
    if (this.voiceRosterSeq > seq) return;
    meetingLog.warn(
      `Voice roster seq ${this.voiceRosterSeq} is behind the gateway's ${seq}; raising it`,
    );
    this.voiceRosterSeq = nextVoiceRosterSeq(seq);
    this.persistVoiceRosterState();
  }

  /** The arrival order of a voice join, taken before Identify yields. */
  private nextVoiceJoinOrder(): number {
    this.lastVoiceJoinOrder = nextVoiceRosterSeq(this.lastVoiceJoinOrder);
    return this.lastVoiceJoinOrder;
  }

  /**
   * The room's roster now. A changed roster gets the next seq (and the room
   * remembers it); an unchanged one keeps its seq, so a re-sent snapshot is
   * a duplicate the gateway ignores.
   */
  private currentVoiceRoster(now = Date.now()): VoiceRosterSnapshot {
    const channelId = this.voiceRosterChannelId ?? "";
    const liveIds = new Set<string>();
    for (const [ws, session] of this.sessions) {
      liveIds.add(session.id);
      // Sessions from before joins were stamped: stamp them once, so the
      // roster (and its fingerprint) stays the same from call to call.
      if (!session.standby && session.voice_joined_at === undefined) {
        session.voice_joined_at = this.voiceRosterStartedAt ?? now;
        this.persist(ws, session);
      }
    }
    const held: Array<{ session: WsAttachment; disconnectedAt: number }> = [];
    let heldStamped = false;
    for (const [id, session] of this.resumableSessions) {
      if (liveIds.has(id)) continue;
      const disconnectedAt = this.resumableSessionExpiry.get(id);
      if (disconnectedAt === undefined) continue;
      if (!session.standby && session.voice_joined_at === undefined) {
        session.voice_joined_at = this.voiceRosterStartedAt ?? disconnectedAt;
        heldStamped = true;
      }
      held.push({ session, disconnectedAt });
    }
    if (heldStamped) this.persistResumableSessions();

    // Members a reset dropped: gone once their user has a session again
    // (a later leave must not bring them back as reconnecting) or once the
    // grace runs out.
    if (this.voiceRosterResetHeld.size > 0) {
      const present = new Set<string>();
      for (const session of this.sessions.values()) {
        if (isVoiceRosterSession(session)) present.add(session.user_id);
      }
      for (const { session } of held) {
        if (isVoiceRosterSession(session)) present.add(session.user_id);
      }
      for (const [userId, lost] of this.voiceRosterResetHeld) {
        if (
          present.has(userId) ||
          now - lost.disconnectedAt >= RESUME_GRACE_PERIOD_MS
        ) {
          this.voiceRosterResetHeld.delete(userId);
          continue;
        }
        held.push({
          session: voiceRosterSessionOf(lost.member) as WsAttachment,
          disconnectedAt: lost.disconnectedAt,
        });
      }
    }

    const members = buildVoiceRosterMembers(this.sessions.values(), held, {
      graceMs: RESUME_GRACE_PERIOD_MS,
      now,
      fallbackJoinedAt: this.voiceRosterStartedAt ?? now,
    });
    const startedBefore = this.voiceRosterStartedAt;
    if (members.length === 0) {
      this.voiceRosterStartedAt = null;
    } else if (this.voiceRosterStartedAt === null) {
      this.voiceRosterStartedAt = Math.min(
        now,
        ...members.map((member) => member.joined_at),
      );
    }
    const startedAt = this.voiceRosterStartedAt;
    const fingerprint = voiceRosterFingerprint({
      channel_id: channelId,
      started_at: startedAt,
      members,
    });
    if (
      fingerprint !== this.voiceRosterFingerprint ||
      startedAt !== startedBefore
    ) {
      if (fingerprint !== this.voiceRosterFingerprint) {
        this.voiceRosterSeq = nextVoiceRosterSeq(this.voiceRosterSeq, now);
        this.voiceRosterFingerprint = fingerprint;
        this.voiceRosterMembers = members;
      }
      this.persistVoiceRosterState();
    }
    return {
      channel_id: channelId,
      room_slug: this.roomSlug,
      seq: this.voiceRosterSeq,
      started_at: startedAt,
      members,
    };
  }

  /** Room: push the roster if it changed since the gateway last took it. */
  private syncVoiceRoster(): void {
    if (
      !this.voiceRosterChannelId ||
      this.roomSlug === VOICE_ROSTER_GATEWAY ||
      this.roomSlug === "unknown"
    ) {
      return;
    }
    this.currentVoiceRoster();
    if (this.voiceRosterFingerprint !== this.voiceRosterDelivered) {
      this.voiceRosterPusher.request();
    }
  }

  /** One push attempt (VoiceRosterPusher retries); true once delivered. */
  private async pushVoiceRoster(): Promise<boolean> {
    const namespace = this.env.MEETING_ROOM;
    if (!namespace || !this.voiceRosterChannelId) return true;
    const snapshot = this.currentVoiceRoster();
    const fingerprint = this.voiceRosterFingerprint;
    if (fingerprint === this.voiceRosterDelivered) return true;
    const response = await namespace
      .get(namespace.idFromName(VOICE_ROSTER_GATEWAY))
      .fetch(`https://internal${VOICE_ROSTER_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
    if (!response.ok) {
      await response.body?.cancel();
      meetingLog.warn(`Voice roster push rejected: status=${response.status}`);
      return false;
    }
    const reply = parseVoiceRosterPushReply(
      await response.json().catch(() => null),
    );
    if (reply && !reply.applied && (reply.seq ?? 0) > snapshot.seq) {
      // Ignored as older than what the gateway holds: send it again (after
      // the first backoff step) with a seq above the gateway's.
      this.raiseVoiceRosterSeqAbove(reply.seq ?? 0);
      this.flushDirtyStorage();
      return false;
    }
    this.voiceRosterDelivered = fingerprint;
    this.persistVoiceRosterState();
    this.flushDirtyStorage();
    return true;
  }

  // ── Voice rosters: global gateway side ─────────────────────────────────
  // voiceChannelMembers mirrors the rooms' rosters. Nothing a client sends
  // here adds or removes a member: op 33/34 are hints that may trigger a
  // pull, and op 15 only sets VoiceMemberHint fields on an existing member.

  private normalizeVoiceRosterSource(value: unknown): VoiceRosterSource | null {
    if (!this.isPlainObject(value)) return null;
    const { roomSlug, seq, confirmedAt, hints } = value;
    if (
      (roomSlug !== null && typeof roomSlug !== "string") ||
      typeof seq !== "number" ||
      typeof confirmedAt !== "number"
    ) {
      return null;
    }
    return {
      roomSlug,
      seq,
      confirmedAt,
      ...(this.isPlainObject(hints)
        ? { hints: hints as Record<string, VoiceMemberHint> }
        : {}),
    };
  }

  private persistVoiceRosterSource(channelId: string): void {
    const key = `${VOICE_ROSTER_SOURCE_PREFIX}${channelId}`;
    const source = this.voiceRosterSources.get(channelId);
    if (!source) {
      this.dirtyStorage.delete(key);
      this.deletedVcKeys.add(key);
      return;
    }
    this.deletedVcKeys.delete(key);
    this.markDirty(key, source);
  }

  private applyVoiceMemberHint(
    member: VoiceChannelMember,
    hint: VoiceMemberHint | undefined,
  ): void {
    if (!hint) return;
    if (hint.stream_preview_url !== undefined) {
      member.stream_preview_url = hint.stream_preview_url;
    }
    if (hint.spatial_audio_enabled !== undefined) {
      member.spatial_audio_enabled = hint.spatial_audio_enabled;
    }
    if (hint.spatial_audio_high_fidelity !== undefined) {
      member.spatial_audio_high_fidelity = hint.spatial_audio_high_fidelity;
    }
  }

  /**
   * Applies a room's snapshot when its seq is newer than the last applied
   * one for the channel (else a no-op; an equal seq only confirms). Returns
   * whether it was applied.
   */
  private applyVoiceRosterSnapshot(snapshot: VoiceRosterSnapshot): boolean {
    const now = Date.now();
    const channelId = snapshot.channel_id;
    const source = this.voiceRosterSources.get(channelId);
    if (source?.roomSlug && source.roomSlug !== snapshot.room_slug) {
      meetingLog.warn(
        `Voice roster for ${channelId} from ${snapshot.room_slug} ignored; it belongs to ${source.roomSlug}`,
      );
      return false;
    }
    const lastSeq = source?.roomSlug ? source.seq : undefined;
    if (!isNewerVoiceRoster(lastSeq, snapshot.seq)) {
      if (source && snapshot.seq === source.seq) {
        source.confirmedAt = now;
        this.persistVoiceRosterSource(channelId);
      }
      return false;
    }

    const wasMirrored = this.voiceChannelMembers.has(channelId);
    const hints = { ...source?.hints };
    const next = new Map<string, VoiceChannelMember>();
    for (const rosterMember of snapshot.members) {
      const identity = this.profileIdentities.get(rosterMember.user_id);
      const member: VoiceChannelMember = identity
        ? { ...rosterMember, ...identity }
        : { ...rosterMember };
      this.applyVoiceMemberHint(member, hints[rosterMember.user_id]);
      next.set(rosterMember.user_id, member);
    }
    for (const userId of Object.keys(hints)) {
      if (!next.has(userId)) delete hints[userId];
    }
    this.voiceRosterSources.set(channelId, {
      roomSlug: snapshot.room_slug,
      seq: snapshot.seq,
      confirmedAt: now,
      ...(Object.keys(hints).length > 0 ? { hints } : {}),
    });
    this.persistVoiceRosterSource(channelId);
    this.replaceVoiceChannelMembers(channelId, next, snapshot.started_at);
    if (!source?.roomSlug || !wasMirrored) {
      // A new (or newly non-empty) channel: its revalidation deadline may
      // be earlier than the alarm already set.
      this.ctx.waitUntil(this.scheduleAlarm());
    }
    return true;
  }

  /**
   * Sets a channel's mirrored members and does what a change means here:
   * the sidebar update, a ring the callee answered by joining, a ring or an
   * answered call whose channel emptied.
   */
  private replaceVoiceChannelMembers(
    channelId: string,
    next: Map<string, VoiceChannelMember>,
    startedAt: number | null,
  ): boolean {
    const previous =
      this.voiceChannelMembers.get(channelId) ??
      new Map<string, VoiceChannelMember>();
    const inserted = [...next.keys()].filter((id) => !previous.has(id));
    const profileChanged = [...next].some(([id, member]) => {
      const before = previous.get(id);
      return (
        !!before &&
        (before.name !== member.name ||
          before.username !== member.username ||
          (before.display_name ?? null) !== (member.display_name ?? null) ||
          (before.avatar_url ?? null) !== (member.avatar_url ?? null) ||
          (before.avatar_display ?? null) !== (member.avatar_display ?? null))
      );
    });
    const sameMembers =
      previous.size === next.size &&
      [...next].every(
        ([id, member]) =>
          JSON.stringify(previous.get(id)) === JSON.stringify(member),
      );
    const startedBefore = this.voiceChannelStartedAt.get(channelId) ?? null;
    const startedNow =
      next.size > 0 ? (startedAt ?? startedBefore ?? Date.now()) : null;
    if (sameMembers && startedBefore === startedNow) return false;

    if (next.size === 0) {
      this.voiceChannelMembers.delete(channelId);
      this.deleteVoiceChannelStorage(channelId);
      this.voiceChannelStartedAt.delete(channelId);
      this.persistVoiceChannelStartedAt();
      if (previous.size > 0) {
        this.cancelAbandonedRing(channelId);
        this.finishActiveCall(channelId);
      }
    } else {
      this.voiceChannelMembers.set(channelId, next);
      this.voiceChannelStartedAt.set(channelId, startedNow ?? Date.now());
      this.persistVoiceChannelStartedAt();
      this.persistVoiceChannelMembers();
    }
    for (const userId of inserted) this.acceptRingOnJoin(userId, channelId);
    if (previous.size > 0 || next.size > 0) {
      this.ctx.waitUntil(
        this.broadcastVoiceChannelState(
          channelId,
          undefined,
          inserted.length > 0 || profileChanged,
        ),
      );
    }
    return true;
  }

  /** The callee joined the ringing DM's voice instead of pressing Accept. */
  private acceptRingOnJoin(userId: string, channelId: string): void {
    const pending = this.pendingCalls.get(userId);
    if (!pending || pending.channelId !== channelId) return;
    log.info(`Callee joined the ringing DM: accepting call ${pending.callId}`);
    const callId = pending.callId;
    clearTimeout(pending.timeout);
    this.pendingCalls.delete(userId);
    this.persistPendingCalls();
    // A late Op 37 (CallAccept) for this call is then a no-op.
    this.acceptedCalls.add(callId);
    setTimeout(() => this.acceptedCalls.delete(callId), 10000);
    const evt = {
      op: Op.Dispatch,
      d: {
        event: "CALL_RING_STOP",
        data: { call_id: callId, reason: "accepted" },
      },
    };
    this.broadcastToUser(pending.callerId, evt);
    this.broadcastToUser(pending.calleeId, evt);
    this.settleRing(pending, "accepted");
  }

  /** The DM's voice emptied while it rang (the caller gave up). */
  private cancelAbandonedRing(channelId: string): void {
    for (const call of this.pendingCalls.values()) {
      if (call.channelId !== channelId) continue;
      log.info(`DM Call ${call.callId} emptied during ring, cancelling`);
      clearTimeout(call.timeout);
      this.pendingCalls.delete(call.calleeId);
      this.persistPendingCalls();
      const endMsg = {
        op: Op.Dispatch,
        d: {
          event: "CALL_RING_STOP",
          data: { call_id: call.callId, reason: "abandoned" },
        },
      };
      this.broadcastToUser(call.callerId, endMsg);
      this.broadcastToUser(call.calleeId, endMsg);
      this.settleRing(call, "abandoned");
      return;
    }
  }

  /**
   * Drops pre-push entries whose room never claimed them, and forgets the
   * seq of channels empty for VOICE_ROSTER_TOMBSTONE_MS.
   */
  private pruneVoiceRosterSources(now: number): void {
    for (const [channelId, source] of [...this.voiceRosterSources]) {
      if (source.roomSlug === null) {
        if (now - source.confirmedAt < VOICE_ROSTER_LEGACY_GRACE_MS) continue;
        log.info(`Dropping unclaimed voice roster for ${channelId}`);
        this.voiceRosterSources.delete(channelId);
        this.persistVoiceRosterSource(channelId);
        this.replaceVoiceChannelMembers(channelId, new Map(), null);
        continue;
      }
      if (
        !this.voiceChannelMembers.has(channelId) &&
        now - source.confirmedAt >= VOICE_ROSTER_TOMBSTONE_MS
      ) {
        this.voiceRosterSources.delete(channelId);
        this.voiceRosterPullAttempts.delete(channelId);
        this.persistVoiceRosterSource(channelId);
      }
    }
  }

  /** Pulls every non-empty channel no push or pull confirmed in `minAgeMs`. */
  private async revalidateVoiceRosters(minAgeMs: number): Promise<void> {
    const now = Date.now();
    const pulls: Promise<void>[] = [];
    for (const [channelId, source] of this.voiceRosterSources) {
      if (!source.roomSlug || !this.voiceChannelMembers.has(channelId)) {
        continue;
      }
      const last = Math.max(
        source.confirmedAt,
        this.voiceRosterPullAttempts.get(channelId) ?? 0,
      );
      if (now - last < minAgeMs) continue;
      pulls.push(this.pullVoiceRoster(channelId, source.roomSlug));
    }
    if (pulls.length === 0) return;
    await Promise.all(pulls);
    this.flushDirtyStorage();
  }

  private async pullVoiceRoster(
    channelId: string,
    roomSlug: string,
  ): Promise<void> {
    const namespace = this.env.MEETING_ROOM;
    if (!namespace || this.voiceRosterPulls.has(channelId)) return;
    this.voiceRosterPulls.add(channelId);
    this.voiceRosterPullAttempts.set(channelId, Date.now());
    try {
      const response = await namespace
        .get(namespace.idFromName(roomSlug))
        .fetch(`https://internal${VOICE_ROSTER_PULL_PATH}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel_id: channelId,
            room_slug: roomSlug,
            min_seq: this.voiceRosterSources.get(channelId)?.seq ?? 0,
          }),
        });
      if (!response.ok) {
        await response.body?.cancel();
        meetingLog.warn(
          `Voice roster pull for ${channelId} failed: status=${response.status}`,
        );
        return;
      }
      const snapshot = parseVoiceRosterSnapshot(
        await response.json().catch(() => null),
      );
      if (
        snapshot &&
        snapshot.channel_id === channelId &&
        snapshot.room_slug === roomSlug
      ) {
        this.applyVoiceRosterSnapshot(snapshot);
      }
    } catch (error) {
      meetingLog.warn(`Voice roster pull for ${channelId} failed`, error);
    } finally {
      this.voiceRosterPulls.delete(channelId);
    }
  }

  /**
   * A client's op 33/34 (released mobile, older desktop and web builds):
   * never a membership change, only a reason to pull the room's roster if
   * the gateway has not heard from it for a while.
   */
  private hintVoiceRoster(channelId: string): void {
    const source = this.voiceRosterSources.get(channelId);
    if (!source?.roomSlug) return;
    const last = Math.max(
      source.confirmedAt,
      this.voiceRosterPullAttempts.get(channelId) ?? 0,
    );
    if (Date.now() - last < VOICE_ROSTER_HINT_MIN_AGE_MS) return;
    this.ctx.waitUntil(
      this.pullVoiceRoster(channelId, source.roomSlug).then(() =>
        this.flushDirtyStorage(),
      ),
    );
  }

  /**
   * The channel a global session's op 15 is about: the one its op 33 named
   * if the room has the user there, else the only channel the user is in.
   */
  private resolveVoiceHintChannel(session: WsAttachment): string | null {
    const userId = session.user_id;
    if (!userId) return null;
    const hinted = session.voice_channel_id;
    if (hinted && this.voiceChannelMembers.get(hinted)?.has(userId)) {
      return hinted;
    }
    let found: string | null = null;
    for (const [channelId, members] of this.voiceChannelMembers) {
      if (!members.has(userId)) continue;
      if (found) return null;
      found = channelId;
    }
    return found;
  }

  /** Records hint fields for a member the room has; true if it changed. */
  private setVoiceMemberHint(
    channelId: string,
    userId: string,
    patch: VoiceMemberHint,
  ): boolean {
    const member = this.voiceChannelMembers.get(channelId)?.get(userId);
    const source = this.voiceRosterSources.get(channelId);
    if (!member || !source) return false;
    source.hints = {
      ...source.hints,
      [userId]: { ...source.hints?.[userId], ...patch },
    };
    this.persistVoiceRosterSource(channelId);
    const before = JSON.stringify(member);
    this.applyVoiceMemberHint(member, patch);
    if (JSON.stringify(member) === before) return false;
    this.persistVoiceChannelMembers();
    return true;
  }

  // ── Voice join grants ──────────────────────────────────────────────────
  // The voice room only serves participants this room reports as joined.

  private get grantsVoiceJoins(): boolean {
    return (
      !!this.env.VOICE_ROOM &&
      this.roomSlug !== "unknown" &&
      this.roomSlug !== "global-gateway"
    );
  }

  private isVoiceJoinGranted({
    participantId,
    subject,
  }: VoiceJoinGrantQuery): boolean {
    if (this.identifyingVoiceJoins.get(participantId) === subject) return true;
    for (const session of this.sessions.values()) {
      if (session.id !== participantId) continue;
      return !session.standby && session.admission?.subject === subject;
    }
    const resumable = this.resumableSessions.get(participantId);
    return (
      !!resumable &&
      !resumable.standby &&
      resumable.admission?.subject === subject
    );
  }

  /** Pushes join state to the channel's VoiceRoom without blocking. */
  private pushVoiceJoinGrant(
    participantId: string,
    subject: string | undefined,
    granted: boolean,
    replaced = false,
    moved = false,
  ): void {
    const namespace = this.env.VOICE_ROOM;
    if (!namespace || !subject || !this.grantsVoiceJoins) return;
    const body = serializeVoiceJoinGrantUpdate({
      participantId,
      subject,
      granted,
      seq: this.nextVoiceJoinGrantSeq(),
      replaced,
      moved,
    });
    const push = namespace
      .get(namespace.idFromName(this.roomSlug))
      .fetch(`https://internal${VOICE_JOIN_GRANT_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
      .then(async (response) => {
        if (!response.ok) {
          meetingLog.warn(
            `Voice join grant push rejected: status=${response.status}`,
          );
        }
        await response.body?.cancel();
      })
      .catch((error: unknown) => {
        meetingLog.warn("Voice join grant push failed", error);
      });
    this.ctx.waitUntil(push);
  }

  private revokeVoiceJoin(
    session: WsAttachment,
    replaced = false,
    moved = false,
  ): void {
    if (session.standby) return;
    this.pushVoiceJoinGrant(
      session.id,
      session.admission?.subject,
      false,
      replaced,
      moved,
    );
  }

  // ── One voice session per user ─────────────────────────────────────────

  /**
   * One voice session per user per room: the user's newest join (an Identify
   * or a standby promotion) ends their other sessions here, live or held for
   * resume. Each live one hears SessionReplaced and is closed with it, so its
   * client stops instead of reconnecting; its grant is revoked as replaced,
   * so the VoiceRoom closes its voice socket the same way; the room hears it
   * leave. A replaced id is remembered: resuming it answers SessionReplaced,
   * so a device that was offline during the takeover cannot claim it back.
   */
  private replaceOtherVoiceSessions(
    ws: WebSocket,
    session: WsAttachment,
  ): boolean {
    const userId = session.user_id;
    if (
      !userId ||
      session.standby ||
      !this.grantsVoiceJoins ||
      session.admission?.accessMode !== "authenticated"
    ) {
      return false;
    }
    // Newest join wins, by arrival: an Identify that started before another
    // one of this user's but finished after it is the one replaced.
    const order = session.voice_join_order ?? 0;
    for (const [otherWs, other] of this.sessions) {
      if (
        otherWs !== ws &&
        other.id !== session.id &&
        other.user_id === userId &&
        !other.standby &&
        (other.voice_join_order ?? 0) > order
      ) {
        meetingLog.info(
          `Voice join ${session.id} finished after newer join ${other.id}; it is replaced`,
        );
        this.rememberReplacedVoiceSession(session.id);
        this.persistReplacedVoiceSessions();
        this.sendTo(ws, {
          op: Op.Error,
          d: {
            code: CloseCode.SessionReplaced,
            message: VOICE_SESSION_REPLACED_REASON,
          },
        });
        // handleLeave does all its work before it returns.
        void this.handleLeave(ws, true, false, true);
        try {
          ws.close(CloseCode.SessionReplaced, VOICE_SESSION_REPLACED_REASON);
        } catch {
          /* already closed */
        }
        return true;
      }
    }
    let remembered = false;
    for (const [otherWs, other] of [...this.sessions]) {
      if (
        otherWs === ws ||
        other.id === session.id ||
        other.user_id !== userId ||
        other.standby
      ) {
        continue;
      }
      meetingLog.info(
        `Voice moved to another device: ${other.id} replaced by ${session.id}`,
      );
      this.rememberReplacedVoiceSession(other.id);
      remembered = true;
      this.sendTo(otherWs, {
        op: Op.Error,
        d: {
          code: CloseCode.SessionReplaced,
          message: VOICE_SESSION_REPLACED_REASON,
        },
      });
      // handleLeave does all its work before it returns.
      void this.handleLeave(otherWs, true, false, true);
      try {
        otherWs.close(CloseCode.SessionReplaced, VOICE_SESSION_REPLACED_REASON);
      } catch {
        /* already closed */
      }
    }
    for (const [id, resumable] of [...this.resumableSessions]) {
      if (
        id === session.id ||
        resumable.user_id !== userId ||
        resumable.standby
      ) {
        continue;
      }
      meetingLog.info(
        `Voice moved to another device: held session ${id} replaced by ${session.id}`,
      );
      this.rememberReplacedVoiceSession(id);
      remembered = true;
      this.revokeVoiceJoin(resumable, true);
      this.resumableSessions.delete(id);
      this.replayBuffers.delete(id);
      this.replayPersistWrites.delete(id);
      this.resumableSessionExpiry.delete(id);
      this.persistResumableSessions();
      this.persistResumableSessionExpiry();
      this.broadcast({
        op: Op.VoiceStateUpdate,
        d: {
          participant: this.buildVoiceState(resumable),
          action: "leave",
        },
      });
    }
    if (remembered) this.persistReplacedVoiceSessions();
    return false;
  }

  // ── Moderator moves ────────────────────────────────────────────────────

  /**
   * Ends `userId`'s voice session(s) in this room for a moderator's move.
   * Each live one hears VoiceMove (where to go, and a grant to get in), then
   * is closed with SessionReplaced: a current client switches channels, an
   * old one stops as it does on a device takeover, and none reconnects here.
   * Held sessions (a client offline or mid-reconnect) end too; their notice
   * is kept, so a Resume of one hears the same VoiceMove before its close.
   * The VoiceRoom closes their voice sockets with the moved reason. Standby
   * sessions are not in voice and stay.
   * Returns how many sessions ended; 0 means the user is not in voice here.
   */
  private moveVoiceSessions(userId: string, notice: VoiceMoveNotice): number {
    let moved = 0;
    for (const [ws, session] of [...this.sessions]) {
      if (session.user_id !== userId || session.standby) continue;
      meetingLog.info(
        `Voice session ${session.id} moved to channel ${notice.channel_id}`,
      );
      this.rememberReplacedVoiceSession(session.id);
      // Kept in case this frame never lands and the client resumes.
      this.movedVoiceSessions.set(session.id, {
        userId,
        notice,
        movedAt: Date.now(),
      });
      moved += 1;
      this.sendTo(ws, { op: Op.VoiceMove, d: notice });
      // handleLeave does all its work before it returns.
      void this.handleLeave(ws, true, false, true, true);
      try {
        ws.close(CloseCode.SessionReplaced, VOICE_MOVED_CLOSE_REASON);
      } catch {
        /* already closed */
      }
    }
    for (const [id, resumable] of [...this.resumableSessions]) {
      if (resumable.user_id !== userId || resumable.standby) continue;
      meetingLog.info(`Held voice session ${id} moved to ${notice.channel_id}`);
      this.rememberReplacedVoiceSession(id);
      this.movedVoiceSessions.set(id, {
        userId,
        notice,
        movedAt: Date.now(),
      });
      moved += 1;
      this.revokeVoiceJoin(resumable, true, true);
      this.resumableSessions.delete(id);
      this.replayBuffers.delete(id);
      this.replayPersistWrites.delete(id);
      this.resumableSessionExpiry.delete(id);
      this.persistResumableSessions();
      this.persistResumableSessionExpiry();
      this.broadcast({
        op: Op.VoiceStateUpdate,
        d: {
          participant: this.buildVoiceState(resumable),
          action: "leave",
        },
      });
    }
    if (moved > 0) {
      this.persistReplacedVoiceSessions();
      this.persistMovedVoiceSessions();
    }
    return moved;
  }

  private persistMovedVoiceSessions(): void {
    const now = Date.now();
    for (const [id, move] of this.movedVoiceSessions) {
      if (now - move.movedAt >= REPLACED_VOICE_SESSION_TTL_MS) {
        this.movedVoiceSessions.delete(id);
      }
    }
    this.markDirty(
      MOVED_VOICE_SESSIONS_STORAGE_KEY,
      Object.fromEntries(this.movedVoiceSessions),
    );
  }

  private rememberReplacedVoiceSession(participantId: string): void {
    const now = Date.now();
    this.pruneReplacedVoiceSessions(now);
    this.replacedVoiceSessions.set(participantId, now);
  }

  private isReplacedVoiceSession(participantId: string): boolean {
    const replacedAt = this.replacedVoiceSessions.get(participantId);
    return (
      replacedAt !== undefined &&
      Date.now() - replacedAt < REPLACED_VOICE_SESSION_TTL_MS
    );
  }

  private pruneReplacedVoiceSessions(now: number): boolean {
    let changed = false;
    for (const [id, replacedAt] of this.replacedVoiceSessions) {
      if (now - replacedAt < REPLACED_VOICE_SESSION_TTL_MS) continue;
      this.replacedVoiceSessions.delete(id);
      changed = true;
    }
    return changed;
  }

  private persistReplacedVoiceSessions(): void {
    this.markDirty(
      REPLACED_VOICE_SESSIONS_STORAGE_KEY,
      Object.fromEntries(this.replacedVoiceSessions),
    );
  }

  // ── Voice token generation ─────────────────────────────────────────────
  // HMAC-signed token: "payload.signature" where payload = "participant_id:room_slug:timestamp"

  private async generateVoiceToken(
    participantId: string,
    userId?: string,
  ): Promise<string> {
    try {
      if (!this.env.CALLS_APP_SECRET) {
        meetingLog.warn("CALLS_APP_SECRET not set, skipping voice token");
        return "";
      }
      return await issueVoiceToken({
        participantId,
        roomSlug: this.roomSlug ?? "unknown",
        subject: userId,
        secret: this.env.CALLS_APP_SECRET,
      });
    } catch (err) {
      meetingLog.error("Voice token generation failed:", err);
      return "";
    }
  }

  private get roomSlug(): string {
    return this._roomSlug;
  }
  private set roomSlug(val: string) {
    this._roomSlug = val;
  }

  /** Persist resumable sessions to storage for hibernation survival */
  private persistResumableSessions() {
    const serialized: Record<string, ResumableSessionSnapshot> = {};
    const liveSessionIds = new Set(
      [...this.sessions.values()].map((session) => session.id),
    );
    for (const [id, attachment] of this.resumableSessions) {
      if (liveSessionIds.has(id)) continue;
      serialized[id] = {
        attachment,
        replay: this.replayBuffers.get(id) ?? [],
        persist_writes: this.replayPersistWrites.get(id) ?? 0,
      };
    }
    this.markDirty("resumableSessions", serialized);
  }

  private normalizeReplayPersistWrites(value: unknown) {
    return typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= MAX_REPLAY_PERSIST_WRITES
      ? value
      : MAX_REPLAY_PERSIST_WRITES;
  }

  /** Persist resumable session expiry map to storage for hibernation survival */
  private persistResumableSessionExpiry() {
    const serialized: Record<string, number> = {};
    for (const [id, ts] of this.resumableSessionExpiry) {
      serialized[id] = ts;
    }
    this.markDirty("resumableSessionExpiry", serialized);
  }

  private getCanonicalProfileIdentity(
    userId: string,
  ): ProfileIdentity | undefined {
    const cached = this.profileIdentities.get(userId);
    if (cached) return { ...cached };

    for (const members of this.voiceChannelMembers.values()) {
      const member = members.get(userId);
      if (!member) continue;
      return {
        name: member.name,
        username: member.username,
        display_name: member.display_name ?? null,
        avatar_url: member.avatar_url ?? null,
        avatar_display: member.avatar_display ?? null,
      };
    }

    for (const session of this.sessions.values()) {
      if (session.user_id !== userId) continue;
      return {
        name: session.name,
        username: session.username,
        display_name: session.display_name ?? null,
        avatar_url: session.avatar_url ?? null,
        avatar_display: session.avatar_display ?? null,
      };
    }

    for (const session of this.resumableSessions.values()) {
      if (session.user_id !== userId) continue;
      return {
        name: session.name,
        username: session.username,
        display_name: session.display_name ?? null,
        avatar_url: session.avatar_url ?? null,
        avatar_display: session.avatar_display ?? null,
      };
    }

    return undefined;
  }

  private setSessionProfileIdentity(
    session: WsAttachment,
    identity: ProfileIdentity,
  ) {
    session.name = identity.name;
    session.username = identity.username;
    session.display_name = identity.display_name;
    session.avatar_url = identity.avatar_url;
    session.avatar_display = identity.avatar_display;
  }

  private async applyPartialProfileIdentity(
    userId: string,
    patch: ProfileIdentityPatch,
  ) {
    const currentIdentity = this.getCanonicalProfileIdentity(userId);
    if (!currentIdentity) return;

    const mergedIdentity: ProfileIdentity = {
      ...currentIdentity,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.username !== undefined ? { username: patch.username } : {}),
      ...(patch.display_name !== undefined
        ? { display_name: patch.display_name }
        : {}),
      ...(patch.avatar_url !== undefined
        ? { avatar_url: patch.avatar_url }
        : {}),
      ...(patch.avatar_display !== undefined
        ? { avatar_display: patch.avatar_display }
        : {}),
    };
    mergedIdentity.name = getDisplayName(
      {
        display_name: mergedIdentity.display_name,
        username: mergedIdentity.username,
        name: mergedIdentity.name,
      },
      mergedIdentity.name,
    );
    this.profileIdentities.set(userId, mergedIdentity);

    for (const [sessionWs, session] of this.sessions) {
      if (session.user_id !== userId) continue;
      this.setSessionProfileIdentity(session, mergedIdentity);
      this.persist(sessionWs, session);
    }

    let updatedResumableSession = false;
    for (const session of this.resumableSessions.values()) {
      if (session.user_id !== userId) continue;
      this.setSessionProfileIdentity(session, mergedIdentity);
      updatedResumableSession = true;
    }
    if (updatedResumableSession) this.persistResumableSessions();

    const updatedChannelIds: string[] = [];
    for (const [channelId, members] of this.voiceChannelMembers) {
      const member = members.get(userId);
      if (!member) continue;
      members.set(userId, refreshVoiceMemberIdentity(member, mergedIdentity));
      updatedChannelIds.push(channelId);
    }
    if (updatedChannelIds.length > 0) this.persistVoiceChannelMembers();

    // ProfileUpdate is an SFU-room protocol message; global chat clients
    // consume the existing USER_PROFILE_UPDATE dispatch below instead.
    for (const channelId of updatedChannelIds) {
      await this.broadcastVoiceChannelState(channelId, undefined, true);
    }
  }

  private async updateProfileIdentity(
    userId: string,
    identity: ProfileIdentity,
  ) {
    this.profileIdentities.set(userId, { ...identity });

    const liveSessions: WsAttachment[] = [];
    for (const [sessionWs, session] of this.sessions) {
      if (session.user_id !== userId) continue;
      this.setSessionProfileIdentity(session, identity);
      this.persist(sessionWs, session);
      liveSessions.push(session);
    }

    let updatedResumableSession = false;
    for (const session of this.resumableSessions.values()) {
      if (session.user_id !== userId) continue;
      this.setSessionProfileIdentity(session, identity);
      updatedResumableSession = true;
    }
    if (updatedResumableSession) this.persistResumableSessions();

    const updatedChannelIds: string[] = [];
    for (const [channelId, members] of this.voiceChannelMembers) {
      const member = members.get(userId);
      if (!member) continue;
      members.set(userId, refreshVoiceMemberIdentity(member, identity));
      updatedChannelIds.push(channelId);
    }
    if (updatedChannelIds.length > 0) this.persistVoiceChannelMembers();

    for (const session of liveSessions) {
      this.broadcast({
        op: Op.ProfileUpdate,
        d: {
          participant_id: session.id,
          ...identity,
        },
      });
    }
    for (const channelId of updatedChannelIds) {
      await this.broadcastVoiceChannelState(channelId, undefined, true);
    }
  }

  // ── Op 0: Identify ────────────────────────────────────────────────────

  private async handleIdentify(
    ws: WebSocket,
    d: MainClientPayload<Op.Identify>,
  ) {
    if (this.getSession(ws)) {
      log.info(`AlreadyAuthenticated — session exists for this WS`);
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.AlreadyAuthenticated,
          message: "Already identified",
        },
      });
      return;
    }

    let voiceJoin: { participantId: string; subject: string } | null = null;
    try {
      const admission = this.getSessionAdmission(ws);
      if (!admission) {
        this.sendTo(ws, {
          op: Op.Error,
          d: {
            code: CloseCode.NotAuthenticated,
            message: "Missing realtime admission",
          },
        });
        return;
      }
      const participantId = admission.participantId;
      // Join order is taken on arrival, before any await: of two Identifies
      // of one user, the one that arrived last wins, whichever finishes first.
      const voiceJoinOrder =
        d.standby !== true ? this.nextVoiceJoinOrder() : undefined;
      const voiceJoinedAt = d.standby !== true ? Date.now() : undefined;
      // Grant voice before the slow profile/TURN/D1 work below, so a voice
      // Identify sent straight from the ticket bootstrap waits only for this
      // message to arrive, not for Ready. Standby sessions never get a grant.
      if (d.standby !== true) {
        voiceJoin = { participantId, subject: admission.subject };
        this.identifyingVoiceJoins.set(participantId, admission.subject);
        this.pushVoiceJoinGrant(participantId, admission.subject, true);
      }
      const admittedUserId =
        admission.accessMode === "authenticated"
          ? admission.subject
          : undefined;
      const profileRequest = admittedUserId
        ? this.profileRequestCoordinator.begin(admittedUserId)
        : null;

      // Run all async sub-tasks in parallel to reduce time-to-Ready.
      // Previously these ran sequentially, adding the SUM of their latencies.
      // Now total latency = max(single call) instead of sum(all calls).
      const [iceServers, profile, userRow, voiceToken] = await Promise.all([
        this.generateTurnCredentials(),
        admittedUserId ? this.fetchProfile(admittedUserId) : null,
        admittedUserId
          ? this.env.DB.prepare("SELECT status FROM users WHERE id = ?")
              .bind(admittedUserId)
              .first<{ status: string }>()
              .catch((e: unknown) => {
                identifyLog.error("D1 status fetch failed:", e);
                return null;
              })
          : null,
        this.generateVoiceToken(participantId, admission.subject),
      ]);
      if (this.abandonStaleIdentify(ws, voiceJoin)) return;

      this.sendTo(ws, {
        op: Op.MediaReady,
        d: {
          participant_id: participantId,
          ice_servers: iceServers,
          voice_token: voiceToken,
        },
      });

      // Prefer the stored profile (D1) over the identity the client sent
      let resolvedName = d.name;
      let resolvedUsername = d.username ?? d.name;
      let resolvedDisplayName = d.display_name ?? null;
      let resolvedAvatar: string | null | undefined = d.avatar_url;
      // An AvatarDisplay object (not only its string form) is stored and
      // broadcast as sent, as before; profiles from the resolver are strings.
      let resolvedAvatarDisplay = (d.avatar_display ?? null) as string | null;
      let resolvedStatus: "online" | "idle" | "dnd" | "offline" = "online";
      const resolvedPlatform = normalizePresencePlatform(d.platform) ?? "web";

      if (profile) {
        resolvedName = profile.name;
        resolvedUsername = profile.username ?? resolvedUsername;
        resolvedDisplayName = profile.displayName ?? null;
        resolvedAvatar = profile.avatarUrl ?? null;
        resolvedAvatarDisplay = profile.avatarDisplay ?? null;
      }
      if (userRow?.status) {
        resolvedStatus = userRow.status as any;
      }

      meetingLog.info(
        `Identify: name=${resolvedName}, avatar=${resolvedAvatar}, subject=${admittedUserId ?? "anonymous"}`,
      );

      const resolvedIdentity: ProfileIdentity = {
        name: resolvedName,
        username: resolvedUsername,
        display_name: resolvedDisplayName,
        avatar_url: resolvedAvatar ?? null,
        avatar_display: resolvedAvatarDisplay,
      };
      const profileRequestIsCurrent =
        profileRequest !== null &&
        this.profileRequestCoordinator.isCurrent(profileRequest);
      const profileIsCurrent =
        profile !== null &&
        profileRequest !== null &&
        profileRequestIsCurrent &&
        this.profileRequestCoordinator.acceptSuccess(profileRequest);
      const canonicalIdentity = admittedUserId
        ? this.getCanonicalProfileIdentity(admittedUserId)
        : undefined;
      const identity = profileIsCurrent
        ? resolvedIdentity
        : (canonicalIdentity ?? resolvedIdentity);

      if (admittedUserId && profileRequestIsCurrent) {
        await this.updateProfileIdentity(admittedUserId, identity);
        if (this.abandonStaleIdentify(ws, voiceJoin)) return;
      }

      const attachment: WsAttachment = {
        admission,
        id: participantId,
        ...identity,
        platform: resolvedPlatform,
        user_id: admittedUserId,
        stream_preview_url: null,
        self_mute: true,
        self_deaf: false,
        self_stream: false,
        self_stream_audio: false,
        self_video: false,
        spatial_audio_enabled: false,
        spatial_audio_high_fidelity: false,
        suppress: false,
        status: resolvedStatus,
        tracks: [],
        supports_voice_state_deltas: d.supports_voice_state_deltas === true,
        standby: d.standby === true,
        ...(voiceJoinOrder !== undefined
          ? { voice_join_order: voiceJoinOrder, voice_joined_at: voiceJoinedAt }
          : {}),
        last_heartbeat: Date.now(),
        seq: 0,
        outbound_seq: 0,
        subscribed_channels: [],
        subscribed_servers: [],
      };

      this.persist(ws, attachment);

      // This join takes over the user's voice sessions on other devices,
      // unless a newer join of theirs finished first: then this one ends.
      if (this.replaceOtherVoiceSessions(ws, attachment)) return;

      // Build roster (after the takeover, so no replaced session is in it)
      const participants = this.buildRoomRoster(ws);

      // Who is connected now, ahead of Ready and any ChannelSubscribe: the
      // client's DM and friends rows read live presence from this list, not
      // users.status (the status a person last chose, kept after they leave).
      if (attachment.user_id) {
        this.sendTo(ws, {
          op: Op.Dispatch,
          d: {
            event: "PRESENCE_LIST",
            data: this.buildPresenceListPayload(),
          },
        });
      }

      // Op 2: Ready — includes voice_token for Voice Gateway connection
      this.sendTo(ws, {
        op: Op.Ready,
        d: {
          participant_id: participantId,
          ice_servers: iceServers,
          participants,
          heartbeat_interval: HEARTBEAT_INTERVAL_MS,
          voice_token: voiceToken,
          spatial_audio_state: this.spatialAudioStates.get(
            attachment.voice_channel_id || this.roomSlug,
          ),
        },
      });

      this.ctx.waitUntil(this.sendVoiceChannelStates(ws));
      if (attachment.voice_channel_id) {
        this.ctx.waitUntil(
          this.broadcastVoiceChannelState(attachment.voice_channel_id),
        );
      }

      if (!attachment.standby) {
        this.broadcast(
          {
            op: Op.VoiceStateUpdate,
            d: {
              participant: this.buildVoiceState(attachment),
              action: "join",
            },
          },
          ws,
        );
      }

      if (attachment.user_id) {
        if (!attachment.standby) {
          const presenceSnapshot = this.buildPresenceSnapshotForUser(
            attachment.user_id,
          );
          this.broadcast(
            {
              op: Op.Dispatch,
              d: {
                event: "PRESENCE_UPDATE",
                data: presenceSnapshot,
              },
            },
            ws,
          );
        }

        // Resume Pending Ringing upon Identify
        const userId = attachment.user_id;

        const pending = this.findPendingCallForUser(userId);
        if (pending && pending.calleeId === userId) {
          log.info(
            `Found pending call (as callee) for ${userId}: callId=${pending.callId}`,
          );
          this.sendTo(ws, {
            op: Op.Dispatch,
            d: {
              event: "CALL_RING",
              data: {
                call_id: pending.callId,
                caller_id: pending.callerId,
                caller_name: pending.callerName,
                caller_username: pending.callerUsername,
                caller_display_name: pending.callerDisplayName,
                caller_avatar: pending.callerAvatar,
                channel_id: pending.channelId,
                is_reconnect: true,
              },
            },
          });
        }
      }
    } catch (err) {
      meetingLog.error("handleIdentify crashed:", err);
      if (voiceJoin && this.getSession(ws)?.id !== voiceJoin.participantId) {
        this.pushVoiceJoinGrant(
          voiceJoin.participantId,
          voiceJoin.subject,
          false,
        );
      }
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.InvalidPayload,
          message: `Identify failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        },
      });
    } finally {
      if (voiceJoin) this.identifyingVoiceJoins.delete(voiceJoin.participantId);
    }
  }

  /**
   * Identify yields (TURN, profile, D1). If the socket closed meanwhile,
   * webSocketClose found no session to clean up, so persisting one now would
   * leave a ghost on the roster and, through replaceOtherVoiceSessions, end
   * the user's newer session on another socket. If the socket identified or
   * resumed meanwhile, that session stands. Either way this Identify stops,
   * and the voice grant it pushed is withdrawn unless a session holds it.
   */
  private abandonStaleIdentify(
    ws: WebSocket,
    voiceJoin: { participantId: string; subject: string } | null,
  ): boolean {
    const closed = this.isSocketClosed(ws);
    if (!closed && !this.getSession(ws)) return false;
    meetingLog.info(
      closed
        ? "Identify abandoned: socket closed while identifying"
        : "Identify abandoned: socket already has a session",
    );
    if (
      voiceJoin &&
      this.getSessionSocket(voiceJoin.participantId) === undefined
    ) {
      this.pushVoiceJoinGrant(
        voiceJoin.participantId,
        voiceJoin.subject,
        false,
      );
    }
    return true;
  }

  /** Closed, or its close or error was delivered (or handleLeave ran). */
  private isSocketClosed(ws: WebSocket): boolean {
    return ws.readyState !== WebSocket.OPEN || this.closedSockets.has(ws);
  }

  // ── Op 3: Heartbeat ────────────────────────────────────────────────────

  private handleHeartbeat(ws: WebSocket) {
    const session = this.getSession(ws);

    // Always ACK the heartbeat — even for unidentified sessions.
    // When the DO is awake (e.g. woken by a broadcast), heartbeats arrive
    // through webSocketMessage instead of the auto-response path. Dropping
    // them (i.e. returning early) starves the client of ACKs, causing the
    // client-side HeartbeatManager to declare a zombie and disconnect after
    // 3 missed beats (135s). The ACK is cheap; never suppress it.
    if (!session) {
      this.sendTo(ws, { op: Op.HeartbeatACK, d: { seq: 0 } });
      return;
    }

    session.last_heartbeat = Date.now();
    session.seq = (session.seq ?? 0) + 1;
    this.persist(ws, session);

    this.sendTo(ws, {
      op: Op.HeartbeatACK,
      d: { seq: session.seq },
    });
  }

  // ── Op 7: Resume ──────────────────────────────────────────────────────

  private async handleResume(ws: WebSocket, d: MainClientPayload<Op.Resume>) {
    const oldAttachment = this.resumableSessions.get(d.session_id);
    const admission = this.getSessionAdmission(ws);
    const move = this.movedVoiceSessions.get(d.session_id);
    if (
      !oldAttachment &&
      move &&
      this.isReplacedVoiceSession(d.session_id) &&
      admission?.subject === move.userId
    ) {
      // A moderator moved this session while it was reconnecting: say where
      // to, as a live session heard it, so the client switches channels.
      this.sendTo(ws, { op: Op.VoiceMove, d: move.notice });
      try {
        ws.close(CloseCode.SessionReplaced, VOICE_MOVED_CLOSE_REASON);
      } catch {}
      return;
    }
    if (!oldAttachment && this.isReplacedVoiceSession(d.session_id)) {
      // The user joined from another device meanwhile: stop, never rejoin.
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.SessionReplaced,
          message: VOICE_SESSION_REPLACED_REASON,
        },
      });
      try {
        ws.close(CloseCode.SessionReplaced, VOICE_SESSION_REPLACED_REASON);
      } catch {}
      return;
    }
    if (!oldAttachment) {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.SessionInvalid,
          message: "Session not found for resume",
        },
      });
      return;
    }

    if (!admission || oldAttachment.admission?.subject !== admission.subject) {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.AdmissionRejected,
          message: "Resume subject mismatch",
        },
      });
      try {
        ws.close(CloseCode.AdmissionRejected, "Resume subject mismatch");
      } catch {}
      return;
    }

    const buffer = this.replayBuffers.get(d.session_id) ?? [];
    const currentSeq = oldAttachment.outbound_seq ?? 0;
    const firstRetainedSeq = buffer[0]?.seq;
    const cursorIsValid =
      typeof oldAttachment.outbound_seq === "number" &&
      Number.isInteger(d.seq_ack) &&
      d.seq_ack >= 0 &&
      d.seq_ack <= currentSeq &&
      (d.seq_ack === currentSeq ||
        (firstRetainedSeq !== undefined && firstRetainedSeq <= d.seq_ack + 1));
    if (!cursorIsValid) {
      this.revokeVoiceJoin(oldAttachment);
      this.resumableSessions.delete(d.session_id);
      this.replayBuffers.delete(d.session_id);
      this.persistResumableSessions();
      this.resumableSessionExpiry.delete(d.session_id);
      this.persistResumableSessionExpiry();
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.SessionInvalid,
          message: "Gateway continuity lost; reconcile from REST",
        },
      });
      return;
    }

    const disconnectedAt = this.resumableSessionExpiry.get(d.session_id);
    if (
      typeof disconnectedAt !== "number" ||
      !isReconnectWithinGrace(
        disconnectedAt,
        Date.now(),
        RESUME_GRACE_PERIOD_MS,
      )
    ) {
      this.revokeVoiceJoin(oldAttachment);
      this.resumableSessions.delete(d.session_id);
      this.replayBuffers.delete(d.session_id);
      this.persistResumableSessions();
      this.resumableSessionExpiry.delete(d.session_id);
      this.persistResumableSessionExpiry();
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.SessionInvalid,
          message: "Session expired for resume",
        },
      });
      return;
    }

    // Consume the resumable generation before any await. A second socket must
    // never be able to replay or take over the same disconnected session.
    this.resumableSessions.delete(d.session_id);
    this.resumableSessionExpiry.delete(d.session_id);
    this.replayPersistWrites.delete(d.session_id);
    this.persistResumableSessions();
    this.persistResumableSessionExpiry();

    const resumedAttachment: WsAttachment = {
      ...oldAttachment,
      admission,
      last_heartbeat: Date.now(),
    };
    this.resumingSockets.add(ws);
    this.pendingResumeMessages.set(ws, []);
    try {
      this.persist(ws, resumedAttachment);
      // Re-assert the grant in case the voice room lost or pruned it.
      if (!resumedAttachment.standby) {
        this.pushVoiceJoinGrant(
          resumedAttachment.id,
          resumedAttachment.admission?.subject,
          true,
        );
      }

      await this.restoreSessionSubscriptions(ws, resumedAttachment);
      if (this.isSocketClosed(ws)) {
        // Closed while its subscriptions were checked: webSocketClose held
        // the session for resume again, and nothing here may re-add it.
        meetingLog.info("Resume abandoned: socket closed while resuming");
        return;
      }

      // A room's roster now shows the session connected again (flush); the
      // global gateway's voice members come from the rooms, not from here.

      // Replay retained messages after subscription restoration. Events arriving
      // during restoration are queued and become part of this same ordered batch.
      const replayedSeqs = new Set<number>();
      const missed: ReplayEntry[] = [];
      for (const entry of this.replayBuffers.get(d.session_id) ?? buffer) {
        if (
          entry.seq > d.seq_ack &&
          (await this.canReplayEntry(resumedAttachment, entry))
        ) {
          missed.push(entry);
        }
      }
      log.info(
        `Resumed session: ${d.session_id}, replaying ${missed.length} messages (seq_ack=${d.seq_ack})`,
      );

      for (const entry of missed) {
        this.sendTo(ws, entry.msg);
        replayedSeqs.add(entry.seq);
      }

      // Generate a fresh voice token so that the client can re-authenticate
      // on the Voice Gateway. Without this, the client reuses the stale token
      // from the initial Identify, which will eventually expire (1h TTL).
      const [freshVoiceToken, freshIceServers] = await Promise.all([
        this.generateVoiceToken(
          resumedAttachment.id,
          resumedAttachment.admission?.subject,
        ),
        this.generateTurnCredentials(),
      ]);

      if (this.resumeOverflowedSockets.has(ws)) {
        throw new Error("Resume continuity buffer exceeded");
      }
      for (const entry of this.pendingResumeMessages.get(ws) ?? []) {
        if (
          !replayedSeqs.has(entry.seq) &&
          (await this.canReplayEntry(resumedAttachment, entry))
        ) {
          this.sendTo(ws, entry.msg);
        }
      }

      const participants = this.buildRoomRoster();

      this.sendTo(ws, {
        op: Op.Resumed,
        d: {
          voice_token: freshVoiceToken,
          ice_servers: freshIceServers,
          participants,
          spatial_audio_state: this.spatialAudioStates.get(
            resumedAttachment.voice_channel_id || this.roomSlug,
          ),
        },
      });

      // Re-announce the resumed participant in full. Its abrupt close sent no
      // leave, but a client that took a roster in the meantime (its own
      // Ready or Resumed) may have dropped it; an update with the full state
      // brings it back (with its screen share tile) without a rejoin.
      if (!resumedAttachment.standby) {
        this.broadcast(
          {
            op: Op.VoiceStateUpdate,
            d: {
              participant: this.buildVoiceState(resumedAttachment),
              action: "update",
            },
          },
          ws,
        );
      }

      // Send current voice channel states so the client can reconcile their
      // sidebar. During the disconnect window, the client may have missed
      // VOICE_CHANNEL_STATE_UPDATE events — this full sync corrects that.
      await this.sendVoiceChannelStates(ws);
    } catch (error) {
      meetingLog.error("Resume failed; continuity is invalid:", error);
      try {
        await this.handleLeave(ws, true, false);
      } catch (cleanupError) {
        meetingLog.error(
          "Failed to clean up an invalid resumed session",
          cleanupError,
        );
        this.cleanupChannelSubscriptions(ws);
        this.cleanupServerSubscriptions(ws);
        this.sessions.delete(ws);
      }
      this.replayBuffers.delete(d.session_id);
      this.replayPersistWrites.delete(d.session_id);
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.SessionInvalid,
          message: "Gateway continuity lost; reconcile from REST",
        },
      });
      try {
        ws.close(CloseCode.SessionInvalid, "Resume failed");
      } catch {}
    } finally {
      this.resumingSockets.delete(ws);
      this.pendingResumeMessages.delete(ws);
      this.resumeOverflowedSockets.delete(ws);
    }
  }

  private async handleRefreshVoiceCredentials(ws: WebSocket) {
    const session = this.requireSession(ws);
    if (!session) return;

    const [freshVoiceToken, freshIceServers] = await Promise.all([
      this.generateVoiceToken(session.id, session.admission?.subject),
      this.generateTurnCredentials(),
    ]);

    // Clients take this Resumed's roster as the participant list, like any.
    const participants = this.buildRoomRoster();

    this.sendTo(ws, {
      op: Op.Resumed,
      d: {
        voice_token: freshVoiceToken,
        ice_servers: freshIceServers,
        participants,
      },
    });
  }

  // ── Op 15: VoiceStateUpdate (C→S) — mute/camera state changes ──────

  private handleVoiceStateUpdate(
    ws: WebSocket,
    d: MainClientPayload<Op.VoiceStateUpdate>,
  ) {
    const session = this.requireSession(ws);
    if (!session) return;

    if (d.promote_standby === true) {
      if (session.standby) {
        session.standby = false;
        if (d.self_mute !== undefined) session.self_mute = d.self_mute;
        if (d.self_deaf !== undefined) session.self_deaf = d.self_deaf;
        // A promotion is a join now: the newest one for this user.
        session.voice_joined_at = Date.now();
        session.voice_join_order = this.nextVoiceJoinOrder();
        this.persist(ws, session);
        this.pushVoiceJoinGrant(session.id, session.admission?.subject, true);
        this.replaceOtherVoiceSessions(ws, session);
        this.broadcast(
          {
            op: Op.VoiceStateUpdate,
            d: {
              participant: this.buildVoiceState(session),
              action: "join",
            },
          },
          ws,
        );
        if (session.user_id) {
          this.broadcast(
            {
              op: Op.Dispatch,
              d: {
                event: "PRESENCE_UPDATE",
                data: this.buildPresenceSnapshotForUser(session.user_id),
              },
            },
            ws,
          );
        }
      }
      return;
    }

    const isPublicDemo = session.admission?.accessMode === "public-demo";
    if (
      isPublicDemo &&
      (d.stream_preview_url !== undefined ||
        d.spatial_audio_enabled !== undefined ||
        d.spatial_audio_high_fidelity !== undefined ||
        d.spatial_audio_state !== undefined)
    ) {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.NotAuthenticated,
          message: "Voice state field is unavailable in public demo rooms",
        },
      });
      return;
    }

    if (
      d.stream_preview_url !== undefined &&
      d.stream_preview_url !== null &&
      new TextEncoder().encode(d.stream_preview_url).byteLength >
        MAX_STREAM_PREVIEW_URL_BYTES
    ) {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.InvalidPayload,
          message: "Stream preview URL is too long",
        },
      });
      return;
    }
    if (d.self_mute !== undefined) session.self_mute = d.self_mute;
    if (d.self_deaf !== undefined) session.self_deaf = d.self_deaf;
    if (d.self_video !== undefined) session.self_video = d.self_video;
    if (d.self_stream !== undefined) session.self_stream = d.self_stream;
    if (d.self_stream_audio !== undefined)
      session.self_stream_audio = d.self_stream_audio;
    if (d.stream_preview_url !== undefined)
      session.stream_preview_url = d.stream_preview_url;
    if (d.spatial_audio_enabled !== undefined)
      session.spatial_audio_enabled = d.spatial_audio_enabled;
    if (d.spatial_audio_high_fidelity !== undefined)
      session.spatial_audio_high_fidelity = d.spatial_audio_high_fidelity;
    // Global socket: mute, deafen, camera and share here no longer reach the
    // sidebar (the room's op 15 does, through its roster). The preview and
    // spatial fields still do, as hints on the member the room reported.
    const hintChannel =
      this.roomSlug === VOICE_ROSTER_GATEWAY
        ? this.resolveVoiceHintChannel(session)
        : null;
    const spatialRoomKey =
      hintChannel ?? (session.voice_channel_id || this.roomSlug);
    let sidebarChanged = false;
    if (isSpatialAudioState(d.spatial_audio_state)) {
      sidebarChanged = hintChannel !== null;
      const nextSpatialAudioState = {
        ...d.spatial_audio_state,
        updatedBy: session.user_id || session.id,
        updatedAt: Date.now(),
      };
      this.spatialAudioStates.set(spatialRoomKey, nextSpatialAudioState);
      this.persistSpatialAudioState(spatialRoomKey, nextSpatialAudioState);
    }
    if (hintChannel && session.user_id) {
      const hint: VoiceMemberHint = {};
      if (d.stream_preview_url !== undefined)
        hint.stream_preview_url = d.stream_preview_url;
      if (d.spatial_audio_enabled !== undefined)
        hint.spatial_audio_enabled = d.spatial_audio_enabled;
      if (d.spatial_audio_high_fidelity !== undefined)
        hint.spatial_audio_high_fidelity = d.spatial_audio_high_fidelity;
      if (
        Object.keys(hint).length > 0 &&
        this.setVoiceMemberHint(hintChannel, session.user_id, hint)
      ) {
        sidebarChanged = true;
      }
    }
    this.persist(ws, session);

    this.broadcastVoiceStateUpdate(
      ws,
      session,
      this.spatialAudioStates.get(spatialRoomKey),
    );

    if (hintChannel && sidebarChanged) {
      this.ctx.waitUntil(this.broadcastVoiceChannelState(hintChannel));
    }
  }

  // ── Op 26: PresenceUpdate (C→S) ──────────────────────────────────────────

  private handlePresenceUpdate(
    ws: WebSocket,
    d: MainClientPayload<Op.PresenceUpdate>,
  ) {
    const session = this.requireSession(ws);
    if (!session) return;

    const status = d.status;
    if (!isPresenceStatus(status)) return;

    if (session.user_id) {
      let presenceChanged = false;
      for (const [sessionWs, otherSession] of this.sessions) {
        if (otherSession.user_id !== session.user_id) continue;
        if (otherSession.status !== status) presenceChanged = true;
        otherSession.status = status;
        this.persist(sessionWs, otherSession);
      }

      // 1. Debounced persist to D1 (coalesces rapid toggles into one write)
      this.ctx.waitUntil(this.persistPresence(session.user_id, status));

      if (!presenceChanged) return;

      // 3. Broadcast to all
      const presenceSnapshot = this.buildPresenceSnapshotForUser(
        session.user_id,
      );
      this.broadcast({
        op: Op.Dispatch,
        d: {
          event: "PRESENCE_UPDATE",
          data: presenceSnapshot,
        },
      });
      return;
    }

    session.status = status;
    this.persist(ws, session);
  }

  /** Persist presence immediately without blocking the WebSocket response. */
  private async persistPresence(userId: string, status: string) {
    try {
      const { results } = await this.env.DB.prepare(
        "SELECT server_id FROM server_members WHERE user_id = ?",
      )
        .bind(userId)
        .all();

      const presenceUpdate = await this.env.DB.prepare(
        "UPDATE users SET status = ?, updated_at = ? WHERE id = ? AND status IS NOT ?",
      )
        .bind(status, new Date().toISOString(), userId, status)
        .run();

      if (presenceUpdate.meta.changes === 0) return;

      const serverIds = (results ?? [])
        .map((row) => row.server_id)
        .filter((serverId): serverId is string => typeof serverId === "string");
      scheduleServerMemberCacheInvalidation(this.env, serverIds, (promise) =>
        this.ctx.waitUntil(promise),
      );
    } catch (e) {
      presenceLog.error("D1 update failed:", e);
    }
  }

  // ── Op 17: ProfileRefresh ──────────────────────────────────────────────

  private async handleProfileRefresh(ws: WebSocket) {
    const session = this.requireSession(ws);
    if (!session?.user_id) return;

    const now = Date.now();
    const lastRefresh = this.profileRefreshCooldowns.get(session.id) ?? 0;
    if (now - lastRefresh < PROFILE_REFRESH_COOLDOWN_MS) return;
    this.profileRefreshCooldowns.set(session.id, now);

    const profileRequest = this.profileRequestCoordinator.begin(
      session.user_id,
    );
    const verified = await this.fetchProfile(session.user_id);
    if (!verified || this.getSession(ws) !== session) return;
    if (!this.profileRequestCoordinator.acceptSuccess(profileRequest)) return;

    const identity: ProfileIdentity = {
      name: verified.name,
      username: verified.username,
      display_name: verified.displayName ?? null,
      avatar_url: verified.avatarUrl ?? null,
      avatar_display: verified.avatarDisplay ?? null,
    };
    await this.updateProfileIdentity(session.user_id, identity);
  }

  // ── Leave / Disconnect ─────────────────────────────────────────────────

  private async handleLeave(
    ws: WebSocket,
    intentional: boolean = false,
    closeSocket: boolean = true,
    replaced: boolean = false,
    /** Ended by a moderator's move (implies replaced). */
    moved: boolean = false,
  ) {
    const session = this.getSession(ws);
    if (!session) return;
    // The socket is done: no later persist may bring the session back.
    this.closedSockets.add(ws);

    // Broadcast updated presence/platform state before cleanup
    if (session.user_id && !session.standby) {
      let nextSnapshot: {
        user_id: string;
        status: "online" | "idle" | "dnd" | "offline";
        platforms: PresencePlatform[];
      } | null = null;

      for (const [otherWs, otherSession] of this.sessions) {
        if (otherWs === ws || otherSession.user_id !== session.user_id)
          continue;
        nextSnapshot = this.buildPresenceSnapshotForUser(session.user_id, {
          excludeWs: ws,
        });
        break;
      }

      this.broadcast(
        {
          op: Op.Dispatch,
          d: {
            event: "PRESENCE_UPDATE",
            data: nextSnapshot ?? {
              user_id: session.user_id,
              status: "offline",
              platforms: [],
            },
          },
        },
        ws,
      );
    }

    // In a room, the roster (flushed at the end of this cycle) shows an
    // abrupt close as reconnecting while the session is held for resume,
    // and drops an intentional leave at once. A global session's close
    // does not touch voice members: they come from the rooms.
    const now = Date.now();
    if (intentional) delete session.voice_channel_id;

    // Clean up calls — cancel pending or end active
    if (session.user_id && !session.standby) {
      this.cleanupCallsForUser(session.user_id, "disconnected", ws);
    }

    // Clean up channel and server subscriptions
    this.cleanupChannelSubscriptions(ws);
    this.cleanupServerSubscriptions(ws);

    const participantId = session.id;
    this.sessions.delete(ws);
    this.profileRefreshCooldowns.delete(participantId);

    if (shouldKeepResumableSession(intentional)) {
      // Keep resumable session alive for RESUME_GRACE_PERIOD_MS so the client
      // can reconnect and resume without a full re-identify. Mark expiry.
      this.resumableSessionExpiry.set(participantId, now);
      const resumableAttachment = { ...session };
      this.resumableSessions.set(participantId, resumableAttachment);
      this.replayPersistWrites.set(participantId, 0);
      this.persistResumableSessions();
      this.persistResumableSessionExpiry();
      // Ensure the alarm keeps running to prune expired resumable sessions
      this.ctx.waitUntil(this.scheduleAlarm());
    } else {
      this.revokeVoiceJoin(session, replaced, moved);
      this.resumableSessions.delete(participantId);
      this.replayBuffers.delete(participantId);
      this.replayPersistWrites.delete(participantId);
      this.persistResumableSessions();
      this.resumableSessionExpiry.delete(participantId);
      this.persistResumableSessionExpiry();
    }

    // Only broadcast VoiceStateUpdate "leave" on INTENTIONAL disconnects.
    // On abrupt WS closes the user is expected to reconnect within the grace
    // period. Broadcasting "leave" prematurely causes other clients to remove
    // the participant from their local state, but the voice channel membership
    // is deferred — leading to a desync between the VC view (shows user left)
    // and the sidebar (still shows user present). The alarm broadcasts the
    // leave when the resume grace runs out.
    if (intentional && !session.standby) {
      this.broadcast(
        {
          op: Op.VoiceStateUpdate,
          d: {
            participant: this.buildVoiceState(session),
            action: "leave",
          },
        },
        ws,
      );
    }

    if (closeSocket) {
      try {
        ws.close(1000, "Left room");
      } catch {
        /* already closed */
      }
    }
  }

  // ── Stored profile lookup ──────────────────────────────────────────────

  private async fetchProfile(userId: string): Promise<{
    name: string;
    username?: string;
    displayName?: string | null;
    avatarUrl?: string;
    avatarDisplay?: string | null;
  } | null> {
    try {
      return await resolveMeetingProfile({
        db: this.env.DB,
        log: meetingLog,
        userId,
      });
    } catch (err) {
      meetingLog.error("Failed to fetch profile:", err);
      return null;
    }
  }

  // ── TURN credentials ──────────────────────────────────────────────────

  private async generateTurnCredentials() {
    return resolveTurnCredentials({
      tokenId: this.env.TURN_TOKEN_ID,
      tokenSecret: this.env.TURN_TOKEN_SECRET,
      fetch,
      log: meetingLog,
    });
  }

  // ── Utilities ─────────────────────────────────────────────────────────

  private sendTo(ws: WebSocket, msg: ServerMsg) {
    sendFrame(ws, msg);
  }

  private trimReplayBuffer(buffer: ReplayEntry[]): ReplayEntry[] {
    const next = buffer.slice(-MeetingRoom.MAX_REPLAY_BUFFER);
    let bytes = next.reduce(
      (total, entry) =>
        total + new TextEncoder().encode(JSON.stringify(entry)).byteLength,
      0,
    );
    while (next.length > 0 && bytes > MAX_REPLAY_BUFFER_BYTES) {
      const removed = next.shift();
      if (removed) {
        bytes -= new TextEncoder().encode(JSON.stringify(removed)).byteLength;
      }
    }
    return next;
  }

  private makeReplayEntry(
    session: WsAttachment,
    msg: ServerMsg,
    scope?: ReplayEntry["scope"],
  ): ReplayEntry {
    const seq = (session.outbound_seq ?? 0) + 1;
    session.outbound_seq = seq;
    const data = this.isPlainObject(msg.d) ? msg.d : {};
    const channelId = this.getDispatchChannelId(msg);
    const replayScope =
      scope ??
      (channelId ? { kind: "channel", channelId } : { kind: "global" });
    return { seq, msg: { ...msg, d: { ...data, seq } }, scope: replayScope };
  }

  private appendReplayEntry(session: WsAttachment, entry: ReplayEntry) {
    const buffer = this.trimReplayBuffer([
      ...(this.replayBuffers.get(session.id) ?? []),
      entry,
    ]);
    this.replayBuffers.set(session.id, buffer);
    return buffer;
  }

  private sendReplayable(
    ws: WebSocket,
    session: WsAttachment,
    msg: ServerMsg,
    scope?: ReplayEntry["scope"],
  ) {
    const entry = this.makeReplayEntry(session, msg, scope);
    this.appendReplayEntry(session, entry);
    this.persist(ws, session);
    if (this.resumingSockets.has(ws)) {
      const pending = this.pendingResumeMessages.get(ws) ?? [];
      pending.push(entry);
      if (pending.length > MeetingRoom.MAX_REPLAY_BUFFER) {
        this.resumeOverflowedSockets.add(ws);
      }
      this.pendingResumeMessages.set(ws, pending);
      return;
    }
    this.sendTo(ws, entry.msg);
  }

  private queueResumable(
    session: WsAttachment,
    msg: ServerMsg,
    scope?: ReplayEntry["scope"],
  ) {
    const writes = (this.replayPersistWrites.get(session.id) ?? 0) + 1;
    if (writes > MAX_REPLAY_PERSIST_WRITES) {
      // A long offline burst is cheaper and safer to reconcile from REST than
      // to keep rewriting a large snapshot on every event.
      this.resumableSessions.delete(session.id);
      this.replayBuffers.delete(session.id);
      this.replayPersistWrites.delete(session.id);
      this.persistResumableSessions();
      return;
    }

    this.replayPersistWrites.set(session.id, writes);
    const entry = this.makeReplayEntry(session, msg, scope);
    this.appendReplayEntry(session, entry);
    this.persistResumableSessions();
  }

  private broadcast(msg: ServerMsg, excludeWs?: WebSocket) {
    const liveSessionIds = new Set(
      [...this.sessions.values()].map((session) => session.id),
    );
    for (const [ws, session] of this.sessions) {
      if (ws === excludeWs) continue;
      this.sendReplayable(ws, session, msg);
    }
    for (const [sessionId, session] of this.resumableSessions) {
      if (!liveSessionIds.has(sessionId)) this.queueResumable(session, msg);
    }
  }

  /** Send a message to all clients subscribed to a specific channel */
  private async broadcastToChannel(
    channelId: string,
    msg: ServerMsg,
    excludeWs?: WebSocket,
  ) {
    const candidates: Array<{
      ws?: WebSocket;
      session: WsAttachment;
      userId: string;
    }> = [];
    const liveSockets = new Set(this.channelSubscriptions.get(channelId) ?? []);

    for (const [ws, session] of this.sessions) {
      if (ws === excludeWs || !liveSockets.has(ws)) continue;
      if (session.user_id) {
        candidates.push({ ws, session, userId: session.user_id });
      }
    }
    for (const [ws, session] of this.sessions) {
      if (ws === excludeWs || !this.resumingSockets.has(ws)) continue;
      if (
        session.subscribed_channels.includes(channelId) &&
        session.user_id &&
        !candidates.some((candidate) => candidate.ws === ws)
      ) {
        candidates.push({ ws, session, userId: session.user_id });
      }
    }
    const liveSessionIds = new Set(
      candidates.map((candidate) => candidate.session.id),
    );
    for (const [sessionId, session] of this.resumableSessions) {
      if (
        liveSessionIds.has(sessionId) ||
        !session.subscribed_channels.includes(channelId) ||
        !session.user_id
      )
        continue;
      candidates.push({ session, userId: session.user_id });
    }

    if (candidates.length === 0) return;

    const uniqueUserIds = [
      ...new Set(candidates.map((candidate) => candidate.userId)),
    ];
    const decisions = await resolveChannelAccessForUsers(
      this.env.DB,
      channelId,
      uniqueUserIds,
    );

    let resumableChanged = false;
    for (const { ws, session, userId } of candidates) {
      const access = decisions.get(userId);
      if (!access || access.kind !== "allowed") {
        const subscribers = this.channelSubscriptions.get(channelId);
        if (ws) subscribers?.delete(ws);
        session.subscribed_channels = session.subscribed_channels.filter(
          (id) => id !== channelId,
        );
        if (ws) this.persist(ws, session);
        else resumableChanged = true;
        continue;
      }
      const scope: ReplayEntry["scope"] = { kind: "channel", channelId };
      if (ws) this.sendReplayable(ws, session, msg, scope);
      else this.queueResumable(session, msg, scope);
    }
    if (resumableChanged) this.persistResumableSessions();
  }

  /** Send a message to all sessions that are members of a server */
  private async broadcastToServerMembers(
    serverId: string,
    msg: ServerMsg,
    excludeWs?: WebSocket,
  ) {
    const channelId = this.getDispatchChannelId(msg);
    const subscribers = this.serverSubscriptions.get(serverId);

    // Gather candidate sessions first, pruning any socket without an
    // authenticated user. Then resolve membership for all of them in a single
    // batched query rather than one query per subscriber (previously O(n) DB
    // round-trips per broadcast).
    const candidates: Array<{ ws?: WebSocket; session: WsAttachment }> = [];
    const liveSockets = new Set(subscribers ?? []);
    for (const [ws, session] of this.sessions) {
      if (!liveSockets.has(ws) || ws === excludeWs) continue;
      if (!session.user_id) {
        subscribers?.delete(ws);
        continue;
      }
      candidates.push({ ws, session });
    }

    for (const [ws, session] of this.sessions) {
      if (
        ws === excludeWs ||
        !this.resumingSockets.has(ws) ||
        (!session.subscribed_servers.includes(serverId) &&
          (!channelId || !session.subscribed_channels.includes(channelId))) ||
        !session.user_id ||
        candidates.some((candidate) => candidate.ws === ws)
      )
        continue;
      candidates.push({ ws, session });
    }

    if (channelId) {
      for (const ws of this.channelSubscriptions.get(channelId) ?? []) {
        if (
          ws === excludeWs ||
          candidates.some((candidate) => candidate.ws === ws)
        )
          continue;
        const session = this.getSession(ws);
        if (session?.user_id) candidates.push({ ws, session });
      }
    }

    const liveSessionIds = new Set(
      candidates.map((candidate) => candidate.session.id),
    );
    for (const [sessionId, session] of this.resumableSessions) {
      if (
        liveSessionIds.has(sessionId) ||
        (!session.subscribed_servers.includes(serverId) &&
          (!channelId || !session.subscribed_channels.includes(channelId))) ||
        !session.user_id
      )
        continue;
      candidates.push({ session });
    }

    if (candidates.length === 0) {
      if (subscribers && subscribers.size === 0)
        this.serverSubscriptions.delete(serverId);
      return;
    }

    const uniqueUserIds = [
      ...new Set(candidates.map((c) => c.session.user_id as string)),
    ];
    const members = await this.resolveServerMembership(serverId, uniqueUserIds);

    const channelDecisions = channelId
      ? await resolveChannelAccessForUsers(
          this.env.DB,
          channelId,
          uniqueUserIds,
        )
      : null;
    let resumableChanged = false;
    for (const { ws, session } of candidates) {
      if (!members.has(session.user_id as string)) {
        if (ws) subscribers?.delete(ws);
        session.subscribed_servers = session.subscribed_servers.filter(
          (id) => id !== serverId,
        );
        if (ws) this.persist(ws, session);
        else resumableChanged = true;
        continue;
      }
      if (
        channelDecisions &&
        (!channelDecisions.get(session.user_id as string) ||
          channelDecisions.get(session.user_id as string)?.kind !== "allowed")
      ) {
        continue;
      }
      const scope: ReplayEntry["scope"] = channelId
        ? { kind: "channel", channelId }
        : { kind: "server", serverId };
      if (ws) this.sendReplayable(ws, session, msg, scope);
      else this.queueResumable(session, msg, scope);
    }
    if (subscribers && subscribers.size === 0)
      this.serverSubscriptions.delete(serverId);
    if (resumableChanged) this.persistResumableSessions();
  }

  /**
   * Resolve which of `userIds` are members of `serverId` in a single batched
   * query (chunked to stay within D1's 100 bound-parameter limit). Returns the
   * set of member user IDs. On query failure the affected chunk is treated as
   * non-members, matching the previous per-user fail-safe behaviour.
   */
  private async resolveServerMembership(
    serverId: string,
    userIds: string[],
  ): Promise<Set<string>> {
    const members = new Set<string>();
    // 1 param for serverId leaves 99 for user IDs; chunk conservatively at 90.
    const CHUNK = 90;
    for (let i = 0; i < userIds.length; i += CHUNK) {
      const chunk = userIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => "?").join(", ");
      const { results } = await this.env.DB.prepare(
        `SELECT user_id FROM server_members WHERE server_id = ? AND user_id IN (${placeholders})`,
      )
        .bind(serverId, ...chunk)
        .all<{ user_id: string }>()
        .catch(() => ({ results: [] as { user_id: string }[] }));
      for (const row of results ?? []) {
        if (typeof row.user_id === "string") members.add(row.user_id);
      }
    }
    return members;
  }

  private async broadcastToUserServers(userId: string, msg: ServerMsg) {
    const { results } = await this.env.DB.prepare(
      "SELECT server_id FROM server_members WHERE user_id = ?",
    )
      .bind(userId)
      .all()
      .catch(() => ({ results: [] }));

    for (const row of results ?? []) {
      if (typeof row.server_id !== "string") continue;
      await this.broadcastToServerMembers(row.server_id, msg);
    }
  }

  private getDispatchChannelId(msg: ServerMsg): string | null {
    if (!this.isPlainObject(msg.d)) return null;
    const data = msg.d.data;
    if (!this.isPlainObject(data) || typeof data.channel_id !== "string")
      return null;
    return data.channel_id;
  }

  private async canReplayEntry(
    session: WsAttachment,
    entry: ReplayEntry,
  ): Promise<boolean> {
    if (!entry.scope) return false;
    if (!session.user_id || entry.scope.kind === "global") return true;

    try {
      if (entry.scope.kind === "channel") {
        const access = await resolveChannelAccess(
          this.env.DB,
          session.user_id,
          entry.scope.channelId,
        );
        return Boolean(
          access && hasChannelPermission(access, PERMISSIONS.VIEW_CHANNELS),
        );
      }

      const membership = await this.env.DB.prepare(
        "SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
      )
        .bind(entry.scope.serverId, session.user_id)
        .first();
      return membership !== null;
    } catch {
      return false;
    }
  }

  /** Send a message to all sessions of a specific user */
  private broadcastToUser(userId: string, msg: ServerMsg) {
    let count = 0;
    const liveSessionIds = new Set<string>();
    for (const [ws, session] of this.sessions) {
      if (session.user_id === userId) {
        liveSessionIds.add(session.id);
        this.sendReplayable(ws, session, msg);
        count++;
      }
    }
    for (const [sessionId, session] of this.resumableSessions) {
      if (liveSessionIds.has(sessionId) || session.user_id !== userId) continue;
      this.queueResumable(session, msg);
    }
    log.info(`broadcastToUser ${userId}: sent to ${count} sessions`);
  }

  // ── Op 27: ChannelSubscribe ───────────────────────────────────────────

  private async handleChannelSubscribe(
    ws: WebSocket,
    d: MainClientPayload<Op.ChannelSubscribe>,
  ) {
    const session = this.requireSession(ws);
    if (!session || !d.channel_id || !session.user_id) return;

    const access = await resolveChannelAccess(
      this.env.DB,
      session.user_id,
      d.channel_id,
    );
    if (!access || !hasChannelPermission(access, PERMISSIONS.VIEW_CHANNELS)) {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.NotAuthenticated,
          message: "Channel not found or access denied",
        },
      });
      return;
    }

    // Add to channel subscription map
    let subs = this.channelSubscriptions.get(d.channel_id);
    if (!subs) {
      subs = new Set();
      this.channelSubscriptions.set(d.channel_id, subs);
    }
    subs.add(ws);

    // Track on the session
    if (!session.subscribed_channels.includes(d.channel_id)) {
      session.subscribed_channels.push(d.channel_id);
      this.persist(ws, session);
    }

    // Send PRESENCE_LIST to the subscribing client with live platform/session metadata.
    this.sendTo(ws, {
      op: Op.Dispatch,
      d: {
        event: "PRESENCE_LIST",
        data: this.buildPresenceListPayload(),
      },
    });

    // Send current voice channel states to the subscribing client
    this.ctx.waitUntil(this.sendVoiceChannelStates(ws));

    log.info(`${session.name} subscribed to channel ${d.channel_id}`);
  }

  // ── Op 28: ChannelUnsubscribe ─────────────────────────────────────────

  private handleChannelUnsubscribe(
    ws: WebSocket,
    d: MainClientPayload<Op.ChannelUnsubscribe>,
  ) {
    const session = this.requireSession(ws);
    if (!session || !d.channel_id) return;

    const subs = this.channelSubscriptions.get(d.channel_id);
    if (subs) {
      subs.delete(ws);
      if (subs.size === 0) this.channelSubscriptions.delete(d.channel_id);
    }

    session.subscribed_channels = session.subscribed_channels.filter(
      (id) => id !== d.channel_id,
    );
    this.persist(ws, session);
  }

  /**
   * Re-checks a resuming session's subscriptions against D1, then applies
   * the ones still allowed in one synchronous step. Nothing is touched if
   * the socket closed during the checks (its close already held the
   * session), so a late apply cannot re-add a dead socket.
   */
  private async restoreSessionSubscriptions(
    ws: WebSocket,
    session: WsAttachment,
  ) {
    const validChannels: string[] = [];
    const validServers: string[] = [];
    if (session.user_id) {
      for (const channelId of session.subscribed_channels ?? []) {
        const access = await resolveChannelAccess(
          this.env.DB,
          session.user_id,
          channelId,
        );
        if (!access || !hasChannelPermission(access, PERMISSIONS.VIEW_CHANNELS))
          continue;
        validChannels.push(channelId);
      }
      for (const serverId of session.subscribed_servers ?? []) {
        const member = await this.env.DB.prepare(
          "SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
        )
          .bind(serverId, session.user_id)
          .first()
          .catch(() => null);
        if (!member) continue;
        validServers.push(serverId);
      }
    }
    if (this.isSocketClosed(ws)) return;

    this.cleanupChannelSubscriptions(ws);
    this.cleanupServerSubscriptions(ws);
    for (const channelId of validChannels) {
      let subscribers = this.channelSubscriptions.get(channelId);
      if (!subscribers) {
        subscribers = new Set();
        this.channelSubscriptions.set(channelId, subscribers);
      }
      subscribers.add(ws);
    }
    for (const serverId of validServers) {
      let subscribers = this.serverSubscriptions.get(serverId);
      if (!subscribers) {
        subscribers = new Set();
        this.serverSubscriptions.set(serverId, subscribers);
      }
      subscribers.add(ws);
    }
    session.subscribed_channels = validChannels;
    session.subscribed_servers = validServers;
    this.persist(ws, session);
  }

  // ── Op 33 / 34: VoiceChannelJoin / VoiceChannelLeave (legacy hints) ───
  // Voice membership is the room's roster (realtime/VOICE_ROSTER.md). The
  // released mobile app, older desktop builds and older web builds still
  // send op 33 on join and every 30 s, and op 34 on leave. Neither adds or
  // removes a member any more, so a client cannot leave a ghost entry. Op 33
  // only records which channel the session's op 15 hints are about, and
  // either may make the gateway pull a roster it has not heard of lately.

  private handleVoiceChannelJoin(
    ws: WebSocket,
    d: MainClientPayload<Op.VoiceChannelJoin>,
  ) {
    const session = this.requireSession(ws);
    if (!session || !d.channel_id || !session.user_id) return;
    if (this.roomSlug !== VOICE_ROSTER_GATEWAY) return;
    if (session.voice_channel_id !== d.channel_id) {
      session.voice_channel_id = d.channel_id;
      this.persist(ws, session);
    }
    this.hintVoiceRoster(d.channel_id);
  }

  private handleVoiceChannelLeave(
    ws: WebSocket,
    d: MainClientPayload<Op.VoiceChannelLeave>,
  ) {
    const session = this.requireSession(ws);
    if (!session || this.roomSlug !== VOICE_ROSTER_GATEWAY) return;
    const channelId = d?.channel_id ?? session.voice_channel_id;
    if (!channelId || session.voice_channel_id === channelId) {
      session.voice_channel_id = undefined;
      this.persist(ws, session);
    }
    if (channelId) this.hintVoiceRoster(channelId);
  }

  private async handleMessageCreate(
    ws: WebSocket,
    d: MainClientPayload<Op.MessageCreate>,
  ) {
    const session = this.requireSession(ws);
    if (
      !session?.user_id ||
      !d.channel_id ||
      !d.content.trim() ||
      d.content.length > 4000 ||
      (d.nonce !== undefined && d.nonce.length > 100)
    ) {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.InvalidPayload,
          message: "Invalid message payload",
        },
      });
      return;
    }

    if (this.roomSlug !== "global-gateway") {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.InvalidPayload,
          message: "This gateway cannot create persisted channel messages",
        },
      });
      return;
    }

    const access = await resolveChannelAccess(
      this.env.DB,
      session.user_id,
      d.channel_id,
    );
    if (!access || !hasChannelPermission(access, PERMISSIONS.SEND_MESSAGES)) {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.NotAuthenticated,
          message: "Channel not found or access denied",
        },
      });
      return;
    }

    if (d.reply_to_id) {
      const reply = await this.env.DB.prepare(
        "SELECT 1 FROM messages WHERE id = ? AND channel_id = ? LIMIT 1",
      )
        .bind(d.reply_to_id, d.channel_id)
        .first()
        .catch(() => null);
      if (!reply) {
        this.sendTo(ws, {
          op: Op.Error,
          d: {
            code: 4004,
            message: "Reply message does not belong to channel",
          },
        });
        return;
      }
    }

    const messageId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Persist to D1
    try {
      await this.env.DB.batch([
        this.env.DB.prepare(
          `INSERT INTO messages (id, channel_id, author_id, content, reply_to_id, created_at, content_revision)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
        ).bind(
          messageId,
          d.channel_id,
          session.user_id,
          d.content.trim(),
          d.reply_to_id ?? null,
          now,
        ),
        this.env.DB.prepare(
          `INSERT INTO message_postprocessing_jobs
               (message_id, revision, channel_id, notify)
             VALUES (?, 1, ?, 1)`,
        ).bind(messageId, d.channel_id),
      ]);
    } catch (err) {
      log.error("Failed to insert message:", err);
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 5000, message: "Failed to save message" },
      });
      return;
    }

    // Build message object for dispatch
    const message = {
      id: messageId,
      channel_id: d.channel_id,
      author_id: session.user_id,
      author: {
        id: session.user_id,
        username: session.username ?? session.name,
        display_name: session.display_name ?? session.name,
        avatar_url: session.avatar_url,
        avatar_display: session.avatar_display,
      },
      content: d.content.trim(),
      content_revision: 1,
      reply_to_id: d.reply_to_id,
      is_pinned: false,
      created_at: now,
      nonce: d.nonce,
      attachments: [],
      reactions: [],
    };

    const messageDispatch = {
      op: Op.Dispatch,
      d: { event: "MESSAGE_CREATE", data: message },
    };
    const postprocessingTask = {
      messageId,
      channelId: d.channel_id,
      revision: 1,
      notify: true,
    } satisfies MessagePostprocessingTask;
    if (access.serverId) {
      await this.broadcastToServerMembers(access.serverId, messageDispatch);
    } else {
      await this.broadcastToChannel(d.channel_id, messageDispatch);
      const { results } = await this.env.DB.prepare(
        "SELECT user_id FROM dm_recipients WHERE channel_id = ? AND user_id != ?",
      )
        .bind(d.channel_id, session.user_id)
        .all<{ user_id: string }>();
      for (const row of results ?? []) {
        if (typeof row.user_id === "string") {
          this.broadcastToUser(row.user_id, messageDispatch);
        }
      }
    }
    scheduleMessagePostprocessing(
      this.env,
      postprocessingTask,
      (promise) => this.ctx.waitUntil(promise),
      { outboxRecorded: true },
    );
  }

  // ── Op 21: MessageUpdate ──────────────────────────────────────────────

  private async handleMessageUpdate(
    ws: WebSocket,
    d: MainClientPayload<Op.MessageUpdate>,
  ) {
    const session = this.requireSession(ws);
    if (
      !session?.user_id ||
      !d.message_id ||
      !d.content.trim() ||
      d.content.length > 4000
    ) {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.InvalidPayload,
          message: "Invalid message payload",
        },
      });
      return;
    }

    const now = new Date().toISOString();
    const messageRow = await this.env.DB.prepare(
      "SELECT channel_id, author_id FROM messages WHERE id = ? LIMIT 1",
    )
      .bind(d.message_id)
      .first<{ channel_id: string; author_id: string }>()
      .catch(() => null);
    if (!messageRow) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4004, message: "Message not found" },
      });
      return;
    }

    const access = await resolveChannelAccess(
      this.env.DB,
      session.user_id,
      messageRow.channel_id,
    );
    const canManage =
      !!access &&
      access.serverId !== null &&
      hasChannelPermission(access, PERMISSIONS.MANAGE_MESSAGES);
    if (!access || (messageRow.author_id !== session.user_id && !canManage)) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4004, message: "Message not found or not owner" },
      });
      return;
    }

    let revision: number;
    try {
      const [updatedResult] = await this.env.DB.batch([
        this.env.DB.prepare(
          `UPDATE messages
             SET content = ?, updated_at = ?, content_revision = content_revision + 1
             WHERE id = ? AND channel_id = ? AND (author_id = ? OR ? = 1)
             RETURNING content_revision`,
        ).bind(
          d.content.trim(),
          now,
          d.message_id,
          messageRow.channel_id,
          session.user_id,
          canManage ? 1 : 0,
        ),
        this.env.DB.prepare(
          `INSERT INTO message_postprocessing_jobs
               (message_id, revision, channel_id, notify)
             SELECT ?, content_revision, ?, 0
             FROM messages
             WHERE id = ? AND channel_id = ?`,
        ).bind(
          d.message_id,
          messageRow.channel_id,
          d.message_id,
          messageRow.channel_id,
        ),
      ]);
      const updated =
        (updatedResult?.results?.[0] as
          | {
              content_revision: number;
            }
          | undefined) ?? null;

      if (!updated) {
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: 4004, message: "Message not found or not owner" },
        });
        return;
      }
      revision = Number(updated.content_revision);
    } catch (err) {
      log.error("Failed to update message:", err);
      return;
    }

    const postprocessingTask = {
      messageId: d.message_id,
      channelId: messageRow.channel_id,
      revision,
      notify: false,
    } satisfies MessagePostprocessingTask;

    {
      const updateDispatch = {
        op: Op.Dispatch,
        d: {
          event: "MESSAGE_UPDATE",
          data: {
            id: d.message_id,
            channel_id: messageRow.channel_id,
            content: d.content.trim(),
            updated_at: now,
            content_revision: revision,
          },
        },
      };
      if (access.serverId) {
        await this.broadcastToServerMembers(access.serverId, updateDispatch);
      } else {
        await this.broadcastToChannel(messageRow.channel_id, updateDispatch);
      }
      scheduleMessagePostprocessing(
        this.env,
        postprocessingTask,
        (promise) => this.ctx.waitUntil(promise),
        { outboxRecorded: true },
      );
    }
  }

  // ── Op 22: MessageDelete ──────────────────────────────────────────────

  private async handleMessageDelete(
    ws: WebSocket,
    d: MainClientPayload<Op.MessageDelete>,
  ) {
    const session = this.requireSession(ws);
    if (!session?.user_id || !d.message_id || !d.channel_id) {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.InvalidPayload,
          message: "Invalid message payload",
        },
      });
      return;
    }

    const messageRow = await this.env.DB.prepare(
      "SELECT channel_id, author_id FROM messages WHERE id = ? LIMIT 1",
    )
      .bind(d.message_id)
      .first<{ channel_id: string; author_id: string }>()
      .catch(() => null);
    if (!messageRow || messageRow.channel_id !== d.channel_id) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4004, message: "Message does not belong to channel" },
      });
      return;
    }

    const access = await resolveChannelAccess(
      this.env.DB,
      session.user_id,
      messageRow.channel_id,
    );
    const canManage =
      !!access &&
      access.serverId !== null &&
      hasChannelPermission(access, PERMISSIONS.MANAGE_MESSAGES);
    if (!access || (messageRow.author_id !== session.user_id && !canManage)) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4004, message: "Message not found or not owner" },
      });
      return;
    }

    let attachmentKeys: string[];
    try {
      attachmentKeys = await fetchMessageAttachmentKeys(
        this.env.DB,
        d.message_id,
      );
    } catch (error: unknown) {
      log.error("Failed to load message attachments before delete:", error);
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 5000, message: "Failed to delete message" },
      });
      return;
    }

    try {
      const result = await this.env.DB.prepare(
        `DELETE FROM messages
         WHERE id = ? AND channel_id = ? AND (author_id = ? OR ? = 1)`,
      )
        .bind(
          d.message_id,
          messageRow.channel_id,
          session.user_id,
          canManage ? 1 : 0,
        )
        .run();

      if (!result.meta.changes || result.meta.changes === 0) {
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: 4004, message: "Message not found or not owner" },
        });
        return;
      }
    } catch (err) {
      log.error("Failed to delete message:", err);
      return;
    }

    for (const fileKey of attachmentKeys) {
      try {
        await this.env.BUCKET.delete(fileKey);
      } catch (cleanupError: unknown) {
        try {
          await recordR2CleanupFailure(this.env.DB, fileKey, cleanupError);
        } catch (recordError: unknown) {
          log.error("Failed to record R2 cleanup failure:", recordError);
        }
        try {
          scheduleR2Cleanup(this.env, fileKey, (promise) =>
            this.ctx.waitUntil(promise),
          );
        } catch (scheduleError: unknown) {
          log.error("Failed to schedule R2 cleanup failure:", scheduleError);
        }
      }
    }

    const deleteDispatch = {
      op: Op.Dispatch,
      d: {
        event: "MESSAGE_DELETE",
        data: { id: d.message_id, channel_id: messageRow.channel_id },
      },
    };
    if (access.serverId) {
      await this.broadcastToServerMembers(access.serverId, deleteDispatch);
    } else {
      await this.broadcastToChannel(messageRow.channel_id, deleteDispatch);
    }
  }

  // ── Op 23: TypingStart ────────────────────────────────────────────────

  private async handleTypingStart(
    ws: WebSocket,
    d: MainClientPayload<Op.TypingStart>,
  ) {
    const session = this.requireSession(ws);
    if (!session?.user_id) return;

    const access = await resolveChannelAccess(
      this.env.DB,
      session.user_id,
      d.channel_id,
    );
    if (!access || !hasChannelPermission(access, PERMISSIONS.VIEW_CHANNELS)) {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.NotAuthenticated,
          message: "Channel not found or access denied",
        },
      });
      return;
    }

    await this.broadcastToChannel(
      d.channel_id,
      {
        op: Op.Dispatch,
        d: {
          event: "TYPING_START",
          data: {
            channel_id: d.channel_id,
            user_id: session.user_id,
            username: session.username ?? session.name,
            display_name: session.display_name ?? session.name,
            timestamp: Date.now(),
          },
        },
      },
      ws, // exclude sender
    );
  }

  // ── Op 24: ReactionAdd ────────────────────────────────────────────────

  private async handleReactionAdd(
    ws: WebSocket,
    d: MainClientPayload<Op.ReactionAdd>,
  ) {
    const session = this.requireSession(ws);
    if (
      !session?.user_id ||
      !d.channel_id ||
      !d.message_id ||
      !d.emoji ||
      d.emoji.length > 128
    ) {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.InvalidPayload,
          message: "Invalid reaction payload",
        },
      });
      return;
    }

    const message = await this.env.DB.prepare(
      "SELECT channel_id FROM messages WHERE id = ? LIMIT 1",
    )
      .bind(d.message_id)
      .first<{ channel_id: string }>()
      .catch(() => null);
    const access = message
      ? await resolveChannelAccess(
          this.env.DB,
          session.user_id,
          message.channel_id,
        )
      : null;
    if (
      !message ||
      message.channel_id !== d.channel_id ||
      !access ||
      !hasChannelPermission(access, PERMISSIONS.ADD_REACTIONS)
    ) {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.NotAuthenticated,
          message: "Channel not found or access denied",
        },
      });
      return;
    }

    const userId = session.user_id;
    const now = new Date().toISOString();

    try {
      await this.env.DB.prepare(
        `INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji, created_at)
         VALUES (?, ?, ?, ?)`,
      )
        .bind(d.message_id, userId, d.emoji, now)
        .run();
    } catch (err) {
      log.error("Failed to add reaction:", err);
      return;
    }

    await this.broadcastToChannel(d.channel_id, {
      op: Op.Dispatch,
      d: {
        event: "REACTION_ADD",
        data: {
          channel_id: d.channel_id,
          message_id: d.message_id,
          user_id: userId,
          emoji: d.emoji,
        },
      },
    });
  }

  // ── Op 25: ReactionRemove ─────────────────────────────────────────────

  private async handleReactionRemove(
    ws: WebSocket,
    d: MainClientPayload<Op.ReactionRemove>,
  ) {
    const session = this.requireSession(ws);
    if (
      !session?.user_id ||
      !d.channel_id ||
      !d.message_id ||
      !d.emoji ||
      d.emoji.length > 128
    ) {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.InvalidPayload,
          message: "Invalid reaction payload",
        },
      });
      return;
    }

    const message = await this.env.DB.prepare(
      "SELECT channel_id FROM messages WHERE id = ? LIMIT 1",
    )
      .bind(d.message_id)
      .first<{ channel_id: string }>()
      .catch(() => null);
    const access = message
      ? await resolveChannelAccess(
          this.env.DB,
          session.user_id,
          message.channel_id,
        )
      : null;
    if (
      !message ||
      message.channel_id !== d.channel_id ||
      !access ||
      !hasChannelPermission(access, PERMISSIONS.ADD_REACTIONS)
    ) {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.NotAuthenticated,
          message: "Channel not found or access denied",
        },
      });
      return;
    }

    const userId = session.user_id;

    try {
      await this.env.DB.prepare(
        `DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?`,
      )
        .bind(d.message_id, userId, d.emoji)
        .run();
    } catch (err) {
      log.error("Failed to remove reaction:", err);
      return;
    }

    await this.broadcastToChannel(d.channel_id, {
      op: Op.Dispatch,
      d: {
        event: "REACTION_REMOVE",
        data: {
          channel_id: d.channel_id,
          message_id: d.message_id,
          user_id: userId,
          emoji: d.emoji,
        },
      },
    });
  }

  // ── Channel subscription cleanup on leave ─────────────────────────────

  private cleanupChannelSubscriptions(ws: WebSocket) {
    const session = this.getSession(ws);
    if (!session) return;

    for (const channelId of session.subscribed_channels) {
      const subs = this.channelSubscriptions.get(channelId);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) this.channelSubscriptions.delete(channelId);
      }
    }
  }

  // ── Server subscription cleanup on leave ──────────────────────────────

  private cleanupServerSubscriptions(ws: WebSocket) {
    const session = this.getSession(ws);
    if (!session) return;

    for (const serverId of session.subscribed_servers ?? []) {
      const subs = this.serverSubscriptions.get(serverId);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) this.serverSubscriptions.delete(serverId);
      }
    }
  }

  // ── Op 35: ServerSubscribe ────────────────────────────────────────────

  private async handleServerSubscribe(
    ws: WebSocket,
    d: MainClientPayload<Op.ServerSubscribe>,
  ) {
    const session = this.requireSession(ws);
    if (!session || !d.server_id || !session.user_id) return;

    // Already subscribed?
    if (session.subscribed_servers?.includes(d.server_id)) return;

    // Validate membership against D1
    try {
      const row = await this.env.DB.prepare(
        "SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?",
      )
        .bind(d.server_id, session.user_id)
        .first();

      if (!row) {
        log.info(
          `ServerSubscribe denied: ${session.name} is not member of ${d.server_id}`,
        );
        return;
      }
    } catch (e) {
      log.error(`ServerSubscribe D1 error:`, e);
      return;
    }

    // Add to server subscription map
    let subs = this.serverSubscriptions.get(d.server_id);
    if (!subs) {
      subs = new Set();
      this.serverSubscriptions.set(d.server_id, subs);
    }
    subs.add(ws);

    // Track on the session
    if (!session.subscribed_servers) session.subscribed_servers = [];
    session.subscribed_servers.push(d.server_id);
    this.persist(ws, session);

    log.info(`${session.name} subscribed to server ${d.server_id}`);
  }

  // ── Op 36: CallInitiate ──────────────────────────────────────────────

  private async getExactDmRecipients(
    channelId: string,
  ): Promise<Set<string> | null> {
    const channel = await this.env.DB.prepare(
      "SELECT server_id, channel_type FROM channels WHERE id = ? LIMIT 1",
    )
      .bind(channelId)
      .first<{ server_id: string | null; channel_type: string }>()
      .catch(() => null);
    if (!channel || channel.server_id !== null) return null;

    const recipients = await this.env.DB.prepare(
      "SELECT user_id FROM dm_recipients WHERE channel_id = ?",
    )
      .bind(channelId)
      .all<{ user_id: string }>()
      .catch(() => null);
    if (!recipients?.results || recipients.results.length !== 2) return null;

    const ids = recipients.results.map((row) => row.user_id);
    if (new Set(ids).size !== 2) return null;
    return new Set(ids);
  }

  private async handleCallInitiate(
    ws: WebSocket,
    d: MainClientPayload<Op.CallInitiate>,
  ) {
    const session = this.requireSession(ws);
    if (!session || !session.user_id || !d.target_user_id || !d.channel_id)
      return;

    const callerId = session.user_id;
    const calleeId = d.target_user_id;

    const unavailable = () =>
      this.sendTo(ws, {
        op: Op.Dispatch,
        d: {
          event: "CALL_RING_STOP",
          data: { call_id: null, reason: "unavailable" },
        },
      });

    const recipients = await this.getExactDmRecipients(d.channel_id);
    if (!recipients || !recipients.has(callerId) || !recipients.has(calleeId)) {
      unavailable();
      return;
    }

    // Self-call prevention
    if (callerId === calleeId) {
      this.sendTo(ws, {
        op: Op.Dispatch,
        d: {
          event: "CALL_RING_STOP",
          data: { call_id: null, reason: "invalid" },
        },
      });
      return;
    }

    // Check if caller has a pending call already
    if (this.findPendingCallForUser(callerId)) {
      this.sendTo(ws, {
        op: Op.Dispatch,
        d: { event: "CALL_RING_STOP", data: { call_id: null, reason: "busy" } },
      });
      return;
    }

    // Check if callee is already being rung by someone else
    if (this.pendingCalls.has(calleeId)) {
      this.sendTo(ws, {
        op: Op.Dispatch,
        d: { event: "CALL_RING_STOP", data: { call_id: null, reason: "busy" } },
      });
      return;
    }

    // Check relationship: must not be blocked
    try {
      const rel = await this.env.DB.prepare(
        "SELECT type FROM relationships WHERE user_id = ? AND target_user_id = ?",
      )
        .bind(calleeId, callerId)
        .first<{ type: number }>();
      if (rel?.type === 1) {
        // Blocked — silently fail
        this.sendTo(ws, {
          op: Op.Dispatch,
          d: {
            event: "CALL_RING_STOP",
            data: { call_id: null, reason: "unavailable" },
          },
        });
        return;
      }
    } catch (e) {
      log.error("Call relationship check failed:", e);
      unavailable();
      return;
    }

    // Check callee is online — at least one session exists
    let calleeOnline = false;
    let calleeName: string | undefined;
    let calleeUsername: string | undefined;
    let calleeDisplayName: string | null | undefined;
    let calleeAvatar: string | null | undefined;
    for (const [, sess] of this.sessions) {
      if (sess.user_id === calleeId) {
        calleeOnline = true;
        calleeName = sess.name;
        calleeUsername = sess.username ?? sess.name;
        calleeDisplayName = sess.display_name ?? sess.name;
        calleeAvatar = sess.avatar_url;
        break;
      }
    }

    // Phones ring over FCM too, so a callee with no live socket (every
    // backgrounded phone) is still reachable.
    const fcm = fcmSenderFor(this.env.FCM_SERVICE_ACCOUNT);
    const ringTokens = fcm
      ? await callRingTokens(this.env.DB, calleeId).catch((error) => {
          log.error("Call ring tokens lookup failed:", error);
          return [];
        })
      : [];
    const plan = planCallRing({
      online: calleeOnline,
      pushDevices: ringTokens.length,
    });
    if (!plan.ring) {
      unavailable();
      return;
    }
    if (!calleeOnline) {
      const callee = await this.env.DB.prepare(
        "SELECT username, display_name, avatar_url FROM users WHERE id = ?",
      )
        .bind(calleeId)
        .first<{
          username: string | null;
          display_name: string | null;
          avatar_url: string | null;
        }>()
        .catch(() => null);
      calleeUsername = callee?.username ?? undefined;
      calleeName = callee?.display_name ?? callee?.username ?? undefined;
      calleeDisplayName = callee?.display_name ?? calleeName;
      calleeAvatar = callee?.avatar_url ?? null;
    }

    // A caller who is in another call's ring (or had one between the awaits
    // above) cannot start a second one.
    if (
      this.findPendingCallForUser(callerId) ||
      this.pendingCalls.has(calleeId)
    ) {
      this.sendTo(ws, {
        op: Op.Dispatch,
        d: { event: "CALL_RING_STOP", data: { call_id: null, reason: "busy" } },
      });
      return;
    }

    // Create pending call
    const callId = crypto.randomUUID();
    const sortedIds = [callerId, calleeId].sort();
    const voiceRoomId = `dm-call-${sortedIds[0]}-${sortedIds[1]}`;

    const pendingCallData: StoredPendingCall = {
      callId,
      callerId,
      calleeId,
      channelId: d.channel_id,
      voiceRoomId,
      expiresAt: Date.now() + CALL_RING_TIMEOUT_MS,
      callerName: session.name,
      callerUsername: session.username ?? session.name,
      callerDisplayName: session.display_name ?? session.name,
      callerAvatar: session.avatar_url,
      calleeName,
      calleeUsername,
      calleeDisplayName,
      calleeAvatar,
      pushed: plan.push,
    };
    const pendingCall: PendingCall = {
      ...pendingCallData,
      timeout: this.schedulePendingCallTimeout(pendingCallData),
    };
    this.pendingCalls.set(calleeId, pendingCall);
    this.persistPendingCalls();

    // Notify callee — ring!
    this.broadcastToUser(calleeId, {
      op: Op.Dispatch,
      d: {
        event: "CALL_RING",
        data: {
          call_id: callId,
          caller_id: callerId,
          caller_name: session.name,
          caller_username: session.username ?? session.name,
          caller_display_name: session.display_name ?? session.name,
          caller_avatar: session.avatar_url,
          channel_id: d.channel_id,
        },
      },
    });

    if (plan.push) {
      this.ctx.waitUntil(
        sendCallRingPushes(this.env.DB, fcm, ringTokens, {
          callId,
          channelId: d.channel_id,
          callerId,
          callerName: getDisplayName(
            {
              display_name: session.display_name,
              username: session.username,
              name: session.name,
            },
            session.name,
          ),
          callerAvatarUrl: session.avatar_url ?? null,
          expiresAt: pendingCallData.expiresAt,
        }),
      );
    }

    // The caller shows in the DM's voice once their client joins its room
    // (the room's roster); here the channel is only their op 15 hint target.
    session.voice_channel_id = d.channel_id;
    this.persist(ws, session);

    // Notify caller — ringing outgoing!
    this.broadcastToUser(callerId, {
      op: Op.Dispatch,
      d: {
        event: "CALL_RINGING",
        data: {
          call_id: callId,
          callee_id: calleeId,
          callee_name: calleeName,
          callee_username: calleeUsername,
          callee_display_name: calleeDisplayName,
          callee_avatar: calleeAvatar,
          channel_id: d.channel_id,
        },
      },
    });

    log.info(`Call initiated: ${callId}, ${session.name} → ${calleeName}`);
  }

  // ── Op 37: CallAccept ────────────────────────────────────────────────

  private handleCallAccept(ws: WebSocket, d: MainClientPayload<Op.CallAccept>) {
    const session = this.requireSession(ws);
    if (!session || !session.user_id || !d.call_id) return;

    const calleeId = session.user_id;

    if (this.acceptedCalls.has(d.call_id)) {
      log.info(
        `Ignored Op 37 for ${d.call_id} — call was already implicitly/recently accepted.`,
      );
      return;
    }

    const pending = this.pendingCalls.get(calleeId);
    if (!pending || pending.callId !== d.call_id) {
      // If we are already in the correct voice channel but there's no pending call,
      // it might have been implicitly accepted and timed out of acceptedCalls cache.
      // But just to be safe, we just send "expired" if we really can't find it.
      this.sendTo(ws, {
        op: Op.Dispatch,
        d: {
          event: "CALL_RING_STOP",
          data: { call_id: d.call_id, reason: "expired" },
        },
      });
      return;
    }

    // Cache the accepted call to avoid race conditions with a late Op 33 (VoiceChannelJoin)
    const callIdToCache = pending.callId;
    this.acceptedCalls.add(callIdToCache);
    setTimeout(() => this.acceptedCalls.delete(callIdToCache), 10000);

    clearTimeout(pending.timeout);
    this.pendingCalls.delete(calleeId);
    this.persistPendingCalls();

    // The callee shows in the DM's voice once their client joins its room.
    session.voice_channel_id = pending.channelId;
    this.persist(ws, session);

    // Notify both parties that ringing should stop
    this.broadcastToUser(pending.callerId, {
      op: Op.Dispatch,
      d: {
        event: "CALL_RING_STOP",
        data: { call_id: pending.callId, reason: "accepted" },
      },
    });
    this.broadcastToUser(pending.calleeId, {
      op: Op.Dispatch,
      d: {
        event: "CALL_RING_STOP",
        data: { call_id: pending.callId, reason: "accepted" },
      },
    });

    this.settleRing(pending, "accepted");
    log.info(`Call accepted: ${pending.callId}`);
  }

  // ── Op 38: CallDecline ───────────────────────────────────────────────

  private handleCallDecline(
    ws: WebSocket,
    d: MainClientPayload<Op.CallDecline>,
  ) {
    const session = this.requireSession(ws);
    if (!session || !session.user_id || !d.call_id) return;

    const calleeId = session.user_id;
    const pending = this.pendingCalls.get(calleeId);
    if (!pending || pending.callId !== d.call_id) return;

    clearTimeout(pending.timeout);
    this.pendingCalls.delete(calleeId);
    this.persistPendingCalls();

    // Notify both parties that ringing should stop
    this.broadcastToUser(pending.callerId, {
      op: Op.Dispatch,
      d: {
        event: "CALL_RING_STOP",
        data: { call_id: pending.callId, reason: "declined" },
      },
    });
    this.broadcastToUser(pending.calleeId, {
      op: Op.Dispatch,
      d: {
        event: "CALL_RING_STOP",
        data: { call_id: pending.callId, reason: "declined" },
      },
    });

    this.settleRing(pending, "declined");
    log.info(`Call declined: ${pending.callId}`);
  }

  private handleCallEnd(ws: WebSocket, d: MainClientPayload<Op.CallEnd>) {
    const session = this.requireSession(ws);
    if (!session || !session.user_id) return;

    const userId = session.user_id;

    // Active calls are automatically torn down natively when both users drop out of the voice channel.
    // CALL_END is now purely designated for aborting/declining pending Rings!

    // Maybe they're cancelling an outgoing ring
    // A CALL_END for an earlier call must not cancel the ring that replaced it.
    const pending = this.findPendingCallForUser(userId);
    if (pending && pending.callId === d.call_id) {
      clearTimeout(pending.timeout);
      this.pendingCalls.delete(pending.calleeId);
      this.persistPendingCalls();

      // The caller leaves the DM's voice room themselves; its roster then
      // takes them off the sidebar.

      this.broadcastToUser(pending.calleeId, {
        op: Op.Dispatch,
        d: {
          event: "CALL_RING_STOP",
          data: { call_id: pending.callId, reason: "cancelled" },
        },
      });
      this.broadcastToUser(pending.callerId, {
        op: Op.Dispatch,
        d: {
          event: "CALL_RING_STOP",
          data: { call_id: pending.callId, reason: "cancelled" },
        },
      });
      this.settleRing(pending, "cancelled");
      log.info(`Call cancelled by caller: ${pending.callId}`);
    }
  }

  // ── Call helpers ──────────────────────────────────────────────────────

  /** Find a pending call where the user is the caller */
  private findPendingCallForUser(userId: string): PendingCall | null {
    for (const [, call] of this.pendingCalls) {
      if (call.callerId === userId || call.calleeId === userId) {
        return call;
      }
    }
    return null;
  }

  /**
   * Clean up all calls for a user (called on disconnect/leave). `closing` is
   * the socket going away, which no longer counts as the user's.
   */
  private cleanupCallsForUser(
    userId: string,
    reason: CallRingStopReason,
    closing?: WebSocket,
  ) {
    log.info(
      `cleanupCallsForUser(${userId}, ${reason}): pendingCalls.size=${this.pendingCalls.size}`,
    );

    // Clean up pending calls (as callee). The ring goes on while the callee
    // has another live session or their phones were rung: a phone's socket
    // closing as the app goes behind is no reason to stop ringing it.
    const pendingAsCallee = this.pendingCalls.get(userId);
    if (
      pendingAsCallee &&
      !pendingAsCallee.pushed &&
      !this.hasLiveSession(userId, closing)
    ) {
      log.info(
        `Cleaning up pending call as callee: callId=${pendingAsCallee.callId}`,
      );
      clearTimeout(pendingAsCallee.timeout);
      this.pendingCalls.delete(userId);
      this.persistPendingCalls();
      this.broadcastToUser(pendingAsCallee.callerId, {
        op: Op.Dispatch,
        d: {
          event: "CALL_RING_STOP",
          data: { call_id: pendingAsCallee.callId, reason },
        },
      });
      this.settleRing(pendingAsCallee, reason);
    }

    // Clean up pending calls (as caller)
    for (const [calleeId, call] of this.pendingCalls) {
      if (call.callerId === userId) {
        log.info(`Cleaning up pending call as caller: callId=${call.callId}`);
        clearTimeout(call.timeout);
        this.pendingCalls.delete(calleeId);
        this.persistPendingCalls();
        this.broadcastToUser(calleeId, {
          op: Op.Dispatch,
          d: {
            event: "CALL_RING_STOP",
            data: { call_id: call.callId, reason },
          },
        });
        this.settleRing(call, reason);
      }
    }

    // Active calls purely live in voice channel presence now, and `handleLeave`
    // natively removes users from `voiceChannelMembers`. We don't need any more manually teardown logic!
    log.info(`cleanupCallsForUser done.`);
  }

  /** A live, non-standby gateway session of `userId` other than `except`. */
  private hasLiveSession(userId: string, except?: WebSocket): boolean {
    for (const [ws, session] of this.sessions) {
      if (ws !== except && session.user_id === userId && !session.standby) {
        return true;
      }
    }
    return false;
  }

  private findPendingCallById(callId: string): PendingCall | null {
    for (const call of this.pendingCalls.values()) {
      if (call.callId === callId) return call;
    }
    return null;
  }

  /** What a ring push and its stop say about the call. */
  private ringOf(call: StoredPendingCall) {
    return {
      callId: call.callId,
      channelId: call.channelId,
      callerId: call.callerId,
      callerName: call.callerDisplayName ?? call.callerName,
      callerAvatarUrl: call.callerAvatar ?? null,
    };
  }

  /**
   * After a ring ended for `reason` (the call is out of pendingCalls): stop
   * the callee's phones ringing and save what happened. An answered call
   * becomes active; its record is written when its channel empties.
   */
  private settleRing(call: StoredPendingCall, reason: CallRingStopReason) {
    if (call.pushed) {
      this.ctx.waitUntil(
        sendCallRingStopPushes(
          this.env.DB,
          fcmSenderFor(this.env.FCM_SERVICE_ACCOUNT),
          call.calleeId,
          this.ringOf(call),
          reason,
        ),
      );
    }
    if (reason === "accepted") {
      this.startActiveCall(call);
      return;
    }
    this.ctx.waitUntil(
      this.recordCall(call.channelId, {
        call_id: call.callId,
        outcome: isMissedRingStop(reason) ? "missed" : "declined",
        caller_id: call.callerId,
        callee_id: call.calleeId,
      }),
    );
  }

  private startActiveCall(call: StoredPendingCall) {
    const previous = this.activeCalls.get(call.channelId);
    if (previous && previous.callId !== call.callId) {
      this.finishActiveCall(call.channelId);
    }
    this.activeCalls.set(call.channelId, {
      callId: call.callId,
      callerId: call.callerId,
      calleeId: call.calleeId,
      channelId: call.channelId,
      acceptedAt: Date.now(),
    });
    this.persistActiveCalls();
  }

  /** The answered call's channel emptied: save it as ended, with its length. */
  private finishActiveCall(channelId: string) {
    const call = this.activeCalls.get(channelId);
    if (!call) return;
    this.activeCalls.delete(channelId);
    this.persistActiveCalls();
    this.ctx.waitUntil(
      this.recordCall(channelId, {
        call_id: call.callId,
        outcome: "ended",
        caller_id: call.callerId,
        callee_id: call.calleeId,
        duration_s: Math.max(
          0,
          Math.round((Date.now() - call.acceptedAt) / 1000),
        ),
      }),
    );
  }

  private persistActiveCalls() {
    const serialized = serializeActiveCalls(this.activeCalls);
    const empty = this.activeCalls.size === 0;
    this.scheduleDurableStateWrite(
      () =>
        empty
          ? this.ctx.storage.delete(ACTIVE_CALLS_STORAGE_KEY)
          : this.ctx.storage.put(ACTIVE_CALLS_STORAGE_KEY, serialized),
      "active calls",
    );
  }

  /** Saves a call record in the DM and shows it to both people. */
  private async recordCall(channelId: string, record: CallRecord) {
    try {
      const message = await insertCallRecord(
        this.env.DB,
        channelId,
        crypto.randomUUID(),
        record,
      );
      const dispatch = {
        op: Op.Dispatch,
        d: { event: "MESSAGE_CREATE", data: message },
      };
      this.broadcastToUser(record.caller_id, dispatch);
      this.broadcastToUser(record.callee_id, dispatch);
      this.flushDirtyStorage();
    } catch (error) {
      log.error("Failed to save the call record:", error);
    }
  }

  /** POST /api/calls/:id/accept: the callee answered without a socket. */
  private acceptCallFromRest(
    callId: string,
    userId: string,
  ): "ok" | "not_callee" | "not_found" {
    const pending = this.findPendingCallById(callId);
    if (!pending) {
      // Answered already (the phone's notification, then the app): fine
      // for the callee, so the app can go on and join.
      for (const active of this.activeCalls.values()) {
        if (active.callId === callId) {
          return active.calleeId === userId ? "ok" : "not_callee";
        }
      }
      return "not_found";
    }
    if (pending.calleeId !== userId) return "not_callee";

    this.acceptedCalls.add(callId);
    setTimeout(() => this.acceptedCalls.delete(callId), 10000);
    clearTimeout(pending.timeout);
    this.pendingCalls.delete(pending.calleeId);
    this.persistPendingCalls();

    // The callee joins the DM's voice channel from the app, like any join.
    const evt = {
      op: Op.Dispatch,
      d: {
        event: "CALL_RING_STOP",
        data: { call_id: callId, reason: "accepted" },
      },
    };
    this.broadcastToUser(pending.callerId, evt);
    this.broadcastToUser(pending.calleeId, evt);
    this.settleRing(pending, "accepted");
    log.info(`Call accepted over REST: ${callId}`);
    return "ok";
  }

  /** POST /api/calls/:id/decline: the callee declined without a socket. */
  private declineCallFromRest(
    callId: string,
    userId: string,
  ): "ok" | "not_callee" | "not_found" {
    const pending = this.findPendingCallById(callId);
    if (!pending) return "not_found";
    if (pending.calleeId !== userId) return "not_callee";

    clearTimeout(pending.timeout);
    this.pendingCalls.delete(pending.calleeId);
    this.persistPendingCalls();

    const evt = {
      op: Op.Dispatch,
      d: {
        event: "CALL_RING_STOP",
        data: { call_id: callId, reason: "declined" },
      },
    };
    this.broadcastToUser(pending.callerId, evt);
    this.broadcastToUser(pending.calleeId, evt);
    this.settleRing(pending, "declined");
    log.info(`Call declined over REST: ${callId}`);
    return "ok";
  }
}
