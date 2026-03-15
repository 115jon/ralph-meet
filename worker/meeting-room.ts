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
}

const enum CloseCode {
  UnknownOpcode = 4001,
  NotAuthenticated = 4003,
  AlreadyAuthenticated = 4005,
  SessionInvalid = 4006,
  SessionTimeout = 4009,
}

// ── Shared interfaces ───────────────────────────────────────────────────────

interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

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
  avatar_url?: string;
  self_mute: boolean;
  self_deaf: boolean;
  self_stream: boolean;
  self_stream_audio?: boolean;
  self_video: boolean;
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

// Data stored on each WebSocket via serializeAttachment/deserializeAttachment
interface WsAttachment {
  id: string;
  name: string;
  avatar_url?: string;
  clerk_user_id?: string;
  self_mute: boolean;
  self_deaf: boolean;
  self_stream: boolean;
  self_stream_audio?: boolean;
  self_video: boolean;
  suppress: boolean;
  status?: "online" | "idle" | "dnd" | "offline";
  tracks: TrackInfo[];
  last_heartbeat?: number;
  seq: number;
  subscribed_channels: string[];
  subscribed_servers: string[];
  /** Channel ID the user is currently in voice for (global gateway only) */
  voice_channel_id?: string;
}

export interface VoiceChannelMember {
  clerk_user_id: string;
  name: string;
  avatar_url?: string;
  self_mute: boolean;
  self_deaf: boolean;
  self_video: boolean;
  self_stream: boolean;
  self_stream_audio?: boolean;
}

/** A pending (ringing) or active call between two users */
interface PendingCall {
  callId: string;
  callerId: string;      // clerk_user_id of caller
  calleeId: string;      // clerk_user_id of callee
  channelId: string;     // DM channel ID
  voiceRoomId: string;   // SFU room slug for media
  timeout: ReturnType<typeof setTimeout>;
  callerName: string;
  callerAvatar?: string;
  calleeName?: string;
  calleeAvatar?: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 45_000;
const PROFILE_REFRESH_COOLDOWN_MS = 10_000;
const ZOMBIE_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 3;  // 135s — 3 missed heartbeats
const PRUNE_ALARM_INTERVAL_MS = 60_000;                // check every 60s
const CALL_RING_TIMEOUT_MS = 30_000;                   // auto-cancel after 30s
const RESUME_GRACE_PERIOD_MS = 120_000;                // 2 min — keep session resumable after disconnect

// ── MeetingRoom Durable Object ──────────────────────────────────────────────

export class MeetingRoom extends DurableObject<Env> {
  private sessions: Map<WebSocket, WsAttachment> = new Map();
  private profileRefreshCooldowns: Map<string, number> = new Map();
  private resumableSessions: Map<string, WsAttachment> = new Map();
  /** Per-participant replay buffer: participantId → [{seq, msg}] */
  private replayBuffers: Map<string, Array<{ seq: number; msg: ServerMsg }>> = new Map();
  private static readonly MAX_REPLAY_BUFFER = 100;
  /** Channel → Set<WebSocket> — tracks which clients are subscribed to which channels (typing/presence only) */
  private channelSubscriptions: Map<string, Set<WebSocket>> = new Map();
  /** Server → Set<WebSocket> — tracks which clients are members of which servers (message delivery) */
  private serverSubscriptions: Map<string, Set<WebSocket>> = new Map();
  /** Voice channel presence: channelId → Map<clerkUserId, member info> */
  private voiceChannelMembers: Map<string, Map<string, VoiceChannelMember>> = new Map();
  /** Pending calls: calleeId → PendingCall (only one pending per callee) */
  private pendingCalls: Map<string, PendingCall> = new Map();
  /** Recently accepted calls (callId), acts as a TTL cache to prevent Op 33/Op 37 race conditions */
  private acceptedCalls: Set<string> = new Set();
  /** Voice channel started timestamps: channelId → epoch ms when first member joined */
  private voiceChannelStartedAt: Map<string, number> = new Map();
  /** Resumable session expiry: participantId → epoch ms when disconnect happened */
  private resumableSessionExpiry: Map<string, number> = new Map();

