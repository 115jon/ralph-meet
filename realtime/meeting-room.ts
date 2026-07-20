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
import { extractAndProcessEmbeds } from "../src/services/embed-fetcher";
import {
  resolveVisibleChannelPermissions,
  type ChannelVisibilityOverride,
  type ChannelVisibilityRole,
} from "../src/lib/channel-visibility";
import { clog } from "../src/lib/console-logger";
import {
  isReconnectWithinGrace,
  shouldKeepResumableSession,
} from "../src/lib/voice/connection-generation";
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
import { getRealtimeAdmissionFromHeaders } from "./realtime-admission";
import { resolveMeetingProfile } from "./meeting-room/profile-resolver";
import { ProfileRequestCoordinator } from "./meeting-room/profile-request-coordinator";
import { generateTurnCredentials as resolveTurnCredentials } from "./meeting-room/turn-credentials";
import { issueVoiceToken } from "./voice-token";

const log = clog("ChatGW");
const meetingLog = clog("MeetingRoom");
const identifyLog = clog("handleIdentify");
const presenceLog = clog("handlePresenceUpdate");

interface Env {
  CALLS_APP_ID: string;
  CALLS_APP_SECRET: string;
  TURN_TOKEN_ID: string;
  TURN_TOKEN_SECRET: string;
  CLERK_SECRET_KEY: string;
  DB: D1Database;
  BUCKET: R2Bucket;
  CACHE: KVNamespace;
  DEBUG?: string;
}

// ── Opcodes ─────────────────────────────────────────────────────────────────

const enum Op {
  Identify = 0,
  Ready = 2,
  Heartbeat = 3,
  Speaking = 5,
  HeartbeatACK = 6,
  Resume = 7,
  Hello = 8,
  Resumed = 9,
  ClientDisconnect = 11,
  VoiceStateUpdate = 15,
  ProfileUpdate = 16,
  ProfileRefresh = 17,
  Error = 18,
  // Chat opcodes
  Dispatch = 19,
  MessageCreate = 20,
  MessageUpdate = 21,
  MessageDelete = 22,
  TypingStart = 23,
  ReactionAdd = 24,
  ReactionRemove = 25,
  PresenceUpdate = 26,
  ChannelSubscribe = 27,
  ChannelUnsubscribe = 28,
  ChannelUpdate = 29,
  ChannelDelete = 30,
  GuildMemberUpdate = 31,
  RelationshipUpdate = 32,
  VoiceChannelJoin = 33,
  VoiceChannelLeave = 34,
  ServerSubscribe = 35,
  // Call opcodes
  CallInitiate = 36,
  CallAccept = 37,
  CallDecline = 38,
  CallEnd = 39,
  RefreshVoiceCredentials = 40,
}

const enum CloseCode {
  UnknownOpcode = 4001,
  NotAuthenticated = 4003,
  AdmissionRejected = 4008,
  AlreadyAuthenticated = 4005,
  SessionInvalid = 4006,
  SessionTimeout = 4009,
}

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
  clerk_user_id?: string;
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
  push_session_id?: string;
  pull_session_id?: string;
  tracks: TrackInfo[];
}

// ── Gateway message shapes ──────────────────────────────────────────────────

interface GatewayMessage {
  op: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  d: any;
}

type ServerMsg = GatewayMessage;

type VoiceStateDelta = Omit<
  VoiceState,
  "name" | "username" | "display_name" | "avatar_url" | "avatar_display"
>;

// Data stored on each WebSocket via serializeAttachment/deserializeAttachment
interface WsAttachment {
  admission?: {
    accessMode: "authenticated" | "public-demo";
    connectionGeneration: string;
    subject: string;
  };
  id: string;
  name: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_display?: string | null;
  platform?: PresencePlatform;
  clerk_user_id?: string;
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
  /** Legacy field accepted while reading pre-continuity snapshots. */
  replay_buffer?: ReplayEntry[];
  /** Channel ID the user is currently in voice for (global gateway only) */
  voice_channel_id?: string;
  /** Client can merge profile-less VOICE_CHANNEL_STATE_UPDATE members. */
  supports_voice_state_deltas?: boolean;
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

export interface VoiceChannelMember {
  clerk_user_id: string;
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

interface ProfileIdentity {
  name: string;
  username?: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_display: string | null;
}

interface SpatialAudioState {
  enabled: boolean;
  placementMode: "line" | "arc" | "grid" | "manual";
  roomSize: number;
  distance: number;
  arcAngle: number;
  manualPositions: Record<string, { x: number; y: number }>;
  updatedBy?: string;
  updatedAt: number;
}

/** A pending (ringing) or active call between two users */
interface PendingCall {
  callId: string;
  callerId: string; // clerk_user_id of caller
  calleeId: string; // clerk_user_id of callee
  channelId: string; // DM channel ID
  voiceRoomId: string; // SFU room slug for media
  timeout: ReturnType<typeof setTimeout>;
  callerName: string;
  callerUsername?: string;
  callerDisplayName?: string | null;
  callerAvatar?: string;
  calleeName?: string;
  calleeUsername?: string;
  calleeDisplayName?: string | null;
  calleeAvatar?: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 15_000;
const PROFILE_REFRESH_COOLDOWN_MS = 10_000;
const ZOMBIE_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 3; // 45s — 3 missed heartbeats
const PRUNE_ALARM_INTERVAL_MS = 300_000; // 5 min safety-net — client zombie detection fires first
const CALL_RING_TIMEOUT_MS = 30_000; // auto-cancel after 30s
const RESUME_GRACE_PERIOD_MS = 120_000; // 2 min — keep session resumable after disconnect
const MAX_GATEWAY_FRAME_BYTES = 1_000_000;
const MAX_REPLAY_BUFFER_BYTES = 256_000;
const MAX_REPLAY_PERSIST_WRITES = 32;
const WS_RATE_LIMIT_WINDOW_MS = 60_000;
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
};

// ── MeetingRoom Durable Object ──────────────────────────────────────────────

export class MeetingRoom extends DurableObject<Env> {
  private sessions: Map<WebSocket, WsAttachment> = new Map();
  private _roomSlug: string = "unknown";
  private profileRefreshCooldowns: Map<string, number> = new Map();
  private profileRequestCoordinator = new ProfileRequestCoordinator();
  private profileIdentities: Map<string, ProfileIdentity> = new Map();
  private resumableSessions: Map<string, WsAttachment> = new Map();
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
  /** Voice channel presence: channelId → Map<clerkUserId, member info> */
  private voiceChannelMembers: Map<string, Map<string, VoiceChannelMember>> =
    new Map();
  /** Pending calls: calleeId → PendingCall (only one pending per callee) */
  private pendingCalls: Map<string, PendingCall> = new Map();
  /** Recently accepted calls (callId), acts as a TTL cache to prevent Op 33/Op 37 race conditions */
  private acceptedCalls: Set<string> = new Set();
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
  /** Debounced D1 presence writes: clerkId → latest status */
  private presenceD1Pending: Map<string, string> = new Map();
  /** Debounce timer handles for presence writes */
  private presenceD1Timers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();
  /** Dirty storage keys pending batch flush */
  private dirtyStorage: Map<string, unknown> = new Map();
  /** Per-channel voice member keys scheduled for deletion */
  private deletedVcKeys: Set<string> = new Set();

  constructor(
    public ctx: DurableObjectState,
    public env: Env,
  ) {
    super(ctx, env);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS realtime_ticket_nonces (
        nonce_digest TEXT PRIMARY KEY,
        access_mode TEXT NOT NULL,
        audience TEXT NOT NULL,
        room_slug TEXT NOT NULL,
        subject TEXT NOT NULL,
        connection_generation TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER NOT NULL
      );
    `);
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS idx_realtime_ticket_nonces_expires ON realtime_ticket_nonces(expires_at)",
    );
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS ws_rate_limits (
        rate_key TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL
      );
    `);

    // Cloudflare's auto-response absorbs messages at the edge, preventing the DO
    // from updating the `last_heartbeat` timestamp, which causes the zombie
    // pruning alarm to falsely evict active users after 5 minutes.

    // Restore sessions from hibernation-safe WebSocket attachments
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const attachment = ws.deserializeAttachment() as WsAttachment | null;
        if (attachment?.id) {
          const { replay_buffer: _legacyReplay, ...liveAttachment } =
            attachment;
          this.sessions.set(ws, liveAttachment);

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
          if (this.isResumableSnapshot(stored)) {
            const { replay_buffer: _legacyReplay, ...attachment } =
              stored.attachment;
            this.resumableSessions.set(id, attachment);
            this.replayBuffers.set(id, this.trimReplayBuffer(stored.replay));
            this.replayPersistWrites.set(
              id,
              this.normalizeReplayPersistWrites(stored.persist_writes),
            );
          } else if (
            this.isPlainObject(stored) &&
            typeof stored.id === "string"
          ) {
            const storedAttachment = stored as unknown as WsAttachment;
            const { replay_buffer: _legacyReplay, ...attachment } =
              storedAttachment;
            this.resumableSessions.set(id, attachment);
            this.replayBuffers.set(
              id,
              this.trimReplayBuffer(storedAttachment.replay_buffer ?? []),
            );
            this.replayPersistWrites.set(id, MAX_REPLAY_PERSIST_WRITES);
          }
        }
      }

      // Restore voice channel members from per-channel keys (vc:members:*)
      const vcEntries = await this.ctx.storage.list({ prefix: "vc:members:" });
      for (const [key, value] of vcEntries) {
        const channelId = key.slice("vc:members:".length);
        const memberList = value as VoiceChannelMember[];
        const memberMap = new Map<string, VoiceChannelMember>();
        for (const m of memberList) {
          memberMap.set(m.clerk_user_id, m);
        }
        if (memberMap.size > 0) {
          this.voiceChannelMembers.set(channelId, memberMap);
        }
      }