  constructor(public ctx: DurableObjectState, public env: Env) {
    super(ctx, env);

    // Auto-respond to heartbeat pings without waking from hibernation.
    // The runtime handles these at the protocol level, reducing billed
    // duration on the free tier.  We use getWebSocketAutoResponseTimestamp()
    // in alarm() for zombie pruning instead of relying on last_heartbeat.
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ op: 3 /* Heartbeat */, d: { seq_ack: 0 } }),
        JSON.stringify({ op: 6 /* HeartbeatACK */, d: { seq: 0 } })
      )
    );

    // Restore sessions from hibernation-safe WebSocket attachments
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const attachment = ws.deserializeAttachment() as WsAttachment | null;
        if (attachment?.id) {
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
      const storedSlug = await this.ctx.storage.get("roomSlug") as string | undefined;
      if (storedSlug) this.roomSlug = storedSlug;

      // Restore resumable sessions from storage
      const storedResumable = await this.ctx.storage.get("resumableSessions") as Record<string, WsAttachment> | undefined;
      if (storedResumable) {
        for (const [id, attachment] of Object.entries(storedResumable)) {
          this.resumableSessions.set(id, attachment);
        }
      }

      const stored = await this.ctx.storage.get("voiceChannelMembers") as Record<string, VoiceChannelMember[]> | undefined;
      if (stored) {
        for (const channelId of Object.keys(stored)) {
          const memberList = stored[channelId] as VoiceChannelMember[];
          const memberMap = new Map<string, VoiceChannelMember>();
          for (const m of memberList) {
            memberMap.set(m.clerk_user_id, m);
          }
          if (memberMap.size > 0) {
            this.voiceChannelMembers.set(channelId, memberMap);
          }
        }
      }

      // Restore voice channel started timestamps
      const storedStartedAt = await this.ctx.storage.get("voiceChannelStartedAt") as Record<string, number> | undefined;
      if (storedStartedAt) {
        for (const [channelId, ts] of Object.entries(storedStartedAt)) {
          this.voiceChannelStartedAt.set(channelId, ts);
        }
      }

      // Restore resumable session expiry map
      const storedExpiry = await this.ctx.storage.get("resumableSessionExpiry") as Record<string, number> | undefined;
      if (storedExpiry) {
        for (const [id, ts] of Object.entries(storedExpiry)) {
          this.resumableSessionExpiry.set(id, ts);
        }
      }

      // Sync voice_channel_id on sessions from the stored voice members
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
    });

    // Schedule prune alarm if there are live sessions
    if (this.sessions.size > 0) {
      this.scheduleAlarm();
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const gatewayVersion = parseInt(url.searchParams.get("v") ?? "1", 10);

    // Extract channel ID or slug from URL path
    const channelMatch = url.pathname.match(/\/api\/channels\/([^/]+)\/ws/);
    if (channelMatch) {
      this.roomSlug = channelMatch[1];
      // Persist for hibernation survival
      this.ctx.storage.put("roomSlug", this.roomSlug).catch(() => { });
    }
    // Also support /api/gateway (global gateway)
    if (url.pathname === "/api/gateway") {
      this.roomSlug = "global-gateway";
      this.ctx.storage.put("roomSlug", this.roomSlug).catch(() => { });
    }

    if (url.pathname.endsWith("/ws") || url.pathname === "/api/gateway") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);

      console.log(`[MainGW] New connection, gateway_version=${gatewayVersion}`);

      this.sendTo(server, {
        op: Op.Hello,
        d: { heartbeat_interval: HEARTBEAT_INTERVAL_MS, gateway_version: gatewayVersion },
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // Internal broadcast endpoint — called by REST API routes after persisting to D1
    if (url.pathname === "/broadcast" && request.method === "POST") {
      try {
        const body = await request.json() as {
          channel_id?: string;
          server_id?: string;
          target_user_id?: string;
          event: string;
          data: unknown;
          broadcast_all?: boolean;
        };
        const dispatchMsg = {
          op: Op.Dispatch,
          d: { event: body.event, data: body.data },
        };
        console.log(`[MainGW] Internal broadcast: event=${body.event}, type=${body.broadcast_all ? 'all' : body.target_user_id ? 'user' : 'channel'}, recipient=${body.target_user_id || body.channel_id || 'all'}`);

        if (body.broadcast_all) {
          this.broadcast(dispatchMsg);
        } else if (body.target_user_id) {
          this.broadcastToUser(body.target_user_id, dispatchMsg);
        } else if (body.server_id) {
          this.broadcastToServerMembers(body.server_id, dispatchMsg);
        } else if (body.channel_id) {
          this.broadcastToChannel(body.channel_id, dispatchMsg);
        }
        return new Response("OK", { status: 200 });
      } catch (e) {
        return new Response(`Broadcast error: ${e}`, { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, rawMsg: string | ArrayBuffer) {
    if (typeof rawMsg !== "string") return;
    if (this.env.DEBUG) console.log(`[MainGW] webSocketMessage received: ${rawMsg.substring(0, 100)}`);

    let msg: GatewayMessage;
    try {
      msg = JSON.parse(rawMsg);
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

    switch (msg.op) {
      case Op.Identify:
        await this.handleIdentify(ws, msg.d);
        break;

      case Op.Heartbeat:
        this.handleHeartbeat(ws, msg.d);
        break;

      case Op.Resume:
        this.handleResume(ws, msg.d);
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
        this.handleTypingStart(ws, msg.d);
        break;

      case Op.ReactionAdd:
        await this.handleReactionAdd(ws, msg.d);
        break;

      case Op.ReactionRemove:
        await this.handleReactionRemove(ws, msg.d);
        break;

      case Op.ChannelSubscribe:
        this.handleChannelSubscribe(ws, msg.d);
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
        this.handleVoiceChannelLeave(ws);
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

      default:
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: CloseCode.UnknownOpcode, message: `Unknown opcode: ${msg.op}` },
        });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    await this.handleLeave(ws);
    try { ws.close(code, reason); } catch { /* already closed */ }
  }

  async webSocketError(ws: WebSocket) {
    await this.handleLeave(ws);
  }

  // ── Alarm: zombie pruning ──────────────────────────────────────────────

  async alarm() {
    const now = Date.now();
    const zombies: WebSocket[] = [];

    for (const [ws, session] of this.sessions) {
      // Use auto-response timestamp as primary liveness signal.
      // setWebSocketAutoResponse handles heartbeats without waking the DO,
      // so last_heartbeat only updates when the DO is already awake.
      let lastActivity = session.last_heartbeat ?? 0;
      try {
        const autoTs = this.ctx.getWebSocketAutoResponseTimestamp(ws);
        if (autoTs) {
          const autoMs = autoTs.getTime();
          if (autoMs > lastActivity) lastActivity = autoMs;
        }
      } catch { /* ws may be invalid */ }

      if (lastActivity && now - lastActivity > ZOMBIE_TIMEOUT_MS) {
        console.log(`[MainGW] Pruning zombie: ${session.id} (${session.name}), ` +
          `last_activity=${Math.round((now - lastActivity) / 1000)}s ago`);
        zombies.push(ws);
      }
    }

    for (const ws of zombies) {
      await this.handleLeave(ws);
    }

    // Prune expired resumable sessions
    let resumableChanged = false;
    for (const [id, disconnectedAt] of this.resumableSessionExpiry) {
      if (now - disconnectedAt > RESUME_GRACE_PERIOD_MS) {
        console.log(`[MainGW] Pruning expired resumable session: ${id} (disconnected ${Math.round((now - disconnectedAt) / 1000)}s ago)`);
        this.resumableSessions.delete(id);
        this.replayBuffers.delete(id);
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

    // Reschedule if rooms still have sessions or pending resumable sessions
    if (this.sessions.size > 0 || this.resumableSessionExpiry.size > 0) {
      this.scheduleAlarm();
    }
  }

  private scheduleAlarm() {
    this.ctx.storage.setAlarm(Date.now() + PRUNE_ALARM_INTERVAL_MS).catch(() => { });
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private persist(ws: WebSocket, data: WsAttachment) {
    const wasEmpty = this.sessions.size === 0;
    this.sessions.set(ws, data);
    ws.serializeAttachment(data);
    if (wasEmpty) this.scheduleAlarm();
  }

  /** Persist voice channel members to storage for hibernation resilience */
  private persistVoiceChannelMembers() {
    const serialized: Record<string, VoiceChannelMember[]> = {};
    for (const [channelId, members] of this.voiceChannelMembers) {
      if (members.size > 0) {
        serialized[channelId] = Array.from(members.values());
      }
    }
    this.ctx.storage.put("voiceChannelMembers", serialized).catch(() => { });
  }

  /** Persist voice channel started-at timestamps to storage */
  private persistVoiceChannelStartedAt() {
    const serialized: Record<string, number> = {};
    for (const [channelId, ts] of this.voiceChannelStartedAt) {
      serialized[channelId] = ts;
    }
    this.ctx.storage.put("voiceChannelStartedAt", serialized).catch(() => { });
  }

  /** Remove voice channel members that don't have a live or resumable session */
  private reconcileVoiceMembers() {
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
    for (const [sessionId] of this.resumableSessionExpiry) {
      const resumable = this.resumableSessions.get(sessionId);
      if (resumable?.clerk_user_id) {
        activeClerkIds.add(resumable.clerk_user_id);
      }
    }

    let changed = false;
    for (const [channelId, members] of this.voiceChannelMembers) {
      for (const [clerkId] of members) {
        if (!activeClerkIds.has(clerkId)) {
          members.delete(clerkId);
          changed = true;
          console.log(`[MainGW] Reconcile: removed stale voice member ${clerkId} from channel ${channelId}`);
        }
      }
      if (members.size === 0) {
        this.voiceChannelMembers.delete(channelId);
      }
    }

    if (changed) {
      this.persistVoiceChannelMembers();
    }
  }

  private getSession(ws: WebSocket): WsAttachment | undefined {
    return this.sessions.get(ws);
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
      avatar_url: data.avatar_url,
      self_mute: data.self_mute,
      self_deaf: data.self_deaf,
      self_stream: data.self_stream,
      self_stream_audio: data.self_stream_audio,
      self_video: data.self_video,
      suppress: data.suppress,
      status: data.status,
      tracks: [...data.tracks],
    };
  }

  // ── Voice token generation ─────────────────────────────────────────────
  // HMAC-signed token: "payload.signature" where payload = "participant_id:room_slug:timestamp"

  private async generateVoiceToken(participantId: string, clerkUserId?: string): Promise<string> {
    try {
      if (!this.env.CALLS_APP_SECRET) {
        console.warn("[MeetingRoom] CALLS_APP_SECRET not set, skipping voice token");
        return "";
      }
      const roomSlug = this.roomSlug ?? "unknown";
      const payload = `${participantId}:${roomSlug}:${Date.now()}:${clerkUserId || "anonymous"}`;
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(this.env.CALLS_APP_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sigBuf = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(payload)
      );
      const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
      return `${payload}.${sig}`;
    } catch (err) {
      console.error("[MeetingRoom] Voice token generation failed:", err);
      return "";
    }
  }

  private get roomSlug(): string {
    // The DO doesn't inherently know its name; we parse it from the
    // WebSocket request URL. Cache it on first access.
    return (this as unknown as { _roomSlug?: string })._roomSlug ?? "unknown";
  }

  private set roomSlug(val: string) {
    (this as unknown as { _roomSlug?: string })._roomSlug = val;
  }

  /** Persist resumable sessions to storage for hibernation survival */
  private persistResumableSessions() {
    const serialized: Record<string, WsAttachment> = {};
    for (const [id, attachment] of this.resumableSessions) {
      serialized[id] = attachment;
    }
    this.ctx.storage.put("resumableSessions", serialized).catch(() => { });
  }

  /** Persist resumable session expiry map to storage for hibernation survival */
  private persistResumableSessionExpiry() {
    const serialized: Record<string, number> = {};
    for (const [id, ts] of this.resumableSessionExpiry) {
      serialized[id] = ts;
    }
    this.ctx.storage.put("resumableSessionExpiry", serialized).catch(() => { });
  }

  // ── Op 0: Identify ────────────────────────────────────────────────────

  private async handleIdentify(
    ws: WebSocket,
    d: { name: string; avatar_url?: string; clerk_user_id?: string }
  ) {
    if (this.getSession(ws)) {
      console.log(`[MainGW] AlreadyAuthenticated — session exists for this WS`);
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.AlreadyAuthenticated, message: "Already identified" },
      });
      return;
    }

    try {
      const participantId = crypto.randomUUID();
      const iceServers = await this.generateTurnCredentials();

      // Resolve actual profile from Clerk if possible
      let resolvedName = d.name;
      let resolvedAvatar = d.avatar_url;
      let resolvedStatus: "online" | "idle" | "dnd" | "offline" = "online";

      if (d.clerk_user_id) {
        const profile = await this.fetchClerkProfile(d.clerk_user_id);
        if (profile) {
          resolvedName = profile.name;
          resolvedAvatar = profile.avatarUrl;
        }

        // Fetch status from D1
        try {
          const userRow = await this.env.DB.prepare("SELECT status FROM users WHERE id = ?")
            .bind(d.clerk_user_id)
            .first<{ status: string }>();
          if (userRow?.status) {
            resolvedStatus = userRow.status as any;
          }
        } catch (e) {
          console.error("[handleIdentify] D1 status fetch failed:", e);
        }
      }

      console.log(`[MeetingRoom] Identify: name=${resolvedName}, avatar=${resolvedAvatar}, clerk=${d.clerk_user_id}`);

      // Build roster
      const participants: VoiceState[] = [];
      for (const [, data] of this.sessions) {
        participants.push(this.buildVoiceState(data));
      }

      const attachment: WsAttachment = {
        id: participantId,
        name: resolvedName,
        avatar_url: resolvedAvatar,
        clerk_user_id: d.clerk_user_id,
        self_mute: true,
        self_deaf: false,
        self_stream: false,
        self_stream_audio: false,
        self_video: false,
        suppress: false,
        status: resolvedStatus,
        tracks: [],
        last_heartbeat: Date.now(),
        seq: 0,
        subscribed_channels: [],
        subscribed_servers: [],
      };
      this.persist(ws, attachment);
      this.resumableSessions.set(participantId, attachment);
      this.persistResumableSessions();

      // Generate voice token for VoiceRoom authentication
      const voiceToken = await this.generateVoiceToken(participantId, attachment.clerk_user_id);

      // Op 2: Ready — includes voice_token for Voice Gateway connection
      this.sendTo(ws, {
        op: Op.Ready,
        d: {
          participant_id: participantId,
          ice_servers: iceServers,
          participants,
          heartbeat_interval: HEARTBEAT_INTERVAL_MS,
          voice_token: voiceToken,
        },
      });

      // Op 15: VoiceStateUpdate (join) to everyone else
      this.broadcast(
        {
          op: Op.VoiceStateUpdate,
          d: {
            participant: this.buildVoiceState(attachment),
            action: "join",
          },
        },
        ws
      );

      // Broadcast PRESENCE_UPDATE (online) to all clients if this user has a clerk_user_id
      if (attachment.clerk_user_id) {
        this.broadcast(
          {
            op: Op.Dispatch,
            d: {
              event: "PRESENCE_UPDATE",
              data: {
                user_id: attachment.clerk_user_id,
                status: attachment.status,
              },
            },
          },
          ws
        );

        // Resume Pending Ringing upon Identify
        const userId = attachment.clerk_user_id;

        const pending = this.findPendingCallForUser(userId);
        if (pending && pending.calleeId === userId) {
          console.log(`[MainGW] Found pending call (as callee) for ${userId}: callId=${pending.callId}`);
          this.sendTo(ws, {
            op: Op.Dispatch,
            d: {
              event: "CALL_RING",
              data: {
                call_id: pending.callId,
                caller_id: pending.callerId,
                caller_name: pending.callerName,
                caller_avatar: pending.callerAvatar,
                channel_id: pending.channelId,
                is_reconnect: true,
              },
            },
          });
        }
      }
    } catch (err) {
      console.error("[MeetingRoom] handleIdentify crashed:", err);
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4000, message: `Identify failed: ${err instanceof Error ? err.message : 'Unknown error'}` },
      });
    }
  }

  // ── Op 3: Heartbeat ────────────────────────────────────────────────────

  private handleHeartbeat(ws: WebSocket, d: { seq_ack: number }) {
    const session = this.getSession(ws);
    if (!session) return;

    session.last_heartbeat = Date.now();
    session.seq = (session.seq ?? 0) + 1;
    this.persist(ws, session);

    this.sendTo(ws, {
      op: Op.HeartbeatACK,
      d: { seq: session.seq },
    });
  }

  // ── Op 7: Resume ──────────────────────────────────────────────────────

  private handleResume(ws: WebSocket, d: { session_id: string; seq_ack: number }) {
    const oldAttachment = this.resumableSessions.get(d.session_id);
    if (!oldAttachment) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.SessionInvalid, message: "Session not found for resume" },
      });
      return;
    }

    // Clear the expiry — session is alive again
    this.resumableSessionExpiry.delete(d.session_id);
    this.persistResumableSessionExpiry();

    oldAttachment.last_heartbeat = Date.now();
    this.persist(ws, oldAttachment);

    // Rebuild channel subscriptions from the restored session
    if (oldAttachment.subscribed_channels) {
      for (const chId of oldAttachment.subscribed_channels) {
        let subs = this.channelSubscriptions.get(chId);
        if (!subs) {
          subs = new Set();
          this.channelSubscriptions.set(chId, subs);
        }
        subs.add(ws);
      }
    }
    if (oldAttachment.subscribed_servers) {
      for (const sId of oldAttachment.subscribed_servers) {
        let subs = this.serverSubscriptions.get(sId);
        if (!subs) {
          subs = new Set();
          this.serverSubscriptions.set(sId, subs);
        }
        subs.add(ws);
      }
    }

    // Re-add to voice channel members if the session was in a VC.
    // During handleLeave, we now defer voice channel cleanup for resumable
    // sessions — but if reconcileVoiceMembers() ran during the disconnect
    // window (or a future code path removed them), re-ensure membership.
    if (oldAttachment.voice_channel_id && oldAttachment.clerk_user_id) {
      let members = this.voiceChannelMembers.get(oldAttachment.voice_channel_id);
      if (!members) {
        members = new Map();
        this.voiceChannelMembers.set(oldAttachment.voice_channel_id, members);
        this.voiceChannelStartedAt.set(oldAttachment.voice_channel_id, Date.now());
        this.persistVoiceChannelStartedAt();
      }
      if (!members.has(oldAttachment.clerk_user_id)) {
        members.set(oldAttachment.clerk_user_id, {
          clerk_user_id: oldAttachment.clerk_user_id,
          name: oldAttachment.name,
          avatar_url: oldAttachment.avatar_url,
          self_mute: oldAttachment.self_mute,
          self_deaf: oldAttachment.self_deaf,
          self_video: oldAttachment.self_video,
          self_stream: oldAttachment.self_stream,
          self_stream_audio: oldAttachment.self_stream_audio,
        });
        this.persistVoiceChannelMembers();

        // Broadcast the restored state so all sidebar UIs update
        this.broadcast({
          op: Op.Dispatch,
          d: {
            event: "VOICE_CHANNEL_STATE_UPDATE",
            data: {
              channel_id: oldAttachment.voice_channel_id,
              members: Array.from(members.values()),
              started_at: this.voiceChannelStartedAt.get(oldAttachment.voice_channel_id) ?? null,
            },
          },
        });
      }
    }

    // Replay buffered messages the client missed
    const buffer = this.replayBuffers.get(d.session_id) ?? [];
    const missed = buffer.filter((entry) => entry.seq > d.seq_ack);
    console.log(`[MainGW] Resumed session: ${d.session_id}, replaying ${missed.length} messages (seq_ack=${d.seq_ack})`);

    for (const entry of missed) {
      this.sendTo(ws, entry.msg);
    }

    this.sendTo(ws, {
      op: Op.Resumed,
      d: {},
    });

    // Send current voice channel states so the client can reconcile their
    // sidebar. During the disconnect window, the client may have missed
    // VOICE_CHANNEL_STATE_UPDATE events — this full sync corrects that.
    const voiceStates: Record<string, VoiceChannelMember[]> = {};
    const voiceStartedAt: Record<string, number> = {};
    for (const [channelId, members] of this.voiceChannelMembers) {
      if (members.size > 0) {
        voiceStates[channelId] = Array.from(members.values());
        const startedAt = this.voiceChannelStartedAt.get(channelId);
        if (startedAt) {
          voiceStartedAt[channelId] = startedAt;
        }
      }
    }
    if (Object.keys(voiceStates).length > 0) {
      this.sendTo(ws, {
        op: Op.Dispatch,
        d: {
          event: "VOICE_CHANNEL_STATES",
          data: { voice_states: voiceStates, voice_started_at: voiceStartedAt },
        },
      });
    }
  }

  // ── Op 15: VoiceStateUpdate (C→S) — mute/camera state changes ──────

  private handleVoiceStateUpdate(
    ws: WebSocket,
    d: { self_mute?: boolean; self_deaf?: boolean; self_video?: boolean; self_stream?: boolean; self_stream_audio?: boolean }
  ) {
    const session = this.requireSession(ws);
    if (!session) return;

    if (d.self_mute !== undefined) session.self_mute = d.self_mute;
    if (d.self_deaf !== undefined) session.self_deaf = d.self_deaf;
    if (d.self_video !== undefined) session.self_video = d.self_video;
    if (d.self_stream !== undefined) session.self_stream = d.self_stream;
    if (d.self_stream_audio !== undefined) session.self_stream_audio = d.self_stream_audio;
    this.persist(ws, session);

    this.broadcast(
      {
        op: Op.VoiceStateUpdate,
        d: {
          participant: this.buildVoiceState(session),
          action: "update",
        },
      },
      ws
    );

    // Also update the voice channel sidebar state if user is in a VC
    if (session.voice_channel_id && session.clerk_user_id) {
      const members = this.voiceChannelMembers.get(session.voice_channel_id);
      if (members?.has(session.clerk_user_id)) {
        const member = members.get(session.clerk_user_id)!;
        member.self_mute = session.self_mute;
        member.self_deaf = session.self_deaf;
        member.self_video = session.self_video;
        member.self_stream = session.self_stream;
        member.self_stream_audio = session.self_stream_audio;
        this.persistVoiceChannelMembers();

        this.broadcast({
          op: Op.Dispatch,
          d: {
            event: "VOICE_CHANNEL_STATE_UPDATE",
            data: {
              channel_id: session.voice_channel_id,
              members: Array.from(members.values()),
              started_at: this.voiceChannelStartedAt.get(session.voice_channel_id) ?? null,
            },
          },
        });
      }
    }
  }

  // ── Op 26: PresenceUpdate (C→S) ──────────────────────────────────────────

  private handlePresenceUpdate(ws: WebSocket, d: { status: "online" | "idle" | "dnd" | "offline" }) {
    const session = this.requireSession(ws);
    if (!session) return;

    if (!["online", "idle", "dnd", "offline"].includes(d.status)) return;

    session.status = d.status;
    this.persist(ws, session);

    if (session.clerk_user_id) {
      // 1. Persist to D1 (fire-and-forget, don't block other messages)
      const clerkId = session.clerk_user_id;
      const status = d.status;
      (async () => {
        try {
          await this.env.DB.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?")
            .bind(status, new Date().toISOString(), clerkId)
            .run();

          // 2. Invalidate caches for all servers this user is in
          const { results } = await this.env.DB.prepare("SELECT server_id FROM server_members WHERE user_id = ?")
            .bind(clerkId)
            .all();

          if (results) {
            for (const row of results) {
              const serverId = row.server_id as string;
              const cacheKey = `v1:server:members:${serverId}`;
              this.env.CACHE.delete(cacheKey).catch(() => { });
            }
          }
        } catch (e) {
          console.error("[handlePresenceUpdate] D1 update failed:", e);
        }
      })();

      // 3. Broadcast to all
      this.broadcast({
        op: Op.Dispatch,
        d: {
          event: "PRESENCE_UPDATE",
          data: {
            user_id: session.clerk_user_id,
            status: d.status,
          },
        },
      });
    }
  }

  // ── Op 17: ProfileRefresh ──────────────────────────────────────────────

  private async handleProfileRefresh(ws: WebSocket) {
    const session = this.requireSession(ws);
    if (!session?.clerk_user_id) return;

    const now = Date.now();
    const lastRefresh = this.profileRefreshCooldowns.get(session.id) ?? 0;
    if (now - lastRefresh < PROFILE_REFRESH_COOLDOWN_MS) return;
    this.profileRefreshCooldowns.set(session.id, now);

    const verified = await this.fetchClerkProfile(session.clerk_user_id);
    if (verified) {
      session.name = verified.name;
      session.avatar_url = verified.avatarUrl;
      this.persist(ws, session);

      this.broadcast(
        {
          op: Op.ProfileUpdate,
          d: {
            participant_id: session.id,
            name: verified.name,
            avatar_url: verified.avatarUrl,
          },
        },
        ws
      );

      // Also update the voice channel sidebar state if user is in a VC
      if (session.voice_channel_id && session.clerk_user_id) {
        const members = this.voiceChannelMembers.get(session.voice_channel_id);
        if (members?.has(session.clerk_user_id)) {
          const member = members.get(session.clerk_user_id)!;
          member.name = verified.name;
          member.avatar_url = verified.avatarUrl;
          this.persistVoiceChannelMembers();

          this.broadcast({
            op: Op.Dispatch,
            d: {
              event: "VOICE_CHANNEL_STATE_UPDATE",
              data: {
                channel_id: session.voice_channel_id,
                members: Array.from(members.values()),
                started_at: this.voiceChannelStartedAt.get(session.voice_channel_id) ?? null,
              },
            },
          });
        }
      }
    }
  }

  // ── Leave / Disconnect ─────────────────────────────────────────────────

  private async handleLeave(ws: WebSocket, intentional: boolean = false) {
    const session = this.getSession(ws);
    if (!session) return;

    // Broadcast PRESENCE_UPDATE (offline) before cleanup
    if (session.clerk_user_id) {
      // Only broadcast offline if no other session has the same clerk_user_id
      let otherSessionExists = false;
      for (const [otherWs, otherSession] of this.sessions) {
        if (otherWs !== ws && otherSession.clerk_user_id === session.clerk_user_id) {
          otherSessionExists = true;
          break;
        }
      }
      if (!otherSessionExists) {
        this.broadcast(
          {
            op: Op.Dispatch,
            d: {
              event: "PRESENCE_UPDATE",
              data: {
                user_id: session.clerk_user_id,
                status: "offline",
              },
            },
          },
          ws
        );
      }
    }

    // For abrupt WebSocket closes (not intentional), defer voice channel cleanup
    // so the sidebar doesn't flash empty for other users during reconnect.
    // The alarm's reconcileVoiceMembers() will clean up if resume never happens.
    // For intentional disconnects (Op.ClientDisconnect), always clean up immediately.
    if (session.voice_channel_id && intentional) {
      this.removeFromVoiceChannel(session);
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

    // Keep resumable session alive for RESUME_GRACE_PERIOD_MS so the client
    // can reconnect and resume without a full re-identify. Mark expiry.
    this.resumableSessionExpiry.set(participantId, Date.now());
    this.persistResumableSessionExpiry();
    // Ensure the alarm keeps running to prune expired resumable sessions
    this.scheduleAlarm();

    this.broadcast(
      {
        op: Op.VoiceStateUpdate,
        d: {
          participant: this.buildVoiceState(session),
          action: "leave",
        },
      },
      ws
    );

    try { ws.close(1000, "Left room"); } catch { /* already closed */ }
  }

  // ── Clerk profile verification ─────────────────────────────────────────

  private async fetchClerkProfile(clerkUserId: string): Promise<{ name: string; avatarUrl?: string } | null> {
    try {
      // 1. Check D1 first for custom avatar (R2) and username
      let d1Name: string | null = null;
      let d1Avatar: string | null = null;    // R2 custom upload only
      let d1AnyAvatar: string | null = null; // Any stored avatar (incl. Clerk URL from ensureUser)
      try {
        const row = await this.env.DB.prepare(
          "SELECT username, avatar_url FROM users WHERE id = ?"
        ).bind(clerkUserId).first<{ username: string; avatar_url: string | null }>();
        if (row) {
          d1Name = row.username;
          d1AnyAvatar = row.avatar_url;
          // Only use D1 avatar if it's an R2 path (custom upload)
          if (row.avatar_url?.startsWith("/api/avatars/")) {
            d1Avatar = row.avatar_url;
          }
        }
      } catch (e) {
        console.error("[MeetingRoom] D1 profile fetch failed:", e);
      }

      // 2. Fetch from Clerk for fallback avatar / name
      const res = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
        headers: {
          Authorization: `Bearer ${this.env.CLERK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        console.error(`[MeetingRoom] Clerk API error: ${res.status}`);
        // If Clerk fails but D1 has data, use D1 (fall back to any stored avatar)
        if (d1Name) {
          return { name: d1Name, avatarUrl: d1Avatar ?? d1AnyAvatar ?? undefined };
        }
        return null;
      }
      const user = await res.json() as {
        username?: string;
        first_name?: string;
        last_name?: string;
        image_url?: string;
        unsafe_metadata?: { displayName?: string };
      };
      const clerkName = user.unsafe_metadata?.displayName
        || [user.first_name, user.last_name].filter(Boolean).join(" ")
        || user.username
        || "Guest";

      return {
        name: d1Name || clerkName,
        avatarUrl: d1Avatar ?? user.image_url,
      };
    } catch (err) {
      console.error("[MeetingRoom] Failed to fetch Clerk profile:", err);
      return null;
    }
  }

  // ── TURN credentials ──────────────────────────────────────────────────

  private async generateTurnCredentials(): Promise<IceServer[]> {
    const stun: IceServer = { urls: ["stun:stun.cloudflare.com:3478"] };

    if (!this.env.TURN_TOKEN_ID || !this.env.TURN_TOKEN_SECRET) return [stun];

    try {
      const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${this.env.TURN_TOKEN_ID}/credentials/generate-ice-servers`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.env.TURN_TOKEN_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: 86400 }),
      });

      if (!resp.ok) return [stun];

      const data = (await resp.json()) as {
        iceServers?: Array<{ urls?: string[]; username?: string; credential?: string }>;
      };

      if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) return [stun];

      const servers = data.iceServers
        .filter((s) => s.urls && s.urls.length > 0)
        .slice(0, 2)
        .map((s) => {
          // Firefox limits STUN/TURN servers to avoid discovery slowdowns.
          // Filter to only the most reliable transports: UDP 3478 and TCP/TLS 443
          const filteredUrls = (s.urls ?? []).filter(url =>
            url.includes(':3478?transport=udp') ||
            url.includes(':443?transport=tcp') ||
            url.startsWith('stun:') // Keep basic STUN
          );

          return {
            urls: filteredUrls.length > 0 ? filteredUrls : (s.urls ?? []).slice(0, 2),
            username: s.username,
            credential: s.credential,
          };
        });

      console.log(`[MeetingRoom] Generated TURN credentials, count=${servers.length}, flatUrls=${servers.flatMap(s => s.urls).length}`);
      return servers.length > 0 ? servers : [stun];
    } catch {
      console.warn(`[MeetingRoom] Failed generating TURN credentials, falling back to STUN`);
      return [stun];
    }
  }

  // ── Utilities ─────────────────────────────────────────────────────────

  private sendTo(ws: WebSocket, msg: ServerMsg) {
    try { ws.send(JSON.stringify(msg)); } catch { /* closed */ }
  }

  private broadcast(msg: ServerMsg, excludeWs?: WebSocket) {
    const json = JSON.stringify(msg);
    for (const [ws, session] of this.sessions) {
      if (ws === excludeWs) continue;

      // Store in replay buffer for this participant
      let buffer = this.replayBuffers.get(session.id);
      if (!buffer) {
        buffer = [];
        this.replayBuffers.set(session.id, buffer);
      }
      buffer.push({ seq: session.seq, msg });
      if (buffer.length > MeetingRoom.MAX_REPLAY_BUFFER) {
        buffer.shift();
      }

      try { ws.send(json); } catch { /* skip dead */ }
    }
  }

  /** Send a message to all clients subscribed to a specific channel */
  private broadcastToChannel(channelId: string, msg: ServerMsg, excludeWs?: WebSocket) {
    const subscribers = this.channelSubscriptions.get(channelId);
    if (!subscribers) return;

    const json = JSON.stringify(msg);
    for (const ws of subscribers) {
      if (ws === excludeWs) continue;
      try { ws.send(json); } catch { /* skip dead */ }
    }
  }

  /** Send a message to all sessions that are members of a server */
  private broadcastToServerMembers(serverId: string, msg: ServerMsg, excludeWs?: WebSocket) {
    const subscribers = this.serverSubscriptions.get(serverId);
    if (!subscribers) return;

    const json = JSON.stringify(msg);
    for (const ws of subscribers) {
      if (ws === excludeWs) continue;
      try { ws.send(json); } catch { /* skip dead */ }
    }
  }

  /** Send a message to all sessions of a specific user */
  private broadcastToUser(userId: string, msg: ServerMsg) {
    const json = JSON.stringify(msg);
    let count = 0;
    for (const [ws, session] of this.sessions) {
      if (session.clerk_user_id === userId) {
        try {
          ws.send(json);
          count++;
        } catch { /* skip dead */ }
      }
    }
    console.log(`[MainGW] broadcastToUser ${userId}: sent to ${count} sessions`);
  }

  // ── Op 27: ChannelSubscribe ───────────────────────────────────────────

  private handleChannelSubscribe(ws: WebSocket, d: { channel_id: string }) {
    const session = this.requireSession(ws);
    if (!session || !d.channel_id) return;

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

    // Send PRESENCE_LIST to the subscribing client — all online clerk user IDs
    const onlineUserIds = new Set<string>();
    for (const [, sess] of this.sessions) {
      if (sess.clerk_user_id) {
        onlineUserIds.add(sess.clerk_user_id);
      }
    }
    this.sendTo(ws, {
      op: Op.Dispatch,
      d: {
        event: "PRESENCE_LIST",
        data: { user_ids: Array.from(onlineUserIds) },
      },
    });

    // Send current voice channel states to the subscribing client
    const voiceStates: Record<string, VoiceChannelMember[]> = {};
    const voiceStartedAt: Record<string, number> = {};
    for (const [channelId, members] of this.voiceChannelMembers) {
      if (members.size > 0) {
        voiceStates[channelId] = Array.from(members.values());
        const startedAt = this.voiceChannelStartedAt.get(channelId);
        if (startedAt) {
          voiceStartedAt[channelId] = startedAt;
        }
      }
    }
    if (Object.keys(voiceStates).length > 0) {
      this.sendTo(ws, {
        op: Op.Dispatch,
        d: {
          event: "VOICE_CHANNEL_STATES",
          data: { voice_states: voiceStates, voice_started_at: voiceStartedAt },
        },
      });
    }

    console.log(`[MainGW] ${session.name} subscribed to channel ${d.channel_id}`);
  }

  // ── Op 28: ChannelUnsubscribe ─────────────────────────────────────────

  private handleChannelUnsubscribe(ws: WebSocket, d: { channel_id: string }) {
    const session = this.requireSession(ws);
    if (!session || !d.channel_id) return;

    const subs = this.channelSubscriptions.get(d.channel_id);
    if (subs) {
      subs.delete(ws);
      if (subs.size === 0) this.channelSubscriptions.delete(d.channel_id);
    }

    session.subscribed_channels = session.subscribed_channels.filter(
      (id) => id !== d.channel_id
    );
    this.persist(ws, session);
  }

  // ── Op 33: VoiceChannelJoin ────────────────────────────────────────────

  private handleVoiceChannelJoin(
    ws: WebSocket,
    d: { channel_id: string; self_mute?: boolean }
  ) {
    const session = this.requireSession(ws);
    if (!session || !d.channel_id || !session.clerk_user_id) return;

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
        this.broadcast({
          op: Op.Dispatch,
          d: {
            event: "VOICE_CHANNEL_STATE_UPDATE",
            data: {
              channel_id: d.channel_id,
              members: Array.from(members.values()),
              started_at: this.voiceChannelStartedAt.get(d.channel_id) ?? null,
            },
          },
        });
        this.persistVoiceChannelMembers();
      }
      return;
    }

    // Add to new voice channel
    session.voice_channel_id = d.channel_id;
    session.self_video = false;
    session.self_stream = false;
    this.persist(ws, session);

    let members = this.voiceChannelMembers.get(d.channel_id);
    if (!members) {
      members = new Map();
      this.voiceChannelMembers.set(d.channel_id, members);
      // First member — record channel start time
      this.voiceChannelStartedAt.set(d.channel_id, Date.now());
      this.persistVoiceChannelStartedAt();
    }

    const member: VoiceChannelMember = {
      clerk_user_id: session.clerk_user_id,
      name: session.name,
      avatar_url: session.avatar_url,
      self_mute: d.self_mute ?? true,
      self_deaf: session.self_deaf,
      self_video: session.self_video,
      self_stream: session.self_stream,
      self_stream_audio: session.self_stream_audio,
    };
    members.set(session.clerk_user_id, member);

    // Broadcast to all clients
    this.broadcast({
      op: Op.Dispatch,
      d: {
        event: "VOICE_CHANNEL_STATE_UPDATE",
        data: {
          channel_id: d.channel_id,
          members: Array.from(members.values()),
          started_at: this.voiceChannelStartedAt.get(d.channel_id) ?? null,
        },
      },
    });

    // Persist to storage for hibernation resilience
    this.persistVoiceChannelMembers();

    // --- IMPLICIT CALL ACCEPT ---
    // If the callee manually joins the voice channel instead of hitting "Accept",
    // we should treat the call as accepted and stop the ringing.
    const pending = this.pendingCalls.get(session.clerk_user_id);
    if (pending && pending.channelId === d.channel_id) {
      console.log(`[MainGW] ${session.name} manually joined ringing DM, implicitly accepting call ${pending.callId}`);

      const callIdToCache = pending.callId;
      clearTimeout(pending.timeout);
      this.pendingCalls.delete(session.clerk_user_id);

      // Cache the accepted call to avoid race conditions with a late Op 37 (CallAccept)
      this.acceptedCalls.add(callIdToCache);
      setTimeout(() => this.acceptedCalls.delete(callIdToCache), 10000);

      const evt = { op: Op.Dispatch, d: { event: "CALL_RING_STOP", data: { call_id: callIdToCache, reason: "accepted" } } };
      this.broadcastToUser(pending.callerId, evt);
      this.broadcastToUser(pending.calleeId, evt);
    }

    console.log(`[MainGW] ${session.name} joined voice channel ${d.channel_id}`);
  }

  // ── Op 34: VoiceChannelLeave ───────────────────────────────────────────

  private handleVoiceChannelLeave(ws: WebSocket, d?: { channel_id?: string }) {
    const session = this.requireSession(ws);
    if (!session) return;

    // Protection against race conditions (e.g., leaving a previous channel after
    // already successfully connecting to a new one or initiating a call).
    if (d?.channel_id && session.voice_channel_id && session.voice_channel_id !== d.channel_id) {
      console.log(`[MainGW] Ignored stale VoiceChannelLeave for ${d.channel_id}; currently in ${session.voice_channel_id}`);
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
        // Channel is now empty — clear the started_at timestamp
        this.voiceChannelStartedAt.delete(channelId);
        this.persistVoiceChannelStartedAt();
      }
    }

    // Broadcast updated state (even if empty — so clients know the channel is empty)
    this.broadcast({
      op: Op.Dispatch,
      d: {
        event: "VOICE_CHANNEL_STATE_UPDATE",
        data: {
          channel_id: channelId,
          members: members ? Array.from(members.values()) : [],
          started_at: this.voiceChannelStartedAt.get(channelId) ?? null,
        },
      },
    });

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
        console.log(`[MainGW] DM Call ${abandonedPendingCall.callId} emptied during ring, cancelling pending...`);
        clearTimeout(abandonedPendingCall.timeout);
        this.pendingCalls.delete(abandonedPendingCall.calleeId);

        // Tell both parties the ring stopped
        const endMsg = { op: Op.Dispatch, d: { event: "CALL_RING_STOP", data: { call_id: abandonedPendingCall.callId, reason: "abandoned" } } };
        this.broadcastToUser(abandonedPendingCall.callerId, endMsg);
        this.broadcastToUser(abandonedPendingCall.calleeId, endMsg);
      }
    }

    // Persist to storage for hibernation resilience
    this.persistVoiceChannelMembers();

    console.log(`[MainGW] ${session.name} left voice channel ${channelId}`);
  }


  private async handleMessageCreate(
    ws: WebSocket,
    d: { channel_id: string; content: string; reply_to_id?: string; nonce?: string }
  ) {
    const session = this.requireSession(ws);
    if (!session || !d.channel_id || !d.content) return;

    const messageId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Persist to D1
    try {
      await this.env.DB.prepare(
        `INSERT INTO messages (id, channel_id, author_id, content, reply_to_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(messageId, d.channel_id, session.clerk_user_id ?? session.id, d.content, d.reply_to_id ?? null, now)
        .run();
    } catch (err) {
      console.error("[MainGW] Failed to insert message:", err);
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
      author_id: session.clerk_user_id ?? session.id,
      author: {
        id: session.clerk_user_id ?? session.id,
        username: session.name,
        avatar_url: session.avatar_url,
      },
      content: d.content,
      reply_to_id: d.reply_to_id,
      is_pinned: false,
      created_at: now,
      nonce: d.nonce,
      attachments: [],
      reactions: [],
    };

    // Dispatch to all subscribers of this channel (including sender for confirmation)
    this.broadcastToChannel(d.channel_id, {
      op: Op.Dispatch,
      d: { event: "MESSAGE_CREATE", data: message },
    });

    // Asynchronously fetch embeds without blocking the initial send
    this.ctx.waitUntil((async () => {
      const embeds = await extractAndProcessEmbeds(d.content);
      if (embeds.length > 0) {
        try {
          // Store embeds in the database
          await this.env.DB.prepare(
            `UPDATE messages SET embeds = ? WHERE id = ?`
          ).bind(JSON.stringify(embeds), messageId).run();

          // Dispatch update event to clients
          this.broadcastToChannel(d.channel_id, {
            op: Op.Dispatch,
            d: {
              event: "MESSAGE_UPDATE",
              data: {
                id: messageId,
                channel_id: d.channel_id,
                embeds: embeds
              }
            }
          });
        } catch (e) {
          console.error("[MainGW] Failed to update message with embeds:", e);
        }
      }
    })());
  }

  // ── Op 21: MessageUpdate ──────────────────────────────────────────────

  private async handleMessageUpdate(
    ws: WebSocket,
    d: { message_id: string; content: string }
  ) {
    const session = this.requireSession(ws);
    if (!session || !d.message_id || !d.content) return;

    const now = new Date().toISOString();
    const authorId = session.clerk_user_id ?? session.id;

    // Only allow editing own messages
    try {
      const result = await this.env.DB.prepare(
        `UPDATE messages SET content = ?, updated_at = ?
         WHERE id = ? AND author_id = ?`
      )
        .bind(d.content, now, d.message_id, authorId)
        .run();

      if (!result.meta.changes || result.meta.changes === 0) {
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: 4004, message: "Message not found or not owner" },
        });
        return;
      }
    } catch (err) {
      console.error("[MainGW] Failed to update message:", err);
      return;
    }

    // Look up channel_id for the message to dispatch
    const row = await this.env.DB.prepare(
      `SELECT channel_id FROM messages WHERE id = ?`
    ).bind(d.message_id).first<{ channel_id: string }>();

    if (row) {
      this.broadcastToChannel(row.channel_id, {
        op: Op.Dispatch,
        d: {
          event: "MESSAGE_UPDATE",
          data: {
            id: d.message_id,
            channel_id: row.channel_id,
            content: d.content,
            updated_at: now,
          },
        },
      });

      // Asynchronously fetch new embeds if content changed
      this.ctx.waitUntil((async () => {
        const embeds = await extractAndProcessEmbeds(d.content);
        if (embeds.length > 0) {
          try {
            await this.env.DB.prepare(
              `UPDATE messages SET embeds = ? WHERE id = ?`
            ).bind(JSON.stringify(embeds), d.message_id).run();

            this.broadcastToChannel(row.channel_id, {
              op: Op.Dispatch,
              d: {
                event: "MESSAGE_UPDATE",
                data: {
                  id: d.message_id,
                  channel_id: row.channel_id,
                  embeds: embeds
                }
              }
            });
          } catch (e) {
            console.error("[MainGW] Failed to update message with new embeds:", e);
          }
        }
      })());
    }
  }

  // ── Op 22: MessageDelete ──────────────────────────────────────────────

  private async handleMessageDelete(
    ws: WebSocket,
    d: { message_id: string; channel_id: string }
  ) {
    const session = this.requireSession(ws);
    if (!session || !d.message_id || !d.channel_id) return;

    const authorId = session.clerk_user_id ?? session.id;

    try {
      // Delete only if author (or could add server admin check later)
      const result = await this.env.DB.prepare(
        `DELETE FROM messages WHERE id = ? AND author_id = ?`
      )
        .bind(d.message_id, authorId)
        .run();

      if (!result.meta.changes || result.meta.changes === 0) {
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: 4004, message: "Message not found or not owner" },
        });
        return;
      }
    } catch (err) {
      console.error("[MainGW] Failed to delete message:", err);
      return;
    }

    this.broadcastToChannel(d.channel_id, {
      op: Op.Dispatch,
      d: {
        event: "MESSAGE_DELETE",
        data: { id: d.message_id, channel_id: d.channel_id },
      },
    });
  }

  // ── Op 23: TypingStart ────────────────────────────────────────────────

  private handleTypingStart(ws: WebSocket, d: { channel_id: string }) {
    const session = this.requireSession(ws);
    if (!session || !d.channel_id) return;

    this.broadcastToChannel(
      d.channel_id,
      {
        op: Op.Dispatch,
        d: {
          event: "TYPING_START",
          data: {
            channel_id: d.channel_id,
            user_id: session.clerk_user_id ?? session.id,
            username: session.name,
            timestamp: Date.now(),
          },
        },
      },
      ws // exclude sender
    );
  }

  // ── Op 24: ReactionAdd ────────────────────────────────────────────────

  private async handleReactionAdd(
    ws: WebSocket,
    d: { channel_id: string; message_id: string; emoji: string }
  ) {
    const session = this.requireSession(ws);
    if (!session || !d.channel_id || !d.message_id || !d.emoji) return;

    const userId = session.clerk_user_id ?? session.id;
    const now = new Date().toISOString();

    try {
      await this.env.DB.prepare(
        `INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji, created_at)
         VALUES (?, ?, ?, ?)`
      )
        .bind(d.message_id, userId, d.emoji, now)
        .run();
    } catch (err) {
      console.error("[MainGW] Failed to add reaction:", err);
      return;
    }

    this.broadcastToChannel(d.channel_id, {
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
    d: { channel_id: string; message_id: string; emoji: string }
  ) {
    const session = this.requireSession(ws);
    if (!session || !d.channel_id || !d.message_id || !d.emoji) return;

    const userId = session.clerk_user_id ?? session.id;

    try {
      await this.env.DB.prepare(
        `DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?`
      )
        .bind(d.message_id, userId, d.emoji)
        .run();
    } catch (err) {
      console.error("[MainGW] Failed to remove reaction:", err);
      return;
    }

    this.broadcastToChannel(d.channel_id, {
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
    if (!session || !d.server_id || !session.clerk_user_id) return;

    // Already subscribed?
    if (session.subscribed_servers?.includes(d.server_id)) return;

    // Validate membership against D1
    try {
      const row = await this.env.DB.prepare(
        "SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?"
      ).bind(d.server_id, session.clerk_user_id).first();

      if (!row) {
        console.log(`[MainGW] ServerSubscribe denied: ${session.name} is not member of ${d.server_id}`);
        return;
      }
    } catch (e) {
      console.error(`[MainGW] ServerSubscribe D1 error:`, e);
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

    console.log(`[MainGW] ${session.name} subscribed to server ${d.server_id}`);
  }

  // ── Op 36: CallInitiate ──────────────────────────────────────────────

  private async handleCallInitiate(
    ws: WebSocket,
    d: { target_user_id: string; channel_id: string }
  ) {
    const session = this.requireSession(ws);
    if (!session || !session.clerk_user_id || !d.target_user_id || !d.channel_id) return;

    const callerId = session.clerk_user_id;
    const calleeId = d.target_user_id;

    // Self-call prevention
    if (callerId === calleeId) {
      this.sendTo(ws, {
        op: Op.Dispatch,
        d: { event: "CALL_RING_STOP", data: { call_id: null, reason: "invalid" } },
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
        "SELECT type FROM relationships WHERE user_id = ? AND target_user_id = ?"
      ).bind(calleeId, callerId).first<{ type: number }>();
      if (rel?.type === 1) {
        // Blocked — silently fail
        this.sendTo(ws, {
          op: Op.Dispatch,
          d: { event: "CALL_RING_STOP", data: { call_id: null, reason: "unavailable" } },
        });
        return;
      }
    } catch (e) {
      console.error("[MainGW] Call relationship check failed:", e);
    }

    // Check callee is online — at least one session exists
    let calleeOnline = false;
    let calleeName: string | undefined;
    let calleeAvatar: string | undefined;
    for (const [, sess] of this.sessions) {
      if (sess.clerk_user_id === calleeId) {
        calleeOnline = true;
        calleeName = sess.name;
        calleeAvatar = sess.avatar_url;
        break;
      }
    }
    if (!calleeOnline) {
      this.sendTo(ws, {
        op: Op.Dispatch,
        d: { event: "CALL_RING_STOP", data: { call_id: null, reason: "unavailable" } },
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
          d: { event: "CALL_RING_STOP", data: { call_id: callId, reason: "timeout" } },
        });
        // Tell the callee the ringing timed out
        this.broadcastToUser(calleeId, {
          op: Op.Dispatch,
          d: { event: "CALL_RING_STOP", data: { call_id: callId, reason: "timeout" } },
        });
        console.log(`[MainGW] Call ${callId} ring timed out (caller stays in voice channel)`);
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
      callerAvatar: session.avatar_url,
      calleeName,
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
          callee_avatar: calleeAvatar,
          channel_id: d.channel_id,
        },
      },
    });

    console.log(`[MainGW] Call initiated: ${callId}, ${session.name} → ${calleeName}`);
  }

  // ── Op 37: CallAccept ────────────────────────────────────────────────

  private handleCallAccept(ws: WebSocket, d: { call_id: string }) {
    const session = this.requireSession(ws);
    if (!session || !session.clerk_user_id || !d.call_id) return;

    const calleeId = session.clerk_user_id;

    if (this.acceptedCalls.has(d.call_id)) {
      console.log(`[MainGW] Ignored Op 37 for ${d.call_id} — call was already implicitly/recently accepted.`);
      return;
    }

    const pending = this.pendingCalls.get(calleeId);
    if (!pending || pending.callId !== d.call_id) {
      // If we are already in the correct voice channel but there's no pending call,
      // it might have been implicitly accepted and timed out of acceptedCalls cache.
      // But just to be safe, we just send "expired" if we really can't find it.
      this.sendTo(ws, {
        op: Op.Dispatch,
        d: { event: "CALL_RING_STOP", data: { call_id: d.call_id, reason: "expired" } },
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
      d: { event: "CALL_RING_STOP", data: { call_id: pending.callId, reason: "accepted" } },
    });
    this.broadcastToUser(pending.calleeId, {
      op: Op.Dispatch,
      d: { event: "CALL_RING_STOP", data: { call_id: pending.callId, reason: "accepted" } },
    });

    console.log(`[MainGW] Call accepted: ${pending.callId}`);
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
      d: { event: "CALL_RING_STOP", data: { call_id: pending.callId, reason: "declined" } },
    });
    this.broadcastToUser(pending.calleeId, {
      op: Op.Dispatch,
      d: { event: "CALL_RING_STOP", data: { call_id: pending.callId, reason: "declined" } },
    });

    console.log(`[MainGW] Call declined: ${pending.callId}`);
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
        d: { event: "CALL_RING_STOP", data: { call_id: pending.callId, reason: "cancelled" } },
      });
      this.broadcastToUser(pending.callerId, {
        op: Op.Dispatch,
        d: { event: "CALL_RING_STOP", data: { call_id: pending.callId, reason: "cancelled" } },
      });
      console.log(`[MainGW] Call cancelled by caller: ${pending.callId}`);
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
    console.log(`[MainGW] cleanupCallsForUser(${userId}, ${reason}): pendingCalls.size=${this.pendingCalls.size}`);

    // Clean up pending calls (as callee)
    const pendingAsCallee = this.pendingCalls.get(userId);
    if (pendingAsCallee) {
      console.log(`[MainGW] Cleaning up pending call as callee: callId=${pendingAsCallee.callId}`);
      clearTimeout(pendingAsCallee.timeout);
      this.pendingCalls.delete(userId);
      this.broadcastToUser(pendingAsCallee.callerId, {
        op: Op.Dispatch,
        d: { event: "CALL_RING_STOP", data: { call_id: pendingAsCallee.callId, reason } },
      });
    }

    // Clean up pending calls (as caller)
    for (const [calleeId, call] of this.pendingCalls) {
      if (call.callerId === userId) {
        console.log(`[MainGW] Cleaning up pending call as caller: callId=${call.callId}`);
        clearTimeout(call.timeout);
        this.pendingCalls.delete(calleeId);
        this.broadcastToUser(calleeId, {
          op: Op.Dispatch,
          d: { event: "CALL_RING_STOP", data: { call_id: call.callId, reason } },
        });
      }
    }

    // Active calls purely live in voice channel presence now, and `handleLeave`
    // natively removes users from `voiceChannelMembers`. We don't need any more manually teardown logic!
    console.log(`[MainGW] cleanupCallsForUser done.`);
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

    const member: VoiceChannelMember = {
      clerk_user_id: session.clerk_user_id,
      name: session.name,
      avatar_url: session.avatar_url,
      self_mute: session.self_mute,
      self_deaf: session.self_deaf,
      self_video: session.self_video,
      self_stream: session.self_stream,
      self_stream_audio: session.self_stream_audio,
    };
    members.set(session.clerk_user_id, member);

    // Broadcast to all clients
    this.broadcast({
      op: Op.Dispatch,
      d: {
        event: "VOICE_CHANNEL_STATE_UPDATE",
        data: {
          channel_id: channelId,
          members: Array.from(members.values()),
          started_at: this.voiceChannelStartedAt.get(channelId) ?? null,
        },
      },
    });

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