      // One-time migration: move old single-key format to per-channel keys
      if (vcEntries.size === 0) {
        const oldStored = (await this.ctx.storage.get(
          "voiceChannelMembers",
        )) as Record<string, VoiceChannelMember[]> | undefined;
        if (oldStored) {
          const migrationBatch: Record<string, VoiceChannelMember[]> = {};
          for (const channelId of Object.keys(oldStored)) {
            const memberList = oldStored[channelId] as VoiceChannelMember[];
            const memberMap = new Map<string, VoiceChannelMember>();
            for (const m of memberList) {
              memberMap.set(m.clerk_user_id, m);
            }
            if (memberMap.size > 0) {
              this.voiceChannelMembers.set(channelId, memberMap);
              migrationBatch[`vc:members:${channelId}`] = memberList;
            }
          }
          if (Object.keys(migrationBatch).length > 0) {
            await this.ctx.storage.put(migrationBatch);
          }
          await this.ctx.storage.delete("voiceChannelMembers");
          log.info(
            `Migrated voiceChannelMembers to per-channel keys (${Object.keys(migrationBatch).length} channels)`,
          );
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

      // Restore resumable session expiry map
      const storedExpiry = (await this.ctx.storage.get(
        "resumableSessionExpiry",
      )) as Record<string, number> | undefined;
      if (storedExpiry) {
        for (const [id, ts] of Object.entries(storedExpiry)) {
          this.resumableSessionExpiry.set(id, ts);
        }
      }

      // Sync voice_channel_id on sessions from the stored voice members
      for (const [ws, session] of this.sessions) {
        await this.restoreSessionSubscriptions(ws, session);
      }

      for (const [, session] of this.sessions) {
        if (session.clerk_user_id) {
          for (const [channelId, members] of this.voiceChannelMembers) {
            if (members.has(session.clerk_user_id)) {
              session.voice_channel_id = channelId;
              break;
            }
          }
        }
      }

      // Reconcile: remove voice members that have no live session
      this.reconcileVoiceMembers();

      if (this.sessions.size > 0 || this.resumableSessionExpiry.size > 0) {
        this.scheduleAlarm();
      }
    });

    // Schedule prune alarm if there are live sessions
    if (this.sessions.size > 0) {
      this.scheduleAlarm();
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const gatewayVersion = parseInt(url.searchParams.get("v") ?? "1", 10);

    if (
      url.pathname === "/consume-realtime-admission" &&
      request.method === "POST"
    ) {
      return this.consumeRealtimeAdmission(request);
    }

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
      const admission = getRealtimeAdmissionFromHeaders(request.headers);
      const expectedAudience =
        url.pathname === "/api/gateway" ? "global" : "room";
      if (
        !admission ||
        admission.audience !== expectedAudience ||
        admission.roomSlug !== this.roomSlug
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({
        admission: {
          accessMode: admission.accessMode,
          connectionGeneration: admission.connectionGeneration,
          subject: admission.subject,
        },
      });

      log.info(`New connection, gateway_version=${gatewayVersion}`);

      this.sendTo(server, {
        op: Op.Hello,
        d: {
          heartbeat_interval: HEARTBEAT_INTERVAL_MS,
          gateway_version: gatewayVersion,
        },
      });

      return new Response(null, {
        status: 101,
        headers: { "Sec-WebSocket-Protocol": "ralph.realtime.v1" },
        webSocket: client,
      });
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

        for (const attachment of this.sessions.values()) {
          if (attachment.clerk_user_id !== userId) continue;
          if (requireChannelMatch && attachment.voice_channel_id !== channelId)
            continue;

          userMatchedScope = true;
          if (sessionId && attachment.id === sessionId) {
            exactSessionMatched = true;
            break;
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

  private consumeRealtimeAdmission(request: Request): Response {
    const admission = getRealtimeAdmissionFromHeaders(request.headers);
    if (!admission) {
      return Response.json(
        { ok: false, reason: "missing_admission" },
        { status: 401 },
      );
    }
    if (this.roomSlug === "unknown") {
      this.roomSlug = admission.roomSlug;
      this.ctx.storage.put("roomSlug", this.roomSlug).catch(() => {});
    }
    if (admission.roomSlug !== this.roomSlug) {
      return Response.json(
        { ok: false, reason: "room_mismatch" },
        { status: 401 },
      );
    }
    if (
      admission.audience !== "room" &&
      admission.audience !== "voice" &&
      admission.audience !== "global"
    ) {
      return Response.json(
        { ok: false, reason: "audience_mismatch" },
        { status: 401 },
      );
    }
    if (Date.now() >= admission.expiresAt) {
      return Response.json({ ok: false, reason: "expired" }, { status: 401 });
    }

    try {
      this.ctx.storage.sql.exec(
        `DELETE FROM realtime_ticket_nonces WHERE expires_at <= ?`,
        Date.now(),
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO realtime_ticket_nonces (
          nonce_digest,
          access_mode,
          audience,
          room_slug,
          subject,
          connection_generation,
          expires_at,
          consumed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        admission.nonceDigest,
        admission.accessMode,
        admission.audience,
        admission.roomSlug,
        admission.subject,
        admission.connectionGeneration,
        admission.expiresAt,
        Date.now(),
      );

      return Response.json({ ok: true });
    } catch {
      return Response.json({ ok: false, reason: "replayed" }, { status: 401 });
    }
  }

  async webSocketMessage(ws: WebSocket, rawMsg: string | ArrayBuffer) {
    if (typeof rawMsg !== "string") {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4000, message: "Text websocket frames are required" },
      });
      return;
    }
    if (rawMsg.length > MAX_GATEWAY_FRAME_BYTES) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4000, message: "Websocket frame is too large" },
      });
      return;
    }
    if (this.env.DEBUG)
      log.info(`webSocketMessage received: ${rawMsg.substring(0, 100)}`);

    let msg: GatewayMessage;
    try {
      const parsed: unknown = JSON.parse(rawMsg);
      if (!this.isPlainObject(parsed)) {
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: CloseCode.UnknownOpcode, message: "Missing opcode" },
        });
        return;
      }
      msg = parsed as unknown as GatewayMessage;
    } catch {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4002, message: "Invalid JSON" },
      });
      return;
    }

    if (typeof msg.op !== "number") {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.UnknownOpcode, message: "Missing opcode" },
      });
      return;
    }

    if (
      this.getSessionAdmission(ws)?.accessMode === "public-demo" &&
      !this.isAllowedPublicDemoOpcode(msg.op)
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

    if (this.isRateLimited(ws, msg.op)) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4290, message: "Operation rate limit exceeded" },
      });
      return;
    }

    const invalidPayloadMessage: Record<number, string> = {
      [Op.Identify]: "Invalid identify payload",
      [Op.VoiceStateUpdate]: "Invalid voice state payload",
      [Op.MessageCreate]: "Invalid message payload",
      [Op.MessageUpdate]: "Invalid message payload",
      [Op.MessageDelete]: "Invalid message payload",
      [Op.TypingStart]: "Invalid typing payload",
      [Op.ReactionAdd]: "Invalid reaction payload",
      [Op.ReactionRemove]: "Invalid reaction payload",
      [Op.ChannelSubscribe]: "Invalid channel payload",
      [Op.ChannelUnsubscribe]: "Invalid channel payload",
      [Op.PresenceUpdate]: "Invalid presence payload",
      [Op.VoiceChannelJoin]: "Invalid voice channel payload",
      [Op.ServerSubscribe]: "Invalid server payload",
    };
    if (invalidPayloadMessage[msg.op] && !this.isPlainObject(msg.d)) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4000, message: invalidPayloadMessage[msg.op] },
      });
      return;
    }

    switch (msg.op) {
      case Op.Identify:
        await this.handleIdentify(ws, msg.d);
        break;

      case Op.Heartbeat:
        this.handleHeartbeat(ws, msg.d);
        break;

      case Op.Resume:
        if (
          !this.isPlainObject(msg.d) ||
          typeof msg.d.session_id !== "string" ||
          typeof msg.d.seq_ack !== "number"
        ) {
          this.sendTo(ws, {
            op: Op.Error,
            d: { code: 4000, message: "Invalid resume payload" },
          });
          break;
        }
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
        await this.handleVoiceChannelJoin(ws, msg.d);
        break;

      case Op.VoiceChannelLeave:
        this.handleVoiceChannelLeave(ws);
        break;

      case Op.ServerSubscribe:
        await this.handleServerSubscribe(ws, msg.d);
        break;

      case Op.CallInitiate:
        if (
          !this.isPlainObject(msg.d) ||
          typeof msg.d.target_user_id !== "string" ||
          typeof msg.d.channel_id !== "string"
        ) {
          this.sendTo(ws, {
            op: Op.Error,
            d: { code: 4000, message: "Invalid call payload" },
          });
          break;
        }
        await this.handleCallInitiate(ws, msg.d);
        break;

      case Op.CallAccept:
        if (!this.isPlainObject(msg.d)) {
          this.sendTo(ws, {
            op: Op.Error,
            d: { code: 4000, message: "Invalid call payload" },
          });
          break;
        }
        this.handleCallAccept(ws, msg.d);
        break;

      case Op.CallDecline:
        if (!this.isPlainObject(msg.d)) {
          this.sendTo(ws, {
            op: Op.Error,
            d: { code: 4000, message: "Invalid call payload" },
          });
          break;
        }
        this.handleCallDecline(ws, msg.d);
        break;

      case Op.CallEnd:
        if (!this.isPlainObject(msg.d)) {
          this.sendTo(ws, {
            op: Op.Error,
            d: { code: 4000, message: "Invalid call payload" },
          });
          break;
        }
        this.handleCallEnd(ws, msg.d);
        break;

      default:
        this.sendTo(ws, {
          op: Op.Error,
          d: {
            code: CloseCode.UnknownOpcode,
            message: `Unknown opcode: ${msg.op}`,
          },
        });
    }

    // Flush any dirty storage keys accumulated during this message cycle
    this.flushDirtyStorage();
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    await this.handleLeave(ws, false, false);
    this.flushDirtyStorage();
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket) {
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
        let lastActivity = session.last_heartbeat ?? 0;

        if (lastActivity && now - lastActivity >= ZOMBIE_TIMEOUT_MS) {
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
          if (expiredSession) {
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

      // Reconcile voice members against live sessions
      this.reconcileVoiceMembers();

      // Flush any dirty storage accumulated during alarm processing
      this.flushDirtyStorage();
    } catch (e) {
      log.error(`alarm(): uncaught exception — state may be inconsistent:`, e);
    } finally {
      // ALWAYS reschedule if there are active sessions, even after an exception.
      // Without this, a transient error would stop zombie pruning permanently.
      if (this.sessions.size > 0 || this.resumableSessionExpiry.size > 0) {
        await this.scheduleAlarm(true);
      }
    }
  }

  private getNextAlarmTime(now: number) {
    const deadlines: number[] = [];

    for (const [, session] of this.sessions) {
      if (session.last_heartbeat)
        deadlines.push(session.last_heartbeat + ZOMBIE_TIMEOUT_MS);
    }
    for (const disconnectedAt of this.resumableSessionExpiry.values()) {
      deadlines.push(disconnectedAt + RESUME_GRACE_PERIOD_MS);
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

  // ── Batched storage writes ─────────────────────────────────────────────

  /** Mark a storage key as dirty — will be flushed in batch at end of message cycle */
  private markDirty(key: string, value: unknown) {
    this.dirtyStorage.set(key, value);
  }

  /** Flush all dirty storage keys in a single batch put */
  private flushDirtyStorage() {
    // Delete any per-channel voice member keys that were removed
    if (this.deletedVcKeys.size > 0) {
      const keys = [...this.deletedVcKeys];
      this.deletedVcKeys.clear();
      this.ctx.storage.delete(keys).catch(() => {});
    }
    if (this.dirtyStorage.size === 0) return;
    const entries = Object.fromEntries(this.dirtyStorage);
    this.dirtyStorage.clear();
    this.ctx.storage.put(entries).catch((error) => {
      log.error("Failed to flush Durable Object storage", error);
      if (!Object.prototype.hasOwnProperty.call(entries, "resumableSessions")) {
        return;
      }

      // Never keep serving a warm snapshot whose replay write failed. The
      // client will reconnect and reconcile message history from REST.
      this.resumableSessions.clear();
      this.replayBuffers.clear();
      this.replayPersistWrites.clear();
      this.resumableSessionExpiry.clear();
      this.ctx.storage
        .delete(["resumableSessions", "resumableSessionExpiry"])
        .catch((deleteError) => {
          log.error("Failed to clear stale resumable snapshots", deleteError);
        });
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private persist(ws: WebSocket, data: WsAttachment) {
    const wasEmpty = this.sessions.size === 0;
    const admission =
      data.admission ?? this.getSessionAdmission(ws) ?? undefined;
    const nextData = admission ? { ...data, admission } : data;
    const { replay_buffer: _legacyReplay, ...serializedData } = nextData;
    const serializedBytes = new TextEncoder().encode(
      JSON.stringify(serializedData),
    ).byteLength;
    const compactData: WsAttachment = {
      ...serializedData,
      stream_preview_url: null,
      avatar_url: null,
      avatar_display: null,
      username: undefined,
      display_name: null,
      tracks: [],
      subscribed_channels: serializedData.subscribed_channels.slice(-32),
      subscribed_servers: serializedData.subscribed_servers.slice(-32),
      name: serializedData.name.slice(0, 256),
    };
    try {
      ws.serializeAttachment(
        serializedBytes > MAX_WEBSOCKET_ATTACHMENT_BYTES
          ? compactData
          : serializedData,
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
    this.sessions.set(ws, serializedData);
    if (wasEmpty) this.scheduleAlarm();
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
    const limit = WS_RATE_LIMITS[op];
    if (!limit) return false;

    const session = this.getSession(ws);
    const subject =
      session?.clerk_user_id ?? this.getSessionAdmission(ws)?.subject;
    const keys = [
      `session:${session?.id ?? "unidentified"}:${op}`,
      ...(subject ? [`subject:${subject}:${op}`] : []),
    ];
    const now = Date.now();
    let limited = false;

    for (const key of keys) {
      const rows = [
        ...this.ctx.storage.sql.exec(
          "SELECT window_start, count FROM ws_rate_limits WHERE rate_key = ?",
          key,
        ),
      ];
      const existing = rows[0];
      if (
        !existing ||
        now - Number(existing.window_start) >= WS_RATE_LIMIT_WINDOW_MS
      ) {
        this.ctx.storage.sql.exec(
          `INSERT INTO ws_rate_limits (rate_key, window_start, count)
           VALUES (?, ?, 1)
           ON CONFLICT(rate_key) DO UPDATE SET window_start = excluded.window_start, count = 1`,
          key,
          now,
        );
        continue;
      }
      const count = Number(existing.count) + 1;
      this.ctx.storage.sql.exec(
        "UPDATE ws_rate_limits SET count = ? WHERE rate_key = ?",
        count,
        key,
      );
      if (count > limit) limited = true;
    }
    this.ctx.storage.sql.exec(
      "DELETE FROM ws_rate_limits WHERE window_start < ?",
      now - WS_RATE_LIMIT_WINDOW_MS,
    );
    return limited;
  }

  private getPresencePlatformsForUser(
    clerkUserId: string,
    options?: { excludeWs?: WebSocket },
  ): PresencePlatform[] {
    const orderedPlatforms: PresencePlatform[] = [];
    const seen = new Set<PresencePlatform>();

    for (const [sessionWs, session] of this.sessions) {
      if (options?.excludeWs && sessionWs === options.excludeWs) continue;
      if (session.clerk_user_id !== clerkUserId) continue;
      const platform = normalizePresencePlatform(session.platform);
      if (!platform || seen.has(platform)) continue;
      seen.add(platform);
      orderedPlatforms.push(platform);
    }

    return orderedPlatforms;
  }

  private getPresenceStatusForUser(
    clerkUserId: string,
    options?: { excludeWs?: WebSocket },
  ): "online" | "idle" | "dnd" | "offline" {
    for (const [sessionWs, session] of this.sessions) {
      if (options?.excludeWs && sessionWs === options.excludeWs) continue;
      if (session.clerk_user_id !== clerkUserId) continue;
      if (session.status) {
        return session.status;
      }
    }
    return "offline";
  }

  private buildPresenceSnapshotForUser(
    clerkUserId: string,
    options?: { excludeWs?: WebSocket },
  ) {
    return {
      user_id: clerkUserId,
      status: this.getPresenceStatusForUser(clerkUserId, options),
      platforms: this.getPresencePlatformsForUser(clerkUserId, options),
    };
  }

  private buildPresenceListPayload() {
    const userIds = new Set<string>();

    for (const [, session] of this.sessions) {
      if (session.clerk_user_id) {
        userIds.add(session.clerk_user_id);
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
    if (!session?.clerk_user_id) return;

    const data = this.buildVoiceChannelStatesPayload();
    const visibleChannelIds = new Set<string>();

    for (const channelId of Object.keys(data.voice_states)) {
      if (
        await this.canUserAccessVoiceChannel(channelId, session.clerk_user_id)
      ) {
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
      if (ws === excludeWs || !session.clerk_user_id) continue;
      if (
        !(await this.canUserAccessVoiceChannel(
          channelId,
          session.clerk_user_id,
        ))
      )
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

  private ensureVoiceChannelMembers(channelId: string, startedAt = Date.now()) {
    let members = this.voiceChannelMembers.get(channelId);
    if (!members) {
      members = new Map();
      this.voiceChannelMembers.set(channelId, members);
      this.voiceChannelStartedAt.set(channelId, startedAt);
      this.persistVoiceChannelStartedAt();
    }
    return members;
  }

  private markVoiceMemberConnected(
    channelId: string,
    session: WsAttachment,
    joinedAt?: number,
  ) {
    if (!session.clerk_user_id) return;

    const members = this.ensureVoiceChannelMembers(
      channelId,
      joinedAt ?? Date.now(),
    );
    const existing = members.get(session.clerk_user_id);
    const canonicalIdentity = existing
      ? {
          name: existing.name,
          username: existing.username,
          display_name: existing.display_name ?? null,
          avatar_url: existing.avatar_url ?? null,
          avatar_display: existing.avatar_display ?? null,
        }
      : this.getCanonicalProfileIdentity(session.clerk_user_id);
    if (canonicalIdentity)
      this.setSessionProfileIdentity(session, canonicalIdentity);
    members.set(session.clerk_user_id, {
      ...existing,
      clerk_user_id: session.clerk_user_id,
      name: session.name,
      username: session.username,
      display_name: session.display_name,
      avatar_url: session.avatar_url,
      avatar_display: session.avatar_display,
      stream_preview_url: session.stream_preview_url,
      connected: true,
      connection_state: "connected",
      disconnected_at: null,
      reconnect_expires_at: null,
      self_mute: session.self_mute,
      self_deaf: session.self_deaf,
      self_video: session.self_video,
      self_stream: session.self_stream,
      self_stream_audio: session.self_stream_audio,
      spatial_audio_enabled: session.spatial_audio_enabled,
      spatial_audio_high_fidelity: session.spatial_audio_high_fidelity,
      joined_at:
        existing?.joined_at ??
        joinedAt ??
        this.voiceChannelStartedAt.get(channelId) ??
        Date.now(),
    });
    this.persistVoiceChannelMembers();
  }

  private markVoiceMemberReconnecting(
    session: WsAttachment,
    disconnectedAt: number,
    excludeWs?: WebSocket,
  ) {
    if (!session.voice_channel_id || !session.clerk_user_id) return;

    const members = this.ensureVoiceChannelMembers(session.voice_channel_id);
    const existing = members.get(session.clerk_user_id);
    const canonicalIdentity = existing
      ? {
          name: existing.name,
          username: existing.username,
          display_name: existing.display_name ?? null,
          avatar_url: existing.avatar_url ?? null,
          avatar_display: existing.avatar_display ?? null,
        }
      : this.getCanonicalProfileIdentity(session.clerk_user_id);
    if (canonicalIdentity)
      this.setSessionProfileIdentity(session, canonicalIdentity);
    members.set(session.clerk_user_id, {
      ...existing,
      clerk_user_id: session.clerk_user_id,
      name: existing ? existing.name : session.name,
      username: existing ? existing.username : session.username,
      display_name: existing ? existing.display_name : session.display_name,
      avatar_url: existing ? existing.avatar_url : session.avatar_url,
      avatar_display: existing
        ? existing.avatar_display
        : session.avatar_display,
      stream_preview_url: session.stream_preview_url,
      connected: false,
      connection_state: "reconnecting",
      disconnected_at: disconnectedAt,
      reconnect_expires_at: disconnectedAt + RESUME_GRACE_PERIOD_MS,
      self_mute: session.self_mute,
      self_deaf: session.self_deaf,
      self_video: session.self_video,
      self_stream: session.self_stream,
      self_stream_audio: session.self_stream_audio,
      spatial_audio_enabled: session.spatial_audio_enabled,
      spatial_audio_high_fidelity: session.spatial_audio_high_fidelity,
      joined_at:
        existing?.joined_at ??
        this.voiceChannelStartedAt.get(session.voice_channel_id) ??
        disconnectedAt,
    });
    this.persistVoiceChannelMembers();
    this.ctx.waitUntil(
      this.broadcastVoiceChannelState(session.voice_channel_id, excludeWs),
    );
  }

  /** Remove voice channel members that don't have a live or resumable session */
  private reconcileVoiceMembers() {
    const now = Date.now();
    // Build a set of clerk_user_ids that have active sessions OR resumable sessions
    // (pending reconnect within grace period). This prevents premature cleanup
    // of voice members who are just reconnecting their WebSocket.
    const activeClerkIds = new Set<string>();
    for (const [, session] of this.sessions) {
      if (session.clerk_user_id) {
        activeClerkIds.add(session.clerk_user_id);
      }
    }
    // Also include resumable sessions (disconnected but within grace period)
    for (const [sessionId, disconnectedAt] of this.resumableSessionExpiry) {
      if (now - disconnectedAt >= RESUME_GRACE_PERIOD_MS) continue;
      const resumable = this.resumableSessions.get(sessionId);
      if (resumable?.clerk_user_id) {
        activeClerkIds.add(resumable.clerk_user_id);
      }
    }

    let changed = false;
    const changedChannelIds = new Set<string>();
    for (const [channelId, members] of this.voiceChannelMembers) {
      for (const [clerkId] of members) {
        if (!activeClerkIds.has(clerkId)) {
          members.delete(clerkId);
          changed = true;
          changedChannelIds.add(channelId);
          log.info(
            `Reconcile: removed stale voice member ${clerkId} from channel ${channelId}`,
          );
        }
      }
      if (members.size === 0) {
        this.voiceChannelMembers.delete(channelId);
        this.deleteVoiceChannelStorage(channelId);
        this.voiceChannelStartedAt.delete(channelId);
        this.persistVoiceChannelStartedAt();
        changed = true;
        changedChannelIds.add(channelId);
      }
    }

    if (changed) {
      this.persistVoiceChannelMembers();
      for (const channelId of changedChannelIds) {
        this.ctx.waitUntil(this.broadcastVoiceChannelState(channelId));
      }
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
      clerk_user_id: data.clerk_user_id,
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

  private buildVoiceStateDelta(data: WsAttachment): VoiceStateDelta {
    return {
      id: data.id,
      clerk_user_id: data.clerk_user_id,
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
      push_session_id: undefined,
      pull_session_id: undefined,
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
      if (!session || session.clerk_user_id !== userId) return false;
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
    if (!resumable || resumable.clerk_user_id !== userId) {
      return false;
    }

    if (
      channelId &&
      resumable.voice_channel_id &&
      resumable.voice_channel_id !== channelId
    ) {
      return false;
    }

    if (resumable.voice_channel_id) {
      this.removeFromVoiceChannel(resumable);
      delete resumable.voice_channel_id;
    }

    if (resumable.clerk_user_id) {
      this.cleanupCallsForUser(resumable.clerk_user_id, "disconnected");
    }

    this.resumableSessions.delete(sessionId);
    this.replayBuffers.delete(sessionId);
    this.persistResumableSessions();
    this.resumableSessionExpiry.delete(sessionId);
    this.persistResumableSessionExpiry();

    this.broadcast({
      op: Op.VoiceStateUpdate,
      d: {
        participant: this.buildVoiceState(resumable),
        action: "leave",
      },
    });

    return true;
  }

  // ── Voice token generation ─────────────────────────────────────────────
  // HMAC-signed token: "payload.signature" where payload = "participant_id:room_slug:timestamp"

  private async generateVoiceToken(
    participantId: string,
    clerkUserId?: string,
  ): Promise<string> {
    try {
      if (!this.env.CALLS_APP_SECRET) {
        meetingLog.warn("CALLS_APP_SECRET not set, skipping voice token");
        return "";
      }
      return await issueVoiceToken({
        participantId,
        roomSlug: this.roomSlug ?? "unknown",
        subject: clerkUserId,
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
      const { replay_buffer: _legacyReplay, ...snapshotAttachment } =
        attachment;
      serialized[id] = {
        attachment: snapshotAttachment,
        replay: this.replayBuffers.get(id) ?? [],
        persist_writes: this.replayPersistWrites.get(id) ?? 0,
      };
    }
    this.markDirty("resumableSessions", serialized);
  }

  private isResumableSnapshot(
    value: unknown,
  ): value is ResumableSessionSnapshot {
    if (!this.isPlainObject(value)) return false;
    const attachment = value.attachment;
    const replay = value.replay;
    return (
      this.isPlainObject(attachment) &&
      typeof attachment.id === "string" &&
      Array.isArray(replay)
    );
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
      if (session.clerk_user_id !== userId) continue;
      return {
        name: session.name,
        username: session.username,
        display_name: session.display_name ?? null,
        avatar_url: session.avatar_url ?? null,
        avatar_display: session.avatar_display ?? null,
      };
    }

    for (const session of this.resumableSessions.values()) {
      if (session.clerk_user_id !== userId) continue;
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

  private async updateProfileIdentity(
    userId: string,
    identity: ProfileIdentity,
  ) {
    this.profileIdentities.set(userId, { ...identity });

    const liveSessions: WsAttachment[] = [];
    for (const [sessionWs, session] of this.sessions) {
      if (session.clerk_user_id !== userId) continue;
      this.setSessionProfileIdentity(session, identity);
      this.persist(sessionWs, session);
      liveSessions.push(session);
    }

    let updatedResumableSession = false;
    for (const session of this.resumableSessions.values()) {
      if (session.clerk_user_id !== userId) continue;
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
    d: {
      name: string;
      username?: string;
      display_name?: string | null;
      avatar_url?: string | null;
      avatar_display?: string | null;
      clerk_user_id?: string;
      platform?: PresencePlatform;
      supports_voice_state_deltas?: boolean;
    },
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
      const participantId = crypto.randomUUID();
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
        admittedUserId ? this.fetchClerkProfile(admittedUserId) : null,
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

      // Resolve actual profile from Clerk if possible
      let resolvedName = d.name;
      let resolvedUsername = d.username ?? d.name;
      let resolvedDisplayName = d.display_name ?? null;
      let resolvedAvatar: string | null | undefined = d.avatar_url;
      let resolvedAvatarDisplay = d.avatar_display ?? null;
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
      }

      // Build roster
      const participants: VoiceState[] = [];
      for (const [, data] of this.sessions) {
        participants.push(this.buildVoiceState(data));
      }

      const attachment: WsAttachment = {
        admission,
        id: participantId,
        ...identity,
        platform: resolvedPlatform,
        clerk_user_id: admittedUserId,
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
        last_heartbeat: Date.now(),
        seq: 0,
        outbound_seq: 0,
        subscribed_channels: [],
        subscribed_servers: [],
      };

      this.persist(ws, attachment);

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

      // Op 15: VoiceStateUpdate (join) to everyone else
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

      // Broadcast PRESENCE_UPDATE (online) to all clients if this user has a clerk_user_id
      if (attachment.clerk_user_id) {
        const presenceSnapshot = this.buildPresenceSnapshotForUser(
          attachment.clerk_user_id,
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

        // Resume Pending Ringing upon Identify
        const userId = attachment.clerk_user_id;

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
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: 4000,
          message: `Identify failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        },
      });
    }
  }

  // ── Op 3: Heartbeat ────────────────────────────────────────────────────

  private handleHeartbeat(ws: WebSocket, d: { seq_ack: number }) {
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

  private async handleResume(
    ws: WebSocket,
    d: { session_id: string; seq_ack: number },
  ) {
    const oldAttachment = this.resumableSessions.get(d.session_id);
    const admission = this.getSessionAdmission(ws);
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

    const buffer =
      this.replayBuffers.get(d.session_id) ?? oldAttachment.replay_buffer ?? [];
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

      await this.restoreSessionSubscriptions(ws, resumedAttachment);

      // Re-add to voice channel members if the session was in a VC.
      // During handleLeave, we now defer voice channel cleanup for resumable
      // sessions — but if reconcileVoiceMembers() ran during the disconnect
      // window (or a future code path removed them), re-ensure membership.
      if (
        resumedAttachment.voice_channel_id &&
        resumedAttachment.clerk_user_id
      ) {
        this.markVoiceMemberConnected(
          resumedAttachment.voice_channel_id,
          resumedAttachment,
        );
        this.persist(ws, resumedAttachment);
        await this.broadcastVoiceChannelState(
          resumedAttachment.voice_channel_id,
        );
      }

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

      const participants: VoiceState[] = [];
      for (const [, data] of this.sessions) {
        participants.push(this.buildVoiceState(data));
      }

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

    const participants: VoiceState[] = [];
    for (const [, data] of this.sessions) {
      participants.push(this.buildVoiceState(data));
    }

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
    d: {
      self_mute?: boolean;
      self_deaf?: boolean;
      self_video?: boolean;
      self_stream?: boolean;
      self_stream_audio?: boolean;
      stream_preview_url?: string | null;
      spatial_audio_enabled?: boolean;
      spatial_audio_high_fidelity?: boolean;
      spatial_audio_state?: SpatialAudioState;
    },
  ) {
    const session = this.requireSession(ws);
    if (!session) return;

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
        d: { code: 4000, message: "Stream preview URL is too long" },
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
    const spatialRoomKey = session.voice_channel_id || this.roomSlug;
    if (d.spatial_audio_state) {
      this.spatialAudioStates.set(spatialRoomKey, {
        ...d.spatial_audio_state,
        updatedBy: session.clerk_user_id || session.id,
        updatedAt: Date.now(),
      });
    }
    // Also update the voice channel sidebar state if user is in a VC
    if (session.voice_channel_id && session.clerk_user_id) {
      this.markVoiceMemberConnected(session.voice_channel_id, session);
    }
    this.persist(ws, session);

    this.broadcastVoiceStateUpdate(
      ws,
      session,
      this.spatialAudioStates.get(spatialRoomKey),
    );

    if (session.voice_channel_id && session.clerk_user_id) {
      this.ctx.waitUntil(
        this.broadcastVoiceChannelState(session.voice_channel_id),
      );
    }
  }

  // ── Op 26: PresenceUpdate (C→S) ──────────────────────────────────────────

  private handlePresenceUpdate(
    ws: WebSocket,
    d: { status: "online" | "idle" | "dnd" | "offline" },
  ) {
    const session = this.requireSession(ws);
    if (!session) return;

    if (!["online", "idle", "dnd", "offline"].includes(d.status)) return;

    if (session.clerk_user_id) {
      for (const [sessionWs, otherSession] of this.sessions) {
        if (otherSession.clerk_user_id !== session.clerk_user_id) continue;
        otherSession.status = d.status;
        this.persist(sessionWs, otherSession);
      }

      // 1. Debounced persist to D1 (coalesces rapid toggles into one write)
      this.debouncePersistPresence(session.clerk_user_id, d.status);

      // 3. Broadcast to all
      const presenceSnapshot = this.buildPresenceSnapshotForUser(
        session.clerk_user_id,
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

    session.status = d.status;
    this.persist(ws, session);
  }

  /** Debounce D1 presence writes — coalesces rapid status toggles into one write */
  private debouncePersistPresence(clerkId: string, status: string) {
    this.presenceD1Pending.set(clerkId, status);

    // Clear existing timer for this user
    const existing = this.presenceD1Timers.get(clerkId);
    if (existing) clearTimeout(existing);

    // Schedule flush after 2s — only the final status gets written
    const timer = setTimeout(() => {
      this.presenceD1Timers.delete(clerkId);
      const finalStatus = this.presenceD1Pending.get(clerkId);
      this.presenceD1Pending.delete(clerkId);
      if (!finalStatus) return;

      this.ctx.waitUntil(
        (async () => {
          try {
            await this.env.DB.prepare(
              "UPDATE users SET status = ?, updated_at = ? WHERE id = ?",
            )
              .bind(finalStatus, new Date().toISOString(), clerkId)
              .run();

            const { results } = await this.env.DB.prepare(
              "SELECT server_id FROM server_members WHERE user_id = ?",
            )
              .bind(clerkId)
              .all();

            if (results) {
              for (const row of results) {
                const serverId = row.server_id as string;
                const cacheKey = `v1:server:members:${serverId}`;
                this.env.CACHE.delete(cacheKey).catch(() => {});
              }
            }
          } catch (e) {
            presenceLog.error("D1 update failed:", e);
          }
        })(),
      );
    }, 2000);

    this.presenceD1Timers.set(clerkId, timer);
  }

  // ── Op 17: ProfileRefresh ──────────────────────────────────────────────

  private async handleProfileRefresh(ws: WebSocket) {
    const session = this.requireSession(ws);
    if (!session?.clerk_user_id) return;

    const now = Date.now();
    const lastRefresh = this.profileRefreshCooldowns.get(session.id) ?? 0;
    if (now - lastRefresh < PROFILE_REFRESH_COOLDOWN_MS) return;
    this.profileRefreshCooldowns.set(session.id, now);

    const profileRequest = this.profileRequestCoordinator.begin(
      session.clerk_user_id,
    );
    const verified = await this.fetchClerkProfile(session.clerk_user_id);
    if (!verified || this.getSession(ws) !== session) return;
    if (!this.profileRequestCoordinator.acceptSuccess(profileRequest)) return;

    const identity: ProfileIdentity = {
      name: verified.name,
      username: verified.username,
      display_name: verified.displayName ?? null,
      avatar_url: verified.avatarUrl ?? null,
      avatar_display: verified.avatarDisplay ?? null,
    };
    await this.updateProfileIdentity(session.clerk_user_id, identity);
  }

  // ── Leave / Disconnect ─────────────────────────────────────────────────

  private async handleLeave(
    ws: WebSocket,
    intentional: boolean = false,
    closeSocket: boolean = true,
  ) {
    const session = this.getSession(ws);
    if (!session) return;

    // Broadcast updated presence/platform state before cleanup
    if (session.clerk_user_id) {
      let nextSnapshot: {
        user_id: string;
        status: "online" | "idle" | "dnd" | "offline";
        platforms: PresencePlatform[];
      } | null = null;

      for (const [otherWs, otherSession] of this.sessions) {
        if (
          otherWs === ws ||
          otherSession.clerk_user_id !== session.clerk_user_id
        )
          continue;
        nextSnapshot = this.buildPresenceSnapshotForUser(
          session.clerk_user_id,
          { excludeWs: ws },
        );
        break;
      }

      this.broadcast(
        {
          op: Op.Dispatch,
          d: {
            event: "PRESENCE_UPDATE",
            data: nextSnapshot ?? {
              user_id: session.clerk_user_id,
              status: "offline",
              platforms: [],
            },
          },
        },
        ws,
      );
    }

    // For abrupt WebSocket closes (not intentional), defer voice channel cleanup
    // so the sidebar doesn't flash empty for other users during reconnect.
    // The alarm's reconcileVoiceMembers() will clean up if resume never happens.
    // For intentional disconnects (Op.ClientDisconnect), always clean up immediately.
    const now = Date.now();

    if (session.voice_channel_id) {
      if (intentional) {
        this.removeFromVoiceChannel(session);
        delete session.voice_channel_id;
      } else {
        this.markVoiceMemberReconnecting(session, now, ws);
      }
    }

    // Clean up calls — cancel pending or end active
    if (session.clerk_user_id) {
      this.cleanupCallsForUser(session.clerk_user_id, "disconnected");
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
      delete resumableAttachment.replay_buffer;
      this.resumableSessions.set(participantId, resumableAttachment);
      this.replayPersistWrites.set(participantId, 0);
      this.persistResumableSessions();
      this.persistResumableSessionExpiry();
      // Ensure the alarm keeps running to prune expired resumable sessions
      this.scheduleAlarm();
    } else {
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
    // and the sidebar (still shows user present). The alarm's reconcileVoiceMembers
    // will clean up and broadcast leave if the resume never happens.
    if (intentional) {
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

  // ── Clerk profile verification ─────────────────────────────────────────

  private async fetchClerkProfile(clerkUserId: string): Promise<{
    name: string;
    username?: string;
    displayName?: string | null;
    avatarUrl?: string;
    avatarDisplay?: string | null;
  } | null> {
    try {
      return await resolveMeetingProfile({
        db: this.env.DB,
        cache: this.env.CACHE,
        clerkSecret: this.env.CLERK_SECRET_KEY,
        fetch,
        log: meetingLog,
        userId: clerkUserId,
      });
    } catch (err) {
      meetingLog.error("Failed to fetch Clerk profile:", err);
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
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closed */
    }
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
    const replayScope =
      scope ??
      (this.getDispatchChannelId(msg)
        ? { kind: "channel", channelId: this.getDispatchChannelId(msg) }
        : { kind: "global" });
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
      if (session.clerk_user_id) {
        candidates.push({ ws, session, userId: session.clerk_user_id });
      }
    }
    for (const [ws, session] of this.sessions) {
      if (ws === excludeWs || !this.resumingSockets.has(ws)) continue;
      if (
        session.subscribed_channels.includes(channelId) &&
        session.clerk_user_id &&
        !candidates.some((candidate) => candidate.ws === ws)
      ) {
        candidates.push({ ws, session, userId: session.clerk_user_id });
      }
    }
    const liveSessionIds = new Set(
      candidates.map((candidate) => candidate.session.id),
    );
    for (const [sessionId, session] of this.resumableSessions) {
      if (
        liveSessionIds.has(sessionId) ||
        !session.subscribed_channels.includes(channelId) ||
        !session.clerk_user_id
      )
        continue;
      candidates.push({ session, userId: session.clerk_user_id });
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
      if (!session.clerk_user_id) {
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
        !session.clerk_user_id ||
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
        if (session?.clerk_user_id) candidates.push({ ws, session });
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
        !session.clerk_user_id
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
      ...new Set(candidates.map((c) => c.session.clerk_user_id as string)),
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
      if (!members.has(session.clerk_user_id as string)) {
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
        (!channelDecisions.get(session.clerk_user_id as string) ||
          channelDecisions.get(session.clerk_user_id as string)?.kind !==
            "allowed")
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
    if (!session.clerk_user_id || entry.scope.kind === "global") return true;

    try {
      if (entry.scope.kind === "channel") {
        const access = await resolveChannelAccess(
          this.env.DB,
          session.clerk_user_id,
          entry.scope.channelId,
        );
        return Boolean(
          access && hasChannelPermission(access, PERMISSIONS.VIEW_CHANNELS),
        );
      }

      const membership = await this.env.DB.prepare(
        "SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
      )
        .bind(entry.scope.serverId, session.clerk_user_id)
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
      if (session.clerk_user_id === userId) {
        liveSessionIds.add(session.id);
        this.sendReplayable(ws, session, msg);
        count++;
      }
    }
    for (const [sessionId, session] of this.resumableSessions) {
      if (liveSessionIds.has(sessionId) || session.clerk_user_id !== userId)
        continue;
      this.queueResumable(session, msg);
    }
    log.info(`broadcastToUser ${userId}: sent to ${count} sessions`);
  }

  // ── Op 27: ChannelSubscribe ───────────────────────────────────────────

  private async handleChannelSubscribe(
    ws: WebSocket,
    d: { channel_id: string },
  ) {
    const session = this.requireSession(ws);
    if (
      !session ||
      !d ||
      typeof d.channel_id !== "string" ||
      !d.channel_id ||
      !session.clerk_user_id
    )
      return;

    const access = await resolveChannelAccess(
      this.env.DB,
      session.clerk_user_id,
      d.channel_id,
    );
    if (!access || !hasChannelPermission(access, PERMISSIONS.VIEW_CHANNELS)) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4003, message: "Channel not found or access denied" },
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

  private handleChannelUnsubscribe(ws: WebSocket, d: { channel_id: string }) {
    const session = this.requireSession(ws);
    if (!session || !d || typeof d.channel_id !== "string" || !d.channel_id)
      return;

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

  private async restoreSessionSubscriptions(
    ws: WebSocket,
    session: WsAttachment,
  ) {
    this.cleanupChannelSubscriptions(ws);
    this.cleanupServerSubscriptions(ws);

    const validChannels: string[] = [];
    if (session.clerk_user_id) {
      for (const channelId of session.subscribed_channels ?? []) {
        const access = await resolveChannelAccess(
          this.env.DB,
          session.clerk_user_id,
          channelId,
        );
        if (!access || !hasChannelPermission(access, PERMISSIONS.VIEW_CHANNELS))
          continue;
        validChannels.push(channelId);
        let subscribers = this.channelSubscriptions.get(channelId);
        if (!subscribers) {
          subscribers = new Set();
          this.channelSubscriptions.set(channelId, subscribers);
        }
        subscribers.add(ws);
      }
    }

    const validServers: string[] = [];
    if (session.clerk_user_id) {
      for (const serverId of session.subscribed_servers ?? []) {
        const member = await this.env.DB.prepare(
          "SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
        )
          .bind(serverId, session.clerk_user_id)
          .first()
          .catch(() => null);
        if (!member) continue;
        validServers.push(serverId);
        let subscribers = this.serverSubscriptions.get(serverId);
        if (!subscribers) {
          subscribers = new Set();
          this.serverSubscriptions.set(serverId, subscribers);
        }
        subscribers.add(ws);
      }
    }

    session.subscribed_channels = validChannels;
    session.subscribed_servers = validServers;
    this.persist(ws, session);
  }

  // ── Op 33: VoiceChannelJoin ────────────────────────────────────────────

  private normalizeVoiceChannelStartedAt(
    startedAt: unknown,
  ): number | undefined {
    if (typeof startedAt !== "number" || !Number.isFinite(startedAt))
      return undefined;
    const now = Date.now();
    const maxRestoreAgeMs = 7 * 24 * 60 * 60 * 1000;
    if (startedAt < now - maxRestoreAgeMs || startedAt > now + 60_000)
      return undefined;
    return startedAt;
  }

  private async handleVoiceChannelJoin(
    ws: WebSocket,
    d: { channel_id: string; self_mute?: boolean; started_at?: number },
  ) {
    const session = this.requireSession(ws);
    if (
      !session ||
      !d ||
      typeof d.channel_id !== "string" ||
      !d.channel_id ||
      !session.clerk_user_id
    )
      return;

    const access = await resolveChannelAccess(
      this.env.DB,
      session.clerk_user_id,
      d.channel_id,
    );
    if (!access || !hasChannelPermission(access, PERMISSIONS.CONNECT)) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4003, message: "Channel not found or access denied" },
      });
      return;
    }

    // Leave previous voice channel if switching to a different one.
    // If already in the same channel (e.g. server added us during handleCallInitiate
    // and now the SFU join fires sendVoiceChannelJoin for the same channel), just
    // update in-place without remove+re-add to avoid flicker.
    if (session.voice_channel_id && session.voice_channel_id !== d.channel_id) {
      this.removeFromVoiceChannel(session);
    } else if (session.voice_channel_id === d.channel_id) {
      // Already in this channel — just update self_mute and broadcast
      session.self_mute = d.self_mute ?? true;
      this.persist(ws, session);
      const members = this.voiceChannelMembers.get(d.channel_id);
      if (members?.has(session.clerk_user_id)) {
        const member = members.get(session.clerk_user_id)!;
        member.self_mute = session.self_mute;
        member.connected = true;
        member.connection_state = "connected";
        member.disconnected_at = null;
        member.reconnect_expires_at = null;
        const candidateStartedAt = this.normalizeVoiceChannelStartedAt(
          d.started_at,
        );
        if (candidateStartedAt) {
          member.joined_at = Math.min(
            member.joined_at ?? candidateStartedAt,
            candidateStartedAt,
          );
          const currentStartedAt = this.voiceChannelStartedAt.get(d.channel_id);
          if (!currentStartedAt || candidateStartedAt < currentStartedAt) {
            this.voiceChannelStartedAt.set(d.channel_id, candidateStartedAt);
            this.persistVoiceChannelStartedAt();
          }
        }
        this.ctx.waitUntil(this.broadcastVoiceChannelState(d.channel_id));
        this.persistVoiceChannelMembers();
      }
      return;
    }

    // Add to new voice channel
    session.voice_channel_id = d.channel_id;
    session.self_video = false;
    session.self_stream = false;
    session.stream_preview_url = null;
    this.persist(ws, session);

    let members = this.voiceChannelMembers.get(d.channel_id);
    if (!members) {
      members = new Map();
      this.voiceChannelMembers.set(d.channel_id, members);
      // First member — record channel start time
      const candidateStartedAt =
        this.normalizeVoiceChannelStartedAt(d.started_at) ?? Date.now();
      this.voiceChannelStartedAt.set(d.channel_id, candidateStartedAt);
      this.persistVoiceChannelStartedAt();
    }

    const joinedAt =
      this.normalizeVoiceChannelStartedAt(d.started_at) ??
      this.voiceChannelStartedAt.get(d.channel_id) ??
      Date.now();

    const member: VoiceChannelMember = {
      clerk_user_id: session.clerk_user_id,
      name: session.name,
      username: session.username,
      display_name: session.display_name,
      avatar_url: session.avatar_url,
      avatar_display: session.avatar_display,
      stream_preview_url: session.stream_preview_url,
      connected: true,
      connection_state: "connected",
      disconnected_at: null,
      reconnect_expires_at: null,
      self_mute: d.self_mute ?? true,
      self_deaf: session.self_deaf,
      self_video: session.self_video,
      self_stream: session.self_stream,
      self_stream_audio: session.self_stream_audio,
      joined_at: joinedAt,
    };
    members.set(session.clerk_user_id, member);

    // Broadcast to all clients
    this.ctx.waitUntil(
      this.broadcastVoiceChannelState(d.channel_id, undefined, true),
    );

    // Persist to storage for hibernation resilience
    this.persistVoiceChannelMembers();

    // --- IMPLICIT CALL ACCEPT ---
    // If the callee manually joins the voice channel instead of hitting "Accept",
    // we should treat the call as accepted and stop the ringing.
    const pending = this.pendingCalls.get(session.clerk_user_id);
    if (pending && pending.channelId === d.channel_id) {
      log.info(
        `${session.name} manually joined ringing DM, implicitly accepting call ${pending.callId}`,
      );

      const callIdToCache = pending.callId;
      clearTimeout(pending.timeout);
      this.pendingCalls.delete(session.clerk_user_id);

      // Cache the accepted call to avoid race conditions with a late Op 37 (CallAccept)
      this.acceptedCalls.add(callIdToCache);
      setTimeout(() => this.acceptedCalls.delete(callIdToCache), 10000);

      const evt = {
        op: Op.Dispatch,
        d: {
          event: "CALL_RING_STOP",
          data: { call_id: callIdToCache, reason: "accepted" },
        },
      };
      this.broadcastToUser(pending.callerId, evt);
      this.broadcastToUser(pending.calleeId, evt);
    }

    log.info(`${session.name} joined voice channel ${d.channel_id}`);
  }

  // ── Op 34: VoiceChannelLeave ───────────────────────────────────────────

  private handleVoiceChannelLeave(ws: WebSocket, d?: { channel_id?: string }) {
    const session = this.requireSession(ws);
    if (!session) return;

    // Protection against race conditions (e.g., leaving a previous channel after
    // already successfully connecting to a new one or initiating a call).
    if (
      d?.channel_id &&
      session.voice_channel_id &&
      session.voice_channel_id !== d.channel_id
    ) {
      log.info(
        `Ignored stale VoiceChannelLeave for ${d.channel_id}; currently in ${session.voice_channel_id}`,
      );
      return;
    }

    this.removeFromVoiceChannel(session);
    session.voice_channel_id = undefined;
    this.persist(ws, session);
  }

  /** Remove a user from their current voice channel and broadcast the update */
  private removeFromVoiceChannel(session: WsAttachment) {
    const channelId = session.voice_channel_id;
    if (!channelId || !session.clerk_user_id) return;

    const members = this.voiceChannelMembers.get(channelId);
    if (members) {
      members.delete(session.clerk_user_id);
      if (members.size === 0) {
        this.voiceChannelMembers.delete(channelId);
        this.deleteVoiceChannelStorage(channelId);
        // Channel is now empty — clear the started_at timestamp
        this.voiceChannelStartedAt.delete(channelId);
        this.persistVoiceChannelStartedAt();
      }
    }

    // Broadcast updated state (even if empty — so clients know the channel is empty)
    this.ctx.waitUntil(this.broadcastVoiceChannelState(channelId));

    if (members && members.size === 0) {
      // If the channel is fully empty, check if there's a pending call ringing
      // that we should also cancel (e.g., caller abandoned before answer)
      let abandonedPendingCall: PendingCall | null = null;
      for (const [calleeId, call] of this.pendingCalls) {
        if (call.channelId === channelId) {
          abandonedPendingCall = call;
          break;
        }
      }
      if (abandonedPendingCall) {
        log.info(
          `DM Call ${abandonedPendingCall.callId} emptied during ring, cancelling pending...`,
        );
        clearTimeout(abandonedPendingCall.timeout);
        this.pendingCalls.delete(abandonedPendingCall.calleeId);

        // Tell both parties the ring stopped
        const endMsg = {
          op: Op.Dispatch,
          d: {
            event: "CALL_RING_STOP",
            data: { call_id: abandonedPendingCall.callId, reason: "abandoned" },
          },
        };
        this.broadcastToUser(abandonedPendingCall.callerId, endMsg);
        this.broadcastToUser(abandonedPendingCall.calleeId, endMsg);
      }
    }

    // Persist to storage for hibernation resilience
    this.persistVoiceChannelMembers();

    log.info(`${session.name} left voice channel ${channelId}`);
  }

  private async handleMessageCreate(
    ws: WebSocket,
    d: {
      channel_id: string;
      content: string;
      reply_to_id?: string;
      nonce?: string;
    },
  ) {
    const session = this.requireSession(ws);
    if (
      !session?.clerk_user_id ||
      !d ||
      typeof d.channel_id !== "string" ||
      typeof d.content !== "string" ||
      !d.channel_id ||
      !d.content.trim() ||
      d.content.length > 4000 ||
      (d.reply_to_id !== undefined && typeof d.reply_to_id !== "string") ||
      (d.nonce !== undefined &&
        (typeof d.nonce !== "string" || d.nonce.length > 100))
    ) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4000, message: "Invalid message payload" },
      });
      return;
    }

    if (this.roomSlug !== "global-gateway") {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: 4000,
          message: "This gateway cannot create persisted channel messages",
        },
      });
      return;
    }

    const access = await resolveChannelAccess(
      this.env.DB,
      session.clerk_user_id,
      d.channel_id,
    );
    if (!access || !hasChannelPermission(access, PERMISSIONS.SEND_MESSAGES)) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4003, message: "Channel not found or access denied" },
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
      await this.env.DB.prepare(
        `INSERT INTO messages (id, channel_id, author_id, content, reply_to_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          messageId,
          d.channel_id,
          session.clerk_user_id,
          d.content.trim(),
          d.reply_to_id ?? null,
          now,
        )
        .run();
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
      author_id: session.clerk_user_id,
      author: {
        id: session.clerk_user_id,
        username: session.username ?? session.name,
        display_name: session.display_name ?? session.name,
        avatar_url: session.avatar_url,
        avatar_display: session.avatar_display,
      },
      content: d.content.trim(),
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
    if (access.serverId) {
      await this.broadcastToServerMembers(access.serverId, messageDispatch);
    } else {
      await this.broadcastToChannel(d.channel_id, messageDispatch);
    }

    // Asynchronously fetch embeds without blocking the initial send
    this.ctx.waitUntil(
      (async () => {
        const embeds = await extractAndProcessEmbeds(d.content.trim());
        if (embeds.length > 0) {
          try {
            // Store embeds in the database
            await this.env.DB.prepare(
              `UPDATE messages SET embeds = ? WHERE id = ?`,
            )
              .bind(JSON.stringify(embeds), messageId)
              .run();

            // Dispatch update event to clients
            const embedDispatch = {
              op: Op.Dispatch,
              d: {
                event: "MESSAGE_UPDATE",
                data: {
                  id: messageId,
                  channel_id: d.channel_id,
                  embeds: embeds,
                },
              },
            };
            if (access.serverId) {
              await this.broadcastToServerMembers(
                access.serverId,
                embedDispatch,
              );
            } else {
              await this.broadcastToChannel(d.channel_id, embedDispatch);
            }
          } catch (e) {
            log.error("Failed to update message with embeds:", e);
          }
        }
      })(),
    );
  }

  // ── Op 21: MessageUpdate ──────────────────────────────────────────────

  private async handleMessageUpdate(
    ws: WebSocket,
    d: { message_id: string; content: string },
  ) {
    const session = this.requireSession(ws);
    if (
      !session?.clerk_user_id ||
      !d ||
      typeof d.message_id !== "string" ||
      typeof d.content !== "string" ||
      !d.message_id ||
      !d.content.trim() ||
      d.content.length > 4000
    ) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4000, message: "Invalid message payload" },
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
      session.clerk_user_id,
      messageRow.channel_id,
    );
    const canManage =
      !!access &&
      access.serverId !== null &&
      hasChannelPermission(access, PERMISSIONS.MANAGE_MESSAGES);
    if (
      !access ||
      (messageRow.author_id !== session.clerk_user_id && !canManage)
    ) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4004, message: "Message not found or not owner" },
      });
      return;
    }

    try {
      const result = await this.env.DB.prepare(
        `UPDATE messages SET content = ?, updated_at = ?
         WHERE id = ? AND channel_id = ? AND (author_id = ? OR ? = 1)`,
      )
        .bind(
          d.content.trim(),
          now,
          d.message_id,
          messageRow.channel_id,
          session.clerk_user_id,
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
      log.error("Failed to update message:", err);
      return;
    }

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
          },
        },
      };
      if (access.serverId) {
        await this.broadcastToServerMembers(access.serverId, updateDispatch);
      } else {
        await this.broadcastToChannel(messageRow.channel_id, updateDispatch);
      }

      // Asynchronously fetch new embeds if content changed
      this.ctx.waitUntil(
        (async () => {
          const embeds = await extractAndProcessEmbeds(d.content.trim());
          if (embeds.length > 0) {
            try {
              await this.env.DB.prepare(
                `UPDATE messages SET embeds = ? WHERE id = ?`,
              )
                .bind(JSON.stringify(embeds), d.message_id)
                .run();

              const embedDispatch = {
                op: Op.Dispatch,
                d: {
                  event: "MESSAGE_UPDATE",
                  data: {
                    id: d.message_id,
                    channel_id: messageRow.channel_id,
                    embeds: embeds,
                  },
                },
              };
              if (access.serverId) {
                await this.broadcastToServerMembers(
                  access.serverId,
                  embedDispatch,
                );
              } else {
                await this.broadcastToChannel(
                  messageRow.channel_id,
                  embedDispatch,
                );
              }
            } catch (e) {
              log.error("Failed to update message with new embeds:", e);
            }
          }
        })(),
      );
    }
  }

  // ── Op 22: MessageDelete ──────────────────────────────────────────────

  private async handleMessageDelete(
    ws: WebSocket,
    d: { message_id: string; channel_id: string },
  ) {
    const session = this.requireSession(ws);
    if (
      !session?.clerk_user_id ||
      !d ||
      typeof d.message_id !== "string" ||
      typeof d.channel_id !== "string" ||
      !d.message_id ||
      !d.channel_id
    ) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4000, message: "Invalid message payload" },
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
      session.clerk_user_id,
      messageRow.channel_id,
    );
    const canManage =
      !!access &&
      access.serverId !== null &&
      hasChannelPermission(access, PERMISSIONS.MANAGE_MESSAGES);
    if (
      !access ||
      (messageRow.author_id !== session.clerk_user_id && !canManage)
    ) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4004, message: "Message not found or not owner" },
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
          session.clerk_user_id,
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

  private async handleTypingStart(ws: WebSocket, d: { channel_id: string }) {
    const session = this.requireSession(ws);
    if (!session?.clerk_user_id || !d || typeof d.channel_id !== "string")
      return;

    const access = await resolveChannelAccess(
      this.env.DB,
      session.clerk_user_id,
      d.channel_id,
    );
    if (!access || !hasChannelPermission(access, PERMISSIONS.VIEW_CHANNELS)) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4003, message: "Channel not found or access denied" },
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
            user_id: session.clerk_user_id,
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
    d: { channel_id: string; message_id: string; emoji: string },
  ) {
    const session = this.requireSession(ws);
    if (
      !session?.clerk_user_id ||
      !d ||
      typeof d.channel_id !== "string" ||
      typeof d.message_id !== "string" ||
      typeof d.emoji !== "string" ||
      !d.channel_id ||
      !d.message_id ||
      !d.emoji ||
      d.emoji.length > 128
    ) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4000, message: "Invalid reaction payload" },
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
          session.clerk_user_id,
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
        d: { code: 4003, message: "Channel not found or access denied" },
      });
      return;
    }

    const userId = session.clerk_user_id;
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
    d: { channel_id: string; message_id: string; emoji: string },
  ) {
    const session = this.requireSession(ws);
    if (
      !session?.clerk_user_id ||
      !d ||
      typeof d.channel_id !== "string" ||
      typeof d.message_id !== "string" ||
      typeof d.emoji !== "string" ||
      !d.channel_id ||
      !d.message_id ||
      !d.emoji ||
      d.emoji.length > 128
    ) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4000, message: "Invalid reaction payload" },
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
          session.clerk_user_id,
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
        d: { code: 4003, message: "Channel not found or access denied" },
      });
      return;
    }

    const userId = session.clerk_user_id;

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

  private async handleServerSubscribe(ws: WebSocket, d: { server_id: string }) {
    const session = this.requireSession(ws);
    if (
      !session ||
      !d ||
      typeof d.server_id !== "string" ||
      !d.server_id ||
      !session.clerk_user_id
    )
      return;

    // Already subscribed?
    if (session.subscribed_servers?.includes(d.server_id)) return;

    // Validate membership against D1
    try {
      const row = await this.env.DB.prepare(
        "SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?",
      )
        .bind(d.server_id, session.clerk_user_id)
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
    d: { target_user_id: string; channel_id: string },
  ) {
    const session = this.requireSession(ws);
    if (
      !session ||
      !session.clerk_user_id ||
      !d.target_user_id ||
      !d.channel_id
    )
      return;

    const callerId = session.clerk_user_id;
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
    let calleeAvatar: string | undefined;
    for (const [, sess] of this.sessions) {
      if (sess.clerk_user_id === calleeId) {
        calleeOnline = true;
        calleeName = sess.name;
        calleeUsername = sess.username ?? sess.name;
        calleeDisplayName = sess.display_name ?? sess.name;
        calleeAvatar = sess.avatar_url;
        break;
      }
    }
    if (!calleeOnline) {
      this.sendTo(ws, {
        op: Op.Dispatch,
        d: {
          event: "CALL_RING_STOP",
          data: { call_id: null, reason: "unavailable" },
        },
      });
      return;
    }

    // Auto-leave caller from any voice channel
    if (session.voice_channel_id) {
      this.removeFromVoiceChannel(session);
      session.voice_channel_id = undefined;
      this.persist(ws, session);
    }

    // Create pending call
    const callId = crypto.randomUUID();
    const sortedIds = [callerId, calleeId].sort();
    const voiceRoomId = `dm-call-${sortedIds[0]}-${sortedIds[1]}`;

    const timeout = setTimeout(() => {
      // Auto-cancel on timeout — callee didn't answer
      const pending = this.pendingCalls.get(calleeId);
      if (pending?.callId === callId) {
        this.pendingCalls.delete(calleeId);

        // NOTE: We do NOT remove the caller from the voice channel here.
        // The caller initiated the call and is already connected to the SFU.
        // They should remain in the call "room" even if the callee didn't pick up.
        // The caller can choose to leave manually, or wait and call again.

        // Tell the caller the ringing timed out (but they stay in the call)
        this.broadcastToUser(callerId, {
          op: Op.Dispatch,
          d: {
            event: "CALL_RING_STOP",
            data: { call_id: callId, reason: "timeout" },
          },
        });
        // Tell the callee the ringing timed out
        this.broadcastToUser(calleeId, {
          op: Op.Dispatch,
          d: {
            event: "CALL_RING_STOP",
            data: { call_id: callId, reason: "timeout" },
          },
        });
        log.info(
          `Call ${callId} ring timed out (caller stays in voice channel)`,
        );
      }
    }, CALL_RING_TIMEOUT_MS);

    const pendingCall: PendingCall = {
      callId,
      callerId,
      calleeId,
      channelId: d.channel_id,
      voiceRoomId,
      timeout,
      callerName: session.name,
      callerUsername: session.username ?? session.name,
      callerDisplayName: session.display_name ?? session.name,
      callerAvatar: session.avatar_url,
      calleeName,
      calleeUsername,
      calleeDisplayName,
      calleeAvatar,
    };
    this.pendingCalls.set(calleeId, pendingCall);

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

    // Add caller directly to the DM voice channel to establish the "Lobby"
    if (session.voice_channel_id) {
      this.removeFromVoiceChannel(session);
    }
    session.voice_channel_id = d.channel_id;
    this.persist(ws, session);
    this.addToVoiceChannelForCall(session);

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

  private handleCallAccept(ws: WebSocket, d: { call_id: string }) {
    const session = this.requireSession(ws);
    if (!session || !session.clerk_user_id || !d.call_id) return;

    const calleeId = session.clerk_user_id;

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

    // Clear the timeout
    clearTimeout(pending.timeout);
    this.pendingCalls.delete(calleeId);

    // Auto-leave callee from any previous voice channel before putting them in the DM channel
    if (session.voice_channel_id) {
      this.removeFromVoiceChannel(session);
      session.voice_channel_id = undefined;
      this.persist(ws, session);
    }

    // Add callee to voiceChannelMembers under the DM channel.
    // (The caller is already here from handleCallInitiate)
    session.voice_channel_id = pending.channelId;
    this.persist(ws, session);
    this.addToVoiceChannelForCall(session);

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

    log.info(`Call accepted: ${pending.callId}`);
  }

  // ── Op 38: CallDecline ───────────────────────────────────────────────

  private handleCallDecline(ws: WebSocket, d: { call_id: string }) {
    const session = this.requireSession(ws);
    if (!session || !session.clerk_user_id || !d.call_id) return;

    const calleeId = session.clerk_user_id;
    const pending = this.pendingCalls.get(calleeId);
    if (!pending || pending.callId !== d.call_id) return;

    clearTimeout(pending.timeout);
    this.pendingCalls.delete(calleeId);

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

    log.info(`Call declined: ${pending.callId}`);
  }

  private handleCallEnd(ws: WebSocket, d: { call_id: string }) {
    const session = this.requireSession(ws);
    if (!session || !session.clerk_user_id) return;

    const userId = session.clerk_user_id;

    // Active calls are automatically torn down natively when both users drop out of the voice channel.
    // CALL_END is now purely designated for aborting/declining pending Rings!

    // Maybe they're cancelling an outgoing ring
    const pending = this.findPendingCallForUser(userId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingCalls.delete(pending.calleeId);

      // Also remove caller from voiceChannelMembers since they are abandoning the entire call attempt
      const callerWs = this.findWsByClerkUserId(pending.callerId);
      if (callerWs) {
        const callerSession = this.getSession(callerWs);
        if (callerSession) {
          this.removeFromVoiceChannel(callerSession);
          callerSession.voice_channel_id = undefined;
          this.persist(callerWs, callerSession);
        }
      }

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

  /** Clean up all calls for a user (called on disconnect/leave) */
  private cleanupCallsForUser(userId: string, reason: string) {
    log.info(
      `cleanupCallsForUser(${userId}, ${reason}): pendingCalls.size=${this.pendingCalls.size}`,
    );

    // Clean up pending calls (as callee)
    const pendingAsCallee = this.pendingCalls.get(userId);
    if (pendingAsCallee) {
      log.info(
        `Cleaning up pending call as callee: callId=${pendingAsCallee.callId}`,
      );
      clearTimeout(pendingAsCallee.timeout);
      this.pendingCalls.delete(userId);
      this.broadcastToUser(pendingAsCallee.callerId, {
        op: Op.Dispatch,
        d: {
          event: "CALL_RING_STOP",
          data: { call_id: pendingAsCallee.callId, reason },
        },
      });
    }

    // Clean up pending calls (as caller)
    for (const [calleeId, call] of this.pendingCalls) {
      if (call.callerId === userId) {
        log.info(`Cleaning up pending call as caller: callId=${call.callId}`);
        clearTimeout(call.timeout);
        this.pendingCalls.delete(calleeId);
        this.broadcastToUser(calleeId, {
          op: Op.Dispatch,
          d: {
            event: "CALL_RING_STOP",
            data: { call_id: call.callId, reason },
          },
        });
      }
    }

    // Active calls purely live in voice channel presence now, and `handleLeave`
    // natively removes users from `voiceChannelMembers`. We don't need any more manually teardown logic!
    log.info(`cleanupCallsForUser done.`);
  }

  /** Add a user to voiceChannelMembers for a call (reuses voice channel infra) */
  private addToVoiceChannelForCall(session: WsAttachment) {
    const channelId = session.voice_channel_id;
    if (!channelId || !session.clerk_user_id) return;

    let members = this.voiceChannelMembers.get(channelId);
    if (!members) {
      members = new Map();
      this.voiceChannelMembers.set(channelId, members);
      // First member — record channel start time
      this.voiceChannelStartedAt.set(channelId, Date.now());
      this.persistVoiceChannelStartedAt();
    }

    const inserted = !members.has(session.clerk_user_id);
    const member: VoiceChannelMember = {
      clerk_user_id: session.clerk_user_id,
      name: session.name,
      username: session.username,
      display_name: session.display_name,
      avatar_url: session.avatar_url,
      avatar_display: session.avatar_display,
      stream_preview_url: session.stream_preview_url,
      connected: true,
      connection_state: "connected",
      disconnected_at: null,
      reconnect_expires_at: null,
      self_mute: session.self_mute,
      self_deaf: session.self_deaf,
      self_video: session.self_video,
      self_stream: session.self_stream,
      self_stream_audio: session.self_stream_audio,
      spatial_audio_enabled: session.spatial_audio_enabled,
      spatial_audio_high_fidelity: session.spatial_audio_high_fidelity,
      joined_at: this.voiceChannelStartedAt.get(channelId) ?? Date.now(),
    };
    members.set(session.clerk_user_id, member);

    // Broadcast to all clients
    this.ctx.waitUntil(
      this.broadcastVoiceChannelState(channelId, undefined, inserted),
    );

    this.persistVoiceChannelMembers();
  }

  /** Find a WebSocket by clerk_user_id */
  private findWsByClerkUserId(clerkUserId: string): WebSocket | null {
    for (const [ws, session] of this.sessions) {
      if (session.clerk_user_id === clerkUserId) return ws;
    }
    return null;
  }
}
