// ============================================================================
// VoiceRoom — Cloudflare Durable Object for WebRTC media signaling
//
// Discord-style Voice Gateway: handles media-related opcodes only.
// SelectProtocol, SessionDescription, Video, StopTracks, Answer.
// Separate from MeetingRoom (Main Gateway) which handles presence/state.
//
// Clients authenticate via voice_token issued by MeetingRoom on Identify.
// ============================================================================

import { DurableObject } from "cloudflare:workers";
import { clog } from "../src/lib/console-logger";
import { decideFailedPublisherSessionEviction } from "../src/lib/voice/sfu-publisher-eviction";
import { getNextVoicePresenceAlarmTime } from "../src/lib/voice-presence";

const log = clog("VoiceGW");
const roomLog = clog("VoiceRoom");
const sfuLog = clog("VoiceRoom:SFU");

interface Env {
  CALLS_APP_ID: string;
  CALLS_APP_SECRET: string;
  TURN_TOKEN_ID: string;
  TURN_TOKEN_SECRET: string;
}

// ── Opcodes (voice-specific subset) ─────────────────────────────────────────

const enum Op {
  SelectProtocol = 1,
  Heartbeat = 3,
  SessionDescription = 4,
  Speaking = 5,
  HeartbeatACK = 6,
  Hello = 8,
  Resumed = 9,
  NegotiationDone = 10,
  ClientDisconnect = 11,
  Video = 12,
  StopTracks = 13,
  Answer = 14,
  Error = 18,

  // Voice-specific: authenticate with token from Main GW
  VoiceIdentify = 100,
  VoiceReady = 101,
  // C->S: Publisher confirms push negotiation complete
  TracksReady = 102,
  // C->S: Update simulcast layer on already-pulled tracks (no re-negotiation)
  TrackUpdate = 103,
  // C->S: Request ICE restart on existing SFU session (network path change)
  IceRestart = 104,
  // C->S: Forget this participant's pull session before client rebuilds pull PC
  ResetPullSession = 105,
  VoiceAppEvent = 106,
}

const enum CloseCode {
  UnknownOpcode = 4001,
  NotAuthenticated = 4003,
  AlreadyAuthenticated = 4005,
  AuthenticationFailed = 4004,
}

// ── Interfaces ──────────────────────────────────────────────────────────────

interface TrackInfo {
  participant_id: string;
  track_name: string;
  session_id: string;
  mid?: string;
  kind: "audio" | "video";
  rid?: string;
}

interface PushTrackDescriptor {
  track_name: string;
  mid?: string;
  kind: "audio" | "video";
}

interface GatewayMessage {
  op: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  d: any;
}

type ServerMsg = GatewayMessage;

interface DemoChatGifPayload {
  url: string;
  content_type: "image/gif" | "video/mp4";
  title?: string;
  source_url?: string;
  provider?: "klipy" | "tenor";
  width?: number;
  height?: number;
}

interface DemoChatMessage {
  id: string;
  participant_id: string;
  author_name: string;
  content: string;
  gif?: DemoChatGifPayload;
  created_at: number;
  expires_at: number;
}

// WebSocket attachment for voice sessions
interface VoiceAttachment {
  participant_id: string; // The only thing that needs to live in the socket instance
}

// ── Constants ───────────────────────────────────────────────────────────────

const VOICE_HEARTBEAT_INTERVAL_MS = 15_000;
const VOICE_ZOMBIE_TIMEOUT_MS = VOICE_HEARTBEAT_INTERVAL_MS * 6;
const VOICE_PRUNE_ALARM_INTERVAL_MS = 300_000;
const VOICE_RECONNECT_GRACE_MS = 30_000;
const DEMO_CHAT_TTL_MS = 10 * 60 * 1000;
const DEMO_CHAT_MAX_MESSAGES = 75;
const DEMO_CHAT_MAX_CONTENT_LENGTH = 1_000;

// ── VoiceRoom Durable Object ────────────────────────────────────────────────

export class VoiceRoom extends DurableObject<Env> {
  public ctx: DurableObjectState;
  public env: Env;
  private sql: SqlStorage;
  private roomSlug: string = "";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.sql = this.ctx.storage.sql;

    // Removed setWebSocketAutoResponse.
    // Cloudflare's auto-response absorbs messages at the edge, preventing the DO
    // from updating the `last_heartbeat` timestamp in SQLite, which causes the
    // zombie pruning alarm to falsely evict active users after 90 seconds.

    this.initSchema();
    this.scheduleAlarm();

    // Ensure roomSlug is loaded BEFORE any message processing.
    // Using blockConcurrencyWhile prevents a race where a webSocketMessage
    // arrives before the async storage read completes.
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<string>("roomSlug");
      if (stored) this.roomSlug = stored;
    });
  }

  private initSchema() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS participants (
        id TEXT PRIMARY KEY,
        clerk_user_id TEXT,
        push_session_cam TEXT,
        push_session_screen TEXT,
        pull_session_id TEXT,
        last_heartbeat INTEGER DEFAULT 0,
        speaking INTEGER DEFAULT 0
      );
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS pending_reconnects (
        participant_id TEXT PRIMARY KEY,
        disconnected_at INTEGER NOT NULL
      );
    `);

    // is_pending = 1 means it's in "pending_broadcast", waiting for TracksReady
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS tracks (
        track_name TEXT PRIMARY KEY,
        participant_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        mid TEXT,
        kind TEXT NOT NULL,
        is_pending INTEGER NOT NULL DEFAULT 0
      );
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS demo_chat_messages (
        id TEXT PRIMARY KEY,
        participant_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        content TEXT NOT NULL,
        gif_json TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS stream_watchers (
        streamer_user_id TEXT NOT NULL,
        viewer_user_id TEXT NOT NULL,
        streamer_participant_id TEXT NOT NULL,
        viewer_participant_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (streamer_user_id, viewer_user_id)
      );
    `);

    // Indexes for common query paths — CREATE INDEX IF NOT EXISTS is idempotent
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_tracks_participant ON tracks(participant_id);`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_tracks_session ON tracks(session_id);`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_tracks_name_pid ON tracks(track_name, participant_id);`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_demo_chat_expires ON demo_chat_messages(expires_at);`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_demo_chat_created ON demo_chat_messages(created_at);`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_stream_watchers_streamer ON stream_watchers(streamer_user_id);`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_stream_watchers_viewer ON stream_watchers(viewer_user_id);`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_stream_watchers_streamer_pid ON stream_watchers(streamer_participant_id);`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_stream_watchers_viewer_pid ON stream_watchers(viewer_participant_id);`);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const gatewayVersion = parseInt(url.searchParams.get("v") ?? "1", 10);

    const match = url.pathname.match(/\/api\/(?:channels|room)\/([^/]+)\/voice/);
    if (match) {
      this.roomSlug = match[1];
      this.ctx.storage.put("roomSlug", this.roomSlug).catch(() => { });
    }

    if (url.pathname.endsWith("/voice")) {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);

      log.info(`New connection, gateway_version=${gatewayVersion}`);

      this.sendTo(server, {
        op: Op.Hello,
        d: { heartbeat_interval: VOICE_HEARTBEAT_INTERVAL_MS, gateway_version: gatewayVersion },
      });

      return new Response(null, { status: 101, webSocket: client } as any);
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, rawMsg: string | ArrayBuffer) {
    if (typeof rawMsg !== "string") return;

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
      case Op.VoiceIdentify:
        await this.handleVoiceIdentify(ws, msg.d);
        break;

      case Op.Heartbeat:
        this.handleHeartbeat(ws, msg.d);
        break;

      case Op.SelectProtocol:
        await this.handleSelectProtocol(ws, msg.d);
        break;

      case Op.Video:
        await this.handleVideo(ws, msg.d);
        break;

      case Op.StopTracks:
        await this.handleStopTracks(ws, msg.d);
        break;

      case Op.Answer:
        await this.handleAnswer(ws, msg.d);
        break;

      case Op.TracksReady:
        this.handleTracksReady(ws, msg.d);
        break;

      case Op.Speaking:
        this.handleSpeaking(ws, msg.d);
        break;

      case Op.ClientDisconnect:
        await this.handleLeave(ws, true);
        break;

      case Op.TrackUpdate:
        await this.handleTrackUpdate(ws, msg.d);
        break;

      case Op.IceRestart:
        await this.handleIceRestart(ws, msg.d);
        break;

      case Op.ResetPullSession:
        this.handleResetPullSession(ws);
        break;

      case Op.VoiceAppEvent:
        this.handleVoiceAppEvent(ws, msg.d);
        break;

      default:
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: CloseCode.UnknownOpcode, message: `Unknown voice opcode: ${msg.op}` },
        });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      await this.handleLeave(ws, false, false);
    } catch (e) {
      roomLog.error(`webSocketClose(${code}) threw in handleLeave:`, e);
    }
    try { ws.close(code, reason); } catch { /* already closed */ }
  }

  async webSocketError(ws: WebSocket) {
    try {
      await this.handleLeave(ws, false, false);
    } catch (e) {
      roomLog.error(`webSocketError threw in handleLeave:`, e);
    }
  }

  // ── Alarm: voice zombie pruning ───────────────────────────────────────

  async alarm() {
    const now = Date.now();
    const zombies: string[] = [];
    let didChangeStreamWatchers = false;

    this.pruneDemoChatMessages(now);

    // Check active participants for zombie timeouts using SQLite
    const participants = this.sql.exec(`SELECT id, last_heartbeat FROM participants`);

    for (const row of participants) {
      const pid = row.id as string;
      let lastActivity = (row.last_heartbeat as number) || 0;

      const ws = this.getWsByParticipant(pid);

      if (lastActivity && now - lastActivity >= VOICE_ZOMBIE_TIMEOUT_MS) {
        log.info(`Pruning zombie: ${pid}, last_activity=${Math.round((now - lastActivity) / 1000)}s ago`);
        zombies.push(pid);
      }
    }

    for (const pid of zombies) {
      const ws = this.getWsByParticipant(pid);
      if (ws) {
        await this.handleLeave(ws, false, true);
      } else {
        await this.disconnectParticipant(pid, false);
      }
    }

    // Prune pending reconnects whose grace period expired
    const pending = this.sql.exec(`SELECT participant_id, disconnected_at FROM pending_reconnects`);
    for (const row of pending) {
      const pid = row.participant_id as string;
      const disconnectedAt = row.disconnected_at as number;

      if (now - disconnectedAt >= VOICE_RECONNECT_GRACE_MS) {
        roomLog.info(`Grace period expired for ${pid}, cleaning up SFU`);
        await this.cleanupSfuSessionsByParticipantId(pid);

        // Broadcast StopTracks logic
        const tracksCursor = this.sql.exec(`SELECT track_name FROM tracks WHERE participant_id = ?`, pid);
        const trackNames = [...tracksCursor].map(r => r.track_name as string);
        if (trackNames.length > 0) {
          this.broadcast({
            op: Op.StopTracks,
            d: { participant_id: pid, track_names: trackNames },
          });
        }

        // Final DB cleanup
        didChangeStreamWatchers = this.clearStreamWatchersByParticipantId(pid) || didChangeStreamWatchers;
        this.sql.exec(`DELETE FROM pending_reconnects WHERE participant_id = ?`, pid);
        this.sql.exec(`DELETE FROM tracks WHERE participant_id = ?`, pid);
        this.sql.exec(`DELETE FROM participants WHERE id = ?`, pid);
      }
    }

    // Garbage-collect pending tracks from participants that went zombie
    // (is_pending = 1 means TracksReady was never received — publisher crashed)
    this.sql.exec(
      `DELETE FROM tracks WHERE is_pending = 1 AND participant_id NOT IN (SELECT id FROM participants)`
    );
    const pendingZombie = this.sql.exec(
      `DELETE FROM tracks WHERE is_pending = 1 AND participant_id IN (
        SELECT id FROM participants WHERE last_heartbeat > 0 AND last_heartbeat < ?
      ) RETURNING track_name, participant_id`,
      now - VOICE_ZOMBIE_TIMEOUT_MS
    );
    for (const row of pendingZombie) {
      log.info(`GC pending track: ${row.track_name} from ${row.participant_id}`);
    }

    // SFU session health check — validate pull sessions are still alive
    // Run every cycle to detect 410'd sessions quickly
    this.ctx.waitUntil(this.validateSfuSessions());

    if (didChangeStreamWatchers) {
      this.broadcastStreamWatcherSnapshot();
    }

    // If anyone remains, reschedule alarm
    const countRow = [...this.sql.exec(`SELECT COUNT(*) as c FROM participants`)][0];
    const c1 = countRow.c as number;
    const pendingCountRow = [...this.sql.exec(`SELECT COUNT(*) as c FROM pending_reconnects`)][0];
    const c2 = pendingCountRow.c as number;
    const demoChatCountRow = [...this.sql.exec(`SELECT COUNT(*) as c FROM demo_chat_messages`)][0];
    const c3 = demoChatCountRow.c as number;

    if (c1 > 0 || c2 > 0 || c3 > 0) {
      this.scheduleAlarm();
    }
  }

  private getNextAlarmTime(now: number) {
    const deadlines: number[] = [];

    for (const row of this.sql.exec(`SELECT last_heartbeat FROM participants WHERE last_heartbeat > 0`)) {
      deadlines.push((row.last_heartbeat as number) + VOICE_ZOMBIE_TIMEOUT_MS);
    }
    for (const row of this.sql.exec(`SELECT disconnected_at FROM pending_reconnects`)) {
      deadlines.push((row.disconnected_at as number) + VOICE_RECONNECT_GRACE_MS);
    }
    for (const row of this.sql.exec(`SELECT MIN(expires_at) as expires_at FROM demo_chat_messages`)) {
      if (row.expires_at) deadlines.push(row.expires_at as number);
    }

    return getNextVoicePresenceAlarmTime(now, VOICE_PRUNE_ALARM_INTERVAL_MS, deadlines);
  }

  private scheduleAlarm() {
    const now = Date.now();
    const nextAlarm = this.getNextAlarmTime(now);

    this.ctx.storage.getAlarm().then((currentAlarm) => {
      if (currentAlarm === null || currentAlarm <= now || nextAlarm < currentAlarm) {
        return this.ctx.storage.setAlarm(nextAlarm);
      }
    }).catch(() => { });
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private getWsByParticipant(participantId: string): WebSocket | undefined {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as VoiceAttachment | null;
      if (attachment?.participant_id === participantId) {
        return ws;
      }
    }
    return undefined;
  }

  private getParticipantId(ws: WebSocket): string | undefined {
    const attachment = ws.deserializeAttachment() as VoiceAttachment | null;
    return attachment?.participant_id;
  }

  private requireParticipantId(ws: WebSocket): string | null {
    const pid = this.getParticipantId(ws);
    if (!pid) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.NotAuthenticated, message: "Not identified on voice" },
      });
      return null;
    }
    return pid;
  }

  private getUserIdForParticipant(participantId: string): string | null {
    const rows = [...this.sql.exec("SELECT clerk_user_id FROM participants WHERE id = ?", participantId)];
    if (rows.length === 0) return null;
    const clerkUserId = rows[0].clerk_user_id as string | null;
    return clerkUserId || participantId;
  }

  private getActiveScreenParticipantIdForUserId(userId: string): string | null {
    const rows = [...this.sql.exec(
      `SELECT p.id
       FROM participants p
       WHERE (p.clerk_user_id = ? OR p.id = ?)
         AND EXISTS (
           SELECT 1
           FROM tracks t
           WHERE t.participant_id = p.id
             AND t.track_name LIKE 'screen-%'
         )
       LIMIT 1`,
      userId,
      userId,
    )];
    return rows.length > 0 ? rows[0].id as string : null;
  }

  private getStreamWatcherSnapshot() {
    const watchersByStreamer: Record<string, string[]> = {};
    for (const row of this.sql.exec(
      `SELECT streamer_user_id, viewer_user_id
       FROM stream_watchers
       ORDER BY created_at ASC, viewer_user_id ASC`
    )) {
      const streamerUserId = row.streamer_user_id as string;
      const viewerUserId = row.viewer_user_id as string;
      if (!watchersByStreamer[streamerUserId]) watchersByStreamer[streamerUserId] = [];
      watchersByStreamer[streamerUserId].push(viewerUserId);
    }
    return watchersByStreamer;
  }

  private sendStreamWatcherSnapshot(ws: WebSocket) {
    this.sendTo(ws, {
      op: Op.VoiceAppEvent,
      d: {
        type: "stream.watch.snapshot",
        watchers_by_streamer: this.getStreamWatcherSnapshot(),
      },
    });
  }

  private broadcastStreamWatcherSnapshot() {
    this.broadcast({
      op: Op.VoiceAppEvent,
      d: {
        type: "stream.watch.snapshot",
        watchers_by_streamer: this.getStreamWatcherSnapshot(),
      },
    });
  }

  private deleteStreamWatcher(streamerUserId: string, viewerUserId: string) {
    const hadExisting = [...this.sql.exec(
      "SELECT 1 FROM stream_watchers WHERE streamer_user_id = ? AND viewer_user_id = ? LIMIT 1",
      streamerUserId,
      viewerUserId,
    )].length > 0;
    if (hadExisting) {
      this.sql.exec(
        "DELETE FROM stream_watchers WHERE streamer_user_id = ? AND viewer_user_id = ?",
        streamerUserId,
        viewerUserId,
      );
    }
    return hadExisting;
  }

  private clearStreamWatchersByViewerUserId(viewerUserId: string) {
    const hadExisting = [...this.sql.exec(
      "SELECT 1 FROM stream_watchers WHERE viewer_user_id = ? LIMIT 1",
      viewerUserId,
    )].length > 0;
    if (hadExisting) {
      this.sql.exec("DELETE FROM stream_watchers WHERE viewer_user_id = ?", viewerUserId);
    }
    return hadExisting;
  }

  private clearStreamWatchersByStreamerUserId(streamerUserId: string) {
    const hadExisting = [...this.sql.exec(
      "SELECT 1 FROM stream_watchers WHERE streamer_user_id = ? LIMIT 1",
      streamerUserId,
    )].length > 0;
    if (hadExisting) {
      this.sql.exec("DELETE FROM stream_watchers WHERE streamer_user_id = ?", streamerUserId);
    }
    return hadExisting;
  }

  private clearStreamWatchersByParticipantId(participantId: string) {
    const userId = this.getUserIdForParticipant(participantId);
    if (!userId) return false;
    const clearedAsViewer = this.clearStreamWatchersByViewerUserId(userId);
    const clearedAsStreamer = this.clearStreamWatchersByStreamerUserId(userId);
    return clearedAsViewer || clearedAsStreamer;
  }


  // ── Op 100: VoiceIdentify ──────────────────────────────────────────────

  private async handleVoiceIdentify(
    ws: WebSocket,
    d: { participant_id: string; voice_token: string }
  ) {
    if (this.getParticipantId(ws)) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.AlreadyAuthenticated, message: "Already identified" },
      });
      return;
    }

    // Validate HMAC-signed voice_token: "participant_id:room_slug:timestamp.signature"
    const dotIdx = d.voice_token.lastIndexOf(".");
    if (dotIdx === -1) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.AuthenticationFailed, message: "Invalid voice token format" },
      });
      return;
    }

    const payload = d.voice_token.slice(0, dotIdx);
    const sig = d.voice_token.slice(dotIdx + 1);
    const parts = payload.split(":");

    if (!this.roomSlug && parts.length >= 2) {
      const storedSlug = await this.ctx.storage.get<string>("roomSlug");
      if (storedSlug) this.roomSlug = storedSlug;
      if (!this.roomSlug) this.roomSlug = parts[1];
    }

    if (parts.length < 3 || parts[0] !== d.participant_id || parts[1] !== this.roomSlug) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.AuthenticationFailed, message: "Invalid voice token" },
      });
      return;
    }

    const tokenTimestamp = parseInt(parts[2], 10);
    const TOKEN_VALIDITY_MS = 60 * 60 * 1000;
    const tokenAge = Date.now() - tokenTimestamp;
    const clerkUserId = parts.length >= 4 && parts[3] !== "anonymous" ? parts[3] : undefined;

    if (isNaN(tokenTimestamp) || tokenAge > TOKEN_VALIDITY_MS) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.AuthenticationFailed, message: "Voice token expired" },
      });
      return;
    }

    try {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(this.env.CALLS_APP_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"]
      );
      const sigBytes = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
      const valid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(payload));
      if (!valid) throw new Error("Invalid signature");
    } catch {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.AuthenticationFailed, message: "Voice token verification failed" },
      });
      return;
    }

    const attachment: VoiceAttachment = { participant_id: d.participant_id };

    let push_session_cam: string | null = null;
    let push_session_screen: string | null = null;
    let pull_session_id: string | null = null;
    let didTransfer = false;

    // Check for pending reconnects or stale sessions
    const pendingRows = [...this.sql.exec("SELECT * FROM pending_reconnects WHERE participant_id = ?", d.participant_id)];

    if (pendingRows.length > 0) {
      const pending = pendingRows[0];
      if (Date.now() - (pending.disconnected_at as number) < VOICE_RECONNECT_GRACE_MS) {
        const pRows = [...this.sql.exec("SELECT push_session_cam, push_session_screen FROM participants WHERE id = ?", d.participant_id)];
        if (pRows.length > 0) {
          push_session_cam = pRows[0].push_session_cam as string;
          push_session_screen = pRows[0].push_session_screen as string;

          const tRows = [...this.sql.exec("SELECT COUNT(*) as c FROM tracks WHERE participant_id = ? AND is_pending = 0", d.participant_id)];
          didTransfer = (tRows[0].c as number) > 0;

          roomLog.info(`Transferring pending SFU sessions for ${d.participant_id}: cam=${push_session_cam ?? 'none'}`);
        }
      }
      this.sql.exec("DELETE FROM pending_reconnects WHERE participant_id = ?", d.participant_id);
    } else if (clerkUserId) {
      const staleCursor = this.sql.exec(
        "SELECT p.id as pid FROM pending_reconnects r JOIN participants p ON r.participant_id = p.id WHERE p.clerk_user_id = ?",
        clerkUserId
      );
      for (const row of staleCursor) {
        const oldPid = row.pid as string;
        roomLog.info(`Fresh join for clerk=${clerkUserId}, cleaning up stale SFU sessions from old participant=${oldPid}`);
        this.ctx.waitUntil(this.cleanupSfuSessionsByParticipantId(oldPid));

        const trackNames = [...this.sql.exec("SELECT track_name FROM tracks WHERE participant_id = ?", oldPid)].map(r => r.track_name as string);
        if (trackNames.length > 0) {
          this.broadcast({ op: Op.StopTracks, d: { participant_id: oldPid, track_names: trackNames } });
        }

        this.sql.exec("DELETE FROM pending_reconnects WHERE participant_id = ?", oldPid);
        this.sql.exec("DELETE FROM tracks WHERE participant_id = ?", oldPid);
        this.sql.exec("DELETE FROM participants WHERE id = ?", oldPid);
      }
    }

    // Evict any existing LIVE session for the same participant_id OR clerk_user_id
    for (const otherWs of this.ctx.getWebSockets()) {
      if (otherWs === ws) continue;
      const otherAtt = otherWs.deserializeAttachment() as VoiceAttachment | null;
      if (!otherAtt?.participant_id) continue;

      const pRows = [...this.sql.exec("SELECT clerk_user_id FROM participants WHERE id = ?", otherAtt.participant_id)];
      const otherClerkId = pRows.length > 0 ? pRows[0].clerk_user_id as string : undefined;

      if (otherAtt.participant_id === d.participant_id || (clerkUserId && otherClerkId === clerkUserId)) {
        roomLog.info(`Evicting duplicate session for participant=${otherAtt.participant_id}`);
        if (otherAtt.participant_id !== d.participant_id) { // not already transferred
          this.ctx.waitUntil(this.cleanupSfuSessionsByParticipantId(otherAtt.participant_id));
        }
        try { otherWs.close(1000, "Replaced by new connection"); } catch { }
      }
    }

    ws.serializeAttachment(attachment);

    this.sql.exec(
      `INSERT INTO participants (id, clerk_user_id, push_session_cam, push_session_screen, pull_session_id, last_heartbeat, speaking)
       VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET
         clerk_user_id = excluded.clerk_user_id,
         last_heartbeat = excluded.last_heartbeat`,
      d.participant_id, clerkUserId ?? null, push_session_cam, push_session_screen, pull_session_id, Date.now()
    );

    roomLog.info(`VoiceIdentify: participant=${d.participant_id}`);

    const existingTracks: TrackInfo[] = [];
    const tCursor = this.sql.exec("SELECT track_name, participant_id, session_id, mid, kind FROM tracks WHERE participant_id != ?", d.participant_id);
    for (const row of tCursor) {
      existingTracks.push({
        track_name: row.track_name as string,
        participant_id: row.participant_id as string,
        session_id: row.session_id as string,
        mid: (row.mid as string) || undefined,
        kind: row.kind as "audio" | "video",
      });
    }

    const speakingStates: Record<string, number> = {};
    const sCursor = this.sql.exec("SELECT id, speaking FROM participants WHERE speaking > 0 AND id != ?", d.participant_id);
    for (const row of sCursor) {
      speakingStates[row.id as string] = row.speaking as number;
    }

    this.sendTo(ws, {
      op: Op.VoiceReady,
      d: {
        participant_id: d.participant_id,
        tracks: existingTracks,
        speaking: speakingStates,
        sfu_session_transferred: didTransfer,
      },
    });
    this.sendStreamWatcherSnapshot(ws);
    this.sendDemoChatHistory(ws);

    this.scheduleAlarm();

    // ── Pre-create SFU sessions in the BACKGROUND ──────────────────────
    const pRows = [...this.sql.exec("SELECT pull_session_id FROM participants WHERE id = ?", d.participant_id)];
    if (pRows.length > 0) {
      const row = pRows[0];
      const needPull = !row.pull_session_id;

      if (needPull) {
        this.ctx.waitUntil((async () => {
          try {
            const result = await this.sfuFetch("POST", "sessions/new");
            const sid = result.sessionId as string;
            this.sql.exec("UPDATE participants SET pull_session_id = ? WHERE id = ? AND pull_session_id IS NULL", sid, d.participant_id);
          } catch (err) {
            sfuLog.warn("Background pre-creation failed (non-fatal, will retry lazily):", err);
          }
        })());
      }
    }
  }

  // ── Op 3: Heartbeat ────────────────────────────────────────────────────

  private handleHeartbeat(ws: WebSocket) {
    const pid = this.getParticipantId(ws);
    if (!pid) {
      this.sendTo(ws, { op: Op.HeartbeatACK, d: { seq: 0 } });
      return;
    }

    this.sql.exec("UPDATE participants SET last_heartbeat = ? WHERE id = ?", Date.now(), pid);
    this.sendTo(ws, { op: Op.HeartbeatACK, d: { seq: 0 } });
  }

  // ── Op 5: Speaking (forwarded to all other voice participants) ─────────

  private handleSpeaking(ws: WebSocket, d: { speaking: number }) {
    const pid = this.requireParticipantId(ws);
    if (!pid) return;

    this.sql.exec("UPDATE participants SET speaking = ? WHERE id = ?", d.speaking, pid);

    this.broadcast(
      {
        op: Op.Speaking,
        d: { participant_id: pid, speaking: d.speaking },
      },
      ws
    );
  }

  // ── Op 1: SelectProtocol (push/pull tracks) ────────────────────────────

  private async handleSelectProtocol(
    ws: WebSocket,
    d: { sdp: string; push_tracks: PushTrackDescriptor[]; pull_tracks: TrackInfo[]; push_prefix?: string; request_id?: string }
  ) {
    const pid = this.requireParticipantId(ws);
    if (!pid) return;

    let activeOperation: "push" | "pull" | null = null;
    let activePushPrefix: "cam" | "screen" | null = null;

    try {
      const pRows = [...this.sql.exec("SELECT push_session_cam, push_session_screen, pull_session_id FROM participants WHERE id = ?", pid)];
      if (pRows.length === 0) return;
      const row = pRows[0];
      let push_session_cam = row.push_session_cam as string | null;
      let push_session_screen = row.push_session_screen as string | null;
      let pull_session_id = row.pull_session_id as string | null;

      // ── Handle push (local) tracks ──────────────────────────────────
      if (d.push_tracks.length > 0 && d.sdp) {
        const prefix = d.push_prefix === 'screen' ? 'screen' : 'cam';
        const isScreen = prefix === 'screen';
        activeOperation = "push";
        activePushPrefix = prefix;

        let pushSessionId = isScreen ? push_session_screen : push_session_cam;

        if (!pushSessionId) {
          const sessionResp = await this.sfuFetch("POST", "sessions/new");
          pushSessionId = sessionResp.sessionId as string;

          if (isScreen) {
            push_session_screen = pushSessionId;
            this.sql.exec("UPDATE participants SET push_session_screen = ? WHERE id = ?", pushSessionId, pid);
          } else {
            push_session_cam = pushSessionId;
            this.sql.exec("UPDATE participants SET push_session_cam = ? WHERE id = ?", pushSessionId, pid);
          }
          sfuLog.info(`Created push session (${prefix}):`, pushSessionId);
        }

        const localTracks = d.push_tracks.map((desc) => ({
          location: "local",
          trackName: desc.track_name,
          mid: desc.mid,
        }));

        let pushResp: Record<string, unknown>;
        try {
          if (!pushSessionId) {
            throw new Error("push_session_missing");
          }
          pushResp = await this.sfuPost(`sessions/${pushSessionId}/tracks/new`, {
            tracks: localTracks,
            sessionDescription: { type: "offer", sdp: d.sdp },
          });
        } catch (pushErr: unknown) {
          const pushMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
          if (pushMsg.includes("(410)") || pushMsg.includes("session_error")) {
            sfuLog.warn(`Push session ${prefix} stale (${pushSessionId.slice(0, 8)}...), creating fresh session and retrying`);
            const freshResp = await this.sfuFetch("POST", "sessions/new");
            pushSessionId = freshResp.sessionId as string;

            if (isScreen) {
              push_session_screen = pushSessionId;
              this.sql.exec("UPDATE participants SET push_session_screen = ? WHERE id = ?", pushSessionId, pid);
            } else {
              push_session_cam = pushSessionId;
              this.sql.exec("UPDATE participants SET push_session_cam = ? WHERE id = ?", pushSessionId, pid);
            }

            sfuLog.info(`Fresh push session (${prefix}):`, pushSessionId);
            pushResp = await this.sfuPost(`sessions/${pushSessionId}/tracks/new`, {
              tracks: localTracks,
              sessionDescription: { type: "offer", sdp: d.sdp },
            });
          } else {
            throw pushErr;
          }
        }

        sfuLog.info("Push tracks/new response tracks:", JSON.stringify(pushResp.tracks));
        const answerSdp = (pushResp.sessionDescription as { sdp?: string } | undefined)?.sdp ?? "";
        if (!answerSdp) {
          throw new Error(`SFU push tracks/new returned no answer SDP for ${prefix} session ${pushSessionId.slice(0, 8)}...`);
        }

        const respTracks = (pushResp.tracks as Array<Record<string, unknown>>) ?? [];
        const negotiatedTracks: TrackInfo[] = [];

        for (const rt of respTracks) {
          if (rt.location === "local") {
            const track_name = rt.trackName as string;
            negotiatedTracks.push({
              participant_id: pid,
              track_name,
              session_id: pushSessionId,
              mid: rt.mid as string | undefined,
              kind: track_name.includes("audio") ? "audio" : "video",
            });
          }
        }

        if (negotiatedTracks.length === 0) {
          for (const desc of d.push_tracks) {
            negotiatedTracks.push({
              participant_id: pid,
              track_name: desc.track_name,
              session_id: pushSessionId,
              mid: desc.mid,
              kind: desc.kind,
            });
          }
        }

        // Insert tracks into SQLite as PENDING (is_pending = 1)
        for (const t of negotiatedTracks) {
          this.sql.exec(
            `INSERT INTO tracks (track_name, participant_id, session_id, mid, kind, is_pending)
             VALUES (?, ?, ?, ?, ?, 1)
             ON CONFLICT(track_name) DO UPDATE SET session_id=excluded.session_id, mid=excluded.mid, is_pending=1`,
            t.track_name, pid, t.session_id, t.mid ?? null, t.kind
          );
        }

        this.sendTo(ws, {
          op: Op.SessionDescription,
          d: { sdp: answerSdp, session_id: pushSessionId, tracks: negotiatedTracks, sdp_type: "answer", push_prefix: prefix, request_id: d.request_id, operation: "push" },
        });
      }

      // ── Handle pull (remote) tracks ─────────────────────────────────
      if (d.pull_tracks.length > 0) {
        activeOperation = "pull";
        activePushPrefix = null;

        if (!pull_session_id) {
          const sessionResp = await this.sfuFetch("POST", "sessions/new");
          pull_session_id = sessionResp.sessionId as string;
          this.sql.exec("UPDATE participants SET pull_session_id = ? WHERE id = ?", pull_session_id, pid);
          sfuLog.info("Created pull session:", pull_session_id);
        }

        const remoteTracks = d.pull_tracks.map((info) => {
          const base: Record<string, unknown> = {
            location: "remote",
            trackName: info.track_name,
            sessionId: info.session_id,
          };
          if (info.kind === "video" && info.rid) {
            const isScreen = info.track_name.startsWith("screen-");
            base.simulcast = {
              preferredRid: info.rid,
              priorityOrdering: isScreen ? "none" : "asciibetical",
              ridNotAvailable: "asciibetical",
            };
          }
          return base;
        });

        let pullResp: Record<string, unknown>;
        try {
          pullResp = await this.sfuPost(`sessions/${pull_session_id}/tracks/new`, {
            tracks: remoteTracks,
          });
        } catch (pullErr: unknown) {
          const pullMsg = pullErr instanceof Error ? pullErr.message : String(pullErr);
          if (pullMsg.includes("(410)") || pullMsg.includes("session_error")) {
            sfuLog.warn(`Pull session stale (${pull_session_id.slice(0, 8)}...), creating fresh session and retrying`);
            const freshResp = await this.sfuFetch("POST", "sessions/new");
            pull_session_id = freshResp.sessionId as string;
            this.sql.exec("UPDATE participants SET pull_session_id = ? WHERE id = ?", pull_session_id, pid);
            sfuLog.info("Fresh pull session:", pull_session_id);

            pullResp = await this.sfuPost(`sessions/${pull_session_id}/tracks/new`, {
              tracks: remoteTracks,
            });
          } else {
            throw pullErr;
          }
        }

        sfuLog.info("Pull response keys:", Object.keys(pullResp).join(", "));
        const pullSdp = (pullResp.sessionDescription as { sdp: string })?.sdp ?? "";
        const pullSdpType = ((pullResp.sessionDescription as { type: string })?.type ?? "offer") as "answer" | "offer";

        const respTracks = (pullResp.tracks as Array<Record<string, unknown>>) ?? [];
        const failedTracks = respTracks.filter((rt) => rt.errorCode);
        const successTracks = respTracks.filter((rt) => !rt.errorCode);

        if (failedTracks.length > 0) {
          sfuLog.warn("Pull had failed tracks:", JSON.stringify(failedTracks));
          this.evictDeadPublisherTracks(failedTracks);
        }

        if (!pullSdp || successTracks.length === 0) {
          const failedTrackNames = failedTracks.map((rt) => rt.trackName as string);

          this.sql.exec("UPDATE participants SET pull_session_id = NULL WHERE id = ?", pid);
          this.sendTo(ws, { op: Op.Error, d: { code: 0, message: `pull-retry:${JSON.stringify(failedTrackNames)}`, request_id: d.request_id, operation: "pull" } });
          return;
        }

        if (failedTracks.length > 0) {
          const failedTrackNames = failedTracks.map((rt) => rt.trackName as string);
          setTimeout(() => {
            this.sendTo(ws, { op: Op.Error, d: { code: 0, message: `pull-retry:${JSON.stringify(failedTrackNames)}`, request_id: d.request_id, operation: "pull" } });
          }, 100);
        }

        const pullNegotiated: TrackInfo[] = successTracks.map((rt) => {
          const originalTrack = d.pull_tracks.find((pt) => pt.track_name === (rt.trackName as string));
          return {
            participant_id: originalTrack?.participant_id ?? "unknown",
            track_name: rt.trackName as string,
            session_id: (rt.sessionId as string) ?? pull_session_id,
            mid: rt.mid as string | undefined,
            kind: (rt.trackName as string)?.includes("audio") ? "audio" as const : "video" as const,
          };
        });

        this.sendTo(ws, {
          op: Op.SessionDescription,
          d: { sdp: pullSdp, session_id: pull_session_id, tracks: pullNegotiated, sdp_type: pullSdpType, request_id: d.request_id, operation: "pull" },
        });
      }

      if (d.push_tracks.length > 0 && d.sdp) {
        const prefix = d.push_prefix === 'screen' ? 'screen' : 'cam';
        const sessionId = prefix === 'screen' ? push_session_screen : push_session_cam;
        this.sendTo(ws, { op: Op.NegotiationDone, d: { session_id: sessionId ?? undefined, request_id: d.request_id, operation: "push", push_prefix: prefix } });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      roomLog.error("SFU error:", message);
      if (
        message.includes("Session is not ready") ||
        message.includes("session_error") ||
        message.includes("(410)") ||
        message.includes("(425)")
      ) {
        if (activeOperation === "pull") {
          this.sql.exec("UPDATE participants SET pull_session_id = NULL WHERE id = ?", pid);
          roomLog.info(`Cleared stale pull session ID for next retry for ${pid}`);
        } else if (activeOperation === "push" && activePushPrefix === "screen") {
          this.sql.exec("UPDATE participants SET push_session_screen = NULL WHERE id = ?", pid);
          roomLog.info(`Cleared stale screen push session ID for next retry for ${pid}`);
        } else if (activeOperation === "push") {
          this.sql.exec("UPDATE participants SET push_session_cam = NULL WHERE id = ?", pid);
          roomLog.info(`Cleared stale cam push session ID for next retry for ${pid}`);
        }
      }
      this.sendTo(ws, { op: Op.Error, d: { code: 0, message: `SFU error: ${message}`, request_id: d.request_id, operation: activeOperation ?? undefined } });
    }
  }

  // ── Op 12: Video (client pull request) ─────────────────────────────────

  private async handleVideo(ws: WebSocket, d: { tracks: TrackInfo[] }) {
    const pid = this.getParticipantId(ws);
    if (!pid) return;
    await this.handleSelectProtocol(ws, { sdp: "", push_tracks: [], pull_tracks: d.tracks });
  }

  // ── Op 14: Answer (pull renegotiation) ─────────────────────────────────

  private async handleAnswer(ws: WebSocket, d: { sdp: string; request_id?: string }) {
    const pid = this.requireParticipantId(ws);
    if (!pid) return;

    const pRows = [...this.sql.exec("SELECT pull_session_id FROM participants WHERE id = ?", pid)];
    const pullId = pRows.length > 0 ? pRows[0].pull_session_id as string | null : null;

    if (!pullId) {
      this.sendTo(ws, { op: Op.Error, d: { code: 0, message: "No pull session" } });
      return;
    }

    try {
      await this.sfuPut(`sessions/${pullId}/renegotiate`, {
        sessionDescription: { type: "answer", sdp: d.sdp },
      });
      this.sendTo(ws, { op: Op.NegotiationDone, d: { session_id: pullId, request_id: d.request_id, operation: "pull" } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendTo(ws, { op: Op.Error, d: { code: 0, message: `Renegotiate error: ${message}`, request_id: d.request_id, operation: "pull" } });
    }
  }

  // ── Op 13: StopTracks ──────────────────────────────────────────────────

  private async handleStopTracks(ws: WebSocket, d: { track_names: string[] }) {
    const pid = this.requireParticipantId(ws);
    if (!pid) return;

    const pRows = [...this.sql.exec("SELECT push_session_cam, push_session_screen FROM participants WHERE id = ?", pid)];
    if (pRows.length === 0) return;
    const row = pRows[0];
    const push_session_cam = row.push_session_cam as string | null;
    const push_session_screen = row.push_session_screen as string | null;

    const trackNameSet = new Set(d.track_names);
    const hasScreen = d.track_names.some(n => n.startsWith('screen-'));
    const oldPushSessionId = hasScreen ? push_session_screen : push_session_cam;

    // Find matching tracks
    const tracksToClose: Array<{ mid: string, trackName: string }> = [];
    const tCursor = this.sql.exec("SELECT track_name, mid FROM tracks WHERE participant_id = ?", pid);
    for (const tRow of tCursor) {
      const name = tRow.track_name as string;
      const mid = tRow.mid as string | null;
      if (trackNameSet.has(name) && mid) {
        tracksToClose.push({ mid, trackName: name });
      }
    }

    // Delete them
    for (const name of d.track_names) {
      this.sql.exec("DELETE FROM tracks WHERE track_name = ? AND participant_id = ?", name, pid);
    }

    if (hasScreen) {
      this.sql.exec("UPDATE participants SET push_session_screen = NULL WHERE id = ?", pid);
    } else if (push_session_cam) {
      // Check if any cam tracks remain
      const cur = this.sql.exec("SELECT COUNT(*) as c FROM tracks WHERE participant_id = ? AND session_id = ?", pid, push_session_cam);
      if (([...cur][0].c as number) === 0) {
        roomLog.info(`All cam tracks stopped — clearing push_session_cam for fresh session`);
        this.sql.exec("UPDATE participants SET push_session_cam = NULL WHERE id = ?", pid);
      }
    }

    roomLog.info(`Tracks stopped by ${pid}:`, d.track_names);

    this.broadcast({
      op: Op.StopTracks,
      d: { participant_id: pid, track_names: d.track_names, session_id: oldPushSessionId },
    }, ws);

    if (hasScreen && this.clearStreamWatchersByParticipantId(pid)) {
      this.broadcastStreamWatcherSnapshot();
    }

    if (oldPushSessionId && tracksToClose.length > 0) {
      try {
        await this.sfuPut(`sessions/${oldPushSessionId}/tracks/close`, {
          tracks: tracksToClose,
          force: true,
        });
      } catch (err) {
        sfuLog.warn("tracks/close failed (non-fatal):", err);
      }
    }
  }

  // ── Op 102: TracksReady ──────────────────────────────────────────────────

  private handleTracksReady(ws: WebSocket, d: { track_names: string[] }) {
    const pid = this.requireParticipantId(ws);
    if (!pid) return;

    if (d.track_names.length === 0) return;

    const readyTracks: TrackInfo[] = [];

    // Find pending tracks and promote them
    for (const name of d.track_names) {
      const cur = this.sql.exec("SELECT session_id, mid, kind FROM tracks WHERE track_name = ? AND participant_id = ? AND is_pending = 1", name, pid);
      const rows = [...cur];
      if (rows.length > 0) {
        readyTracks.push({
          track_name: name,
          participant_id: pid,
          session_id: rows[0].session_id as string,
          mid: (rows[0].mid as string) || undefined,
          kind: rows[0].kind as "audio" | "video",
        });

        this.sql.exec("UPDATE tracks SET is_pending = 0 WHERE track_name = ?", name);
      }
    }

    if (readyTracks.length === 0) return;

    this.broadcast({
      op: Op.Video,
      d: { participant_id: pid, tracks: readyTracks },
    }, ws);
  }

  // ── Op 103: TrackUpdate (simulcast layer change, no renegotiation) ─────

  private async handleTrackUpdate(
    ws: WebSocket,
    d: { tracks: Array<{ track_name: string; session_id: string; mid: string; rid: string }> }
  ) {
    const pid = this.requireParticipantId(ws);
    if (!pid) return;

    const pRows = [...this.sql.exec("SELECT pull_session_id FROM participants WHERE id = ?", pid)];
    const pullId = pRows.length > 0 ? pRows[0].pull_session_id as string | null : null;

    if (!pullId) return;

    try {
      const updates = d.tracks.map((t) => ({
        trackName: t.track_name,
        sessionId: t.session_id,
        mid: t.mid,
        simulcast: {
          preferredRid: t.rid,
          priorityOrdering: (t.track_name.startsWith("screen-") ? "none" : "asciibetical") as "none" | "asciibetical",
          ridNotAvailable: "asciibetical" as const,
        },
      }));

      await this.sfuPut(`sessions/${pullId}/tracks/update`, { tracks: updates });

      sfuLog.info(`Updated simulcast for ${d.tracks.length} tracks`);
    } catch (err: unknown) {
      sfuLog.warn("tracks/update failed (non-fatal):", String(err));
    }
  }

  // ── Op 104: IceRestart ──────────────────────────────────────────────────

  private handleResetPullSession(ws: WebSocket) {
    const pid = this.requireParticipantId(ws);
    if (!pid) return;

    const rows = [...this.sql.exec("SELECT pull_session_id FROM participants WHERE id = ?", pid)];
    const oldPullId = rows.length > 0 ? rows[0].pull_session_id as string | null : null;

    this.sql.exec("UPDATE participants SET pull_session_id = NULL WHERE id = ?", pid);
    sfuLog.info(`Reset pull session for ${pid}${oldPullId ? ` (${oldPullId.slice(0, 8)}...)` : ""}`);
  }

  private handleVoiceAppEvent(ws: WebSocket, d: Record<string, unknown>) {
    const pid = this.requireParticipantId(ws);
    if (!pid) return;

    const type = typeof d.type === "string" ? d.type : "";
    const callerUserId = this.getUserIdForParticipant(pid);

    if (type === "demo.chat.send") {
      this.handleDemoChatSend(ws, pid, d);
      return;
    }

    if (type === "demo.chat.history.request") {
      this.sendDemoChatHistory(ws);
      return;
    }

    if (type === "stream.watch.start" || type === "stream.watch.stop") {
      if (!callerUserId) return;
      const streamerUserId = typeof d.streamer_user_id === "string" ? d.streamer_user_id : "";
      if (!streamerUserId || streamerUserId === callerUserId) return;

      if (type === "stream.watch.stop") {
        if (this.deleteStreamWatcher(streamerUserId, callerUserId)) {
          this.broadcastStreamWatcherSnapshot();
        }
        return;
      }

      const streamerParticipantId = this.getActiveScreenParticipantIdForUserId(streamerUserId);
      if (!streamerParticipantId) {
        if (this.deleteStreamWatcher(streamerUserId, callerUserId)) {
          this.broadcastStreamWatcherSnapshot();
        }
        return;
      }

      const existingRows = [...this.sql.exec(
        `SELECT streamer_participant_id, viewer_participant_id
         FROM stream_watchers
         WHERE streamer_user_id = ? AND viewer_user_id = ?`,
        streamerUserId,
        callerUserId,
      )];
      const alreadyUpToDate = existingRows.length > 0
        && (existingRows[0].streamer_participant_id as string) === streamerParticipantId
        && (existingRows[0].viewer_participant_id as string) === pid;

      if (!alreadyUpToDate) {
        this.sql.exec(
          `INSERT INTO stream_watchers (
             streamer_user_id,
             viewer_user_id,
             streamer_participant_id,
             viewer_participant_id,
             created_at
           )
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(streamer_user_id, viewer_user_id) DO UPDATE SET
             streamer_participant_id = excluded.streamer_participant_id,
             viewer_participant_id = excluded.viewer_participant_id,
             created_at = excluded.created_at`,
          streamerUserId,
          callerUserId,
          streamerParticipantId,
          pid,
          Date.now(),
        );
        this.broadcastStreamWatcherSnapshot();
      }
      return;
    }

    if (type === "stream.watch.clear") {
      if (!callerUserId) return;
      if (this.clearStreamWatchersByStreamerUserId(callerUserId)) {
        this.broadcastStreamWatcherSnapshot();
      }
      return;
    }

    if (this.isPersistedMessageLikeAppEvent(type)) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4000, message: "Voice app events cannot create persisted channel messages" },
      });
      return;
    }

    // -----------------------------------------------------------------------
    // Sticker reaction validation (security hardening)
    // Validate URL against a CDN allowlist and strip unknown fields before
    // re-broadcasting to every participant in the room.
    // -----------------------------------------------------------------------
    if (type === "reaction.sticker") {
      const url = typeof d.url === "string" ? d.url : "";
      const displayMode = typeof d.displayMode === "string" ? d.displayMode : "single";
      const ALLOWED_MODES = new Set(["single", "burst", "rain", "bounce"]);
      const SAFE_CONTENT_TYPES = new Set([
        "image/gif", "image/webp", "image/apng", "image/png", "image/jpeg", "video/mp4",
      ]);
      const rawContentType = typeof d.contentType === "string" ? d.contentType : "";
      const contentType: string = SAFE_CONTENT_TYPES.has(rawContentType) ? rawContentType : "image/gif";
      const MAX_URL_LENGTH = 2048;

      // Validate URL length
      if (!url || url.length > MAX_URL_LENGTH) {
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: 4000, message: "Sticker URL is invalid or too long" },
        });
        return;
      }

      // Validate URL: must be https:// pointing to a known sticker CDN
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: 4000, message: "Sticker URL is not a valid URL" },
        });
        return;
      }

      if (parsedUrl.protocol !== "https:") {
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: 4000, message: "Sticker URL must use HTTPS" },
        });
        return;
      }

      const hostname = parsedUrl.hostname.toLowerCase();
      const isSafeHost =
        /^static\d*\.klipy\.com$/.test(hostname) ||
        /^media\d*\.tenor\.com$/.test(hostname) ||
        hostname === "c.tenor.com" ||
        hostname === "gif.fxtwitter.com" ||
        hostname === "video.twimg.com";

      if (!isSafeHost) {
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: 4000, message: "Sticker URL host is not allowed" },
        });
        return;
      }

      // Look up the sender's clerk_user_id so clients can filter per-card
      let clerkUserId: string | null = null;
      try {
        const pRows = [...this.sql.exec<{ clerk_user_id: string }>(
          "SELECT clerk_user_id FROM participants WHERE id = ?",
          pid,
        )];
        clerkUserId = pRows.length > 0 ? (pRows[0].clerk_user_id ?? null) : null;
      } catch {
        // non-fatal — overlay will fall back to showing on all cards
      }

      // Broadcast a sanitized payload — no extra fields from the sender
      this.broadcast({
        op: Op.VoiceAppEvent,
        d: {
          type: "reaction.sticker",
          url,
          contentType,
          displayMode: ALLOWED_MODES.has(displayMode) ? displayMode : "single",
          participant_id: pid,
          user_id: clerkUserId ?? undefined,
          sent_at: Date.now(),
        },
      });
      return;
    }

    this.broadcast({
      op: Op.VoiceAppEvent,
      d: {
        ...d,
        participant_id: pid,
        sent_at: Date.now(),
      },
    });
  }

  private handleDemoChatSend(ws: WebSocket, participantId: string, d: Record<string, unknown>) {
    const authorName = this.sanitizeDemoChatText(d.author_name, 48) || "Guest";
    const content = this.sanitizeDemoChatText(d.content, DEMO_CHAT_MAX_CONTENT_LENGTH);
    const gif = this.normalizeDemoChatGif(d.gif);

    if (!content && !gif) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4000, message: "Demo chat messages need text or a GIF" },
      });
      return;
    }

    const now = Date.now();
    const message: DemoChatMessage = {
      id: crypto.randomUUID(),
      participant_id: participantId,
      author_name: authorName,
      content,
      ...(gif ? { gif } : {}),
      created_at: now,
      expires_at: now + DEMO_CHAT_TTL_MS,
    };

    this.pruneDemoChatMessages(now);
    this.sql.exec(
      `INSERT INTO demo_chat_messages (id, participant_id, author_name, content, gif_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      message.id,
      message.participant_id,
      message.author_name,
      message.content,
      message.gif ? JSON.stringify(message.gif) : null,
      message.created_at,
      message.expires_at
    );
    this.pruneDemoChatOverflow();

    this.broadcast({
      op: Op.VoiceAppEvent,
      d: {
        type: "demo.chat.message",
        message,
      },
    });
    this.scheduleAlarm();
  }

  private sendDemoChatHistory(ws: WebSocket) {
    const now = Date.now();
    this.pruneDemoChatMessages(now);

    const rows = [...this.sql.exec(
      `SELECT id, participant_id, author_name, content, gif_json, created_at, expires_at
       FROM demo_chat_messages
       WHERE expires_at > ?
       ORDER BY created_at ASC
       LIMIT ?`,
      now,
      DEMO_CHAT_MAX_MESSAGES
    )];

    const messages: DemoChatMessage[] = rows.map((row) => {
      const gifJson = row.gif_json as string | null;
      let gif: DemoChatGifPayload | undefined;
      if (gifJson) {
        try {
          gif = JSON.parse(gifJson) as DemoChatGifPayload;
        } catch {
          gif = undefined;
        }
      }

      return {
        id: row.id as string,
        participant_id: row.participant_id as string,
        author_name: row.author_name as string,
        content: row.content as string,
        ...(gif ? { gif } : {}),
        created_at: row.created_at as number,
        expires_at: row.expires_at as number,
      };
    });

    this.sendTo(ws, {
      op: Op.VoiceAppEvent,
      d: {
        type: "demo.chat.history",
        messages,
        ttl_ms: DEMO_CHAT_TTL_MS,
      },
    });
  }

  private sanitizeDemoChatText(value: unknown, maxLength: number) {
    if (typeof value !== "string") return "";
    return Array.from(value)
      .filter((char) => {
        const code = char.charCodeAt(0);
        return code >= 32 && code !== 127;
      })
      .join("")
      .trim()
      .slice(0, maxLength);
  }

  private normalizeDemoChatGif(value: unknown): DemoChatGifPayload | undefined {
    if (!value || typeof value !== "object") return undefined;
    const gif = value as Record<string, unknown>;
    const url = typeof gif.url === "string" ? gif.url : "";
    const contentType = gif.content_type;
    if (!this.isAllowedRemoteGifUrl(url)) return undefined;
    if (contentType !== "image/gif" && contentType !== "video/mp4") return undefined;

    const normalized: DemoChatGifPayload = {
      url,
      content_type: contentType,
    };

    if (typeof gif.title === "string") normalized.title = gif.title.slice(0, 120);
    if (typeof gif.source_url === "string" && this.isAllowedRemoteGifUrl(gif.source_url)) {
      normalized.source_url = gif.source_url;
    }
    if (gif.provider === "klipy" || gif.provider === "tenor") normalized.provider = gif.provider;
    if (typeof gif.width === "number" && Number.isFinite(gif.width)) normalized.width = Math.max(1, Math.min(4000, Math.round(gif.width)));
    if (typeof gif.height === "number" && Number.isFinite(gif.height)) normalized.height = Math.max(1, Math.min(4000, Math.round(gif.height)));

    return normalized;
  }

  private isAllowedRemoteGifUrl(value: string) {
    try {
      const url = new URL(value);
      return url.protocol === "https:";
    } catch {
      return false;
    }
  }

  private isPersistedMessageLikeAppEvent(type: string) {
    const normalized = type.toLowerCase().replace(/[_.:-]/g, "");
    return normalized === "messagecreate" || normalized === "messagesend" || normalized === "channelmessagecreate";
  }

  private pruneDemoChatMessages(now = Date.now()) {
    this.sql.exec(`DELETE FROM demo_chat_messages WHERE expires_at <= ?`, now);
  }

  private pruneDemoChatOverflow() {
    this.sql.exec(
      `DELETE FROM demo_chat_messages
       WHERE id NOT IN (
         SELECT id FROM demo_chat_messages
         ORDER BY created_at DESC
         LIMIT ?
       )`,
      DEMO_CHAT_MAX_MESSAGES
    );
  }

  /**
   * DEPRECATED: CF Calls renegotiate endpoint does not support ICE restart
   * (always returns 406 "sessionDescription.type=answer is expected").
   * Client should use full session teardown + recreate instead.
   * This handler now returns an error instructing the client to reset.
   */
  private async handleIceRestart(
    ws: WebSocket,
    d: { sdp: string; session_type: "push_cam" | "push_screen" | "pull" }
  ) {
    const pid = this.requireParticipantId(ws);
    if (!pid) return;

    roomLog.warn(`Received deprecated IceRestart op from ${pid} for ${d.session_type} — sending reset instruction`);
    this.sendTo(ws, {
      op: Op.Error,
      d: { code: 0, message: "session-dead-reconnect" },
    });
  }

  // ── SFU Session Health Check ───────────────────────────────────────────
  // Called from alarm() to detect SFU sessions that have been silently evicted.
  // Pull sessions are most vulnerable: in quiet rooms with no media, the SFU
  // may idle-timeout the session. We check each and clean up 410'd ones.

  private async validateSfuSessions() {
    const participants = [...this.sql.exec("SELECT id, pull_session_id FROM participants WHERE pull_session_id IS NOT NULL")];
    if (participants.length === 0) return;

    for (const p of participants) {
      const pullId = p.pull_session_id as string;
      try {
        // Lightweight probe — a GET on the session endpoint
        await this.sfuFetch("GET", `sessions/${pullId}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("(410)")) {
          sfuLog.warn(`Pull session ${pullId.slice(0, 8)}... is 410 — clearing for participant ${p.id}`);
          this.sql.exec("UPDATE participants SET pull_session_id = NULL WHERE id = ?", p.id);
          // Notify the client so it can re-pull
          const ws = this.getWsByParticipant(p.id as string);
          if (ws) {
            this.sendTo(ws, { op: Op.Error, d: { code: 0, message: "pull-session-expired" } });
          }
        } else {
          // Non-410 errors (5xx, network) = transient, skip for now
          sfuLog.warn(`Session probe for ${pullId.slice(0, 8)}... errored (non-fatal): ${message}`);
        }
      }
    }
  }

  // If a track consistently fails to pull (e.g., SFU returns errorCode),
  // it means the publisher's RTP upload fundamentally died (often an ICE failure
  // on the publisher's end that their client hasn't realized or recovered from yet).
  //
  // If we leave the dead track in SQLite, every viewer that joins (or re-pulls)
  // will keep asking the SFU for it, resulting in cascading error loops.
  // This evicts the publisher's track globally.
  //
  // IMPORTANT: We only evict tracks from publishers that are DISCONNECTED.
  // The SFU returns `empty_track_error` when the publisher's push PC hasn't
  // completed ICE negotiation yet — this is a transient state, NOT a dead track.
  // Evicting a connected publisher's tracks destroys healthy, still-connecting
  // sessions (the root cause of the "User B can't speak" bug).
  private evictDeadPublisherTracks(failedTracks: Array<Record<string, unknown>>) {
    // Collect unique sessionIds from the failures, tracking whether the
    // failure was a truly transient `empty_track_error` (ICE still negotiating)
    // vs a permanent error like `not_found_track_error` (session dead).
    const failedSids = new Map<string, boolean>(); // sessionId → isTransient
    for (const failing of failedTracks) {
      if (!failing.sessionId) continue;
      const sid = failing.sessionId as string;
      const errorCode = (failing.errorCode as string) || "";
      const isTransient = errorCode === "empty_track_error";
      // If any error for this session is permanent, mark the whole session
      // as non-transient (evictable even if publisher is connected).
      const prev = failedSids.get(sid);
      failedSids.set(sid, prev === undefined ? isTransient : (prev && isTransient));
    }

    if (failedSids.size === 0) return;

    // Build a set of participant IDs that still have open WebSocket connections.
    // These publishers are alive — their push PC may just be finishing ICE.
    const connectedPids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const pid = this.getParticipantId(ws);
      if (pid) connectedPids.add(pid);
    }

    for (const [badSessionId, isTransient] of failedSids) {
      // Find who owns this push session
      const pCur = this.sql.exec(
        "SELECT id FROM participants WHERE push_session_cam = ? OR push_session_screen = ?",
        badSessionId, badSessionId
      );
      const rows = [...pCur];

      if (rows.length > 0) {
        const ownerPid = rows[0].id as string;

        const evictionDecision = decideFailedPublisherSessionEviction({
          ownerConnected: connectedPids.has(ownerPid),
          hasOnlyTransientErrors: isTransient,
        });

        if (!evictionDecision.evict) {
          const reason = isTransient
            ? "empty_track_error is likely transient while publisher ICE is still negotiating"
            : "viewer-side pull failure should not evict a still-connected publisher";
          sfuLog.info(`Skipping eviction for connected publisher ${ownerPid} (session ${badSessionId.slice(0, 8)}…) — ${reason}`);
          continue;
        }

        const deletedTracks: string[] = [];
        const tCur = this.sql.exec("SELECT track_name FROM tracks WHERE session_id = ?", badSessionId);
        for (const tr of tCur) deletedTracks.push(tr.track_name as string);

        if (deletedTracks.length > 0) {
          sfuLog.warn(`Evicting dead tracks for disconnected publisher ${ownerPid} due to pull failures. tracks=${deletedTracks.join(',')}`);

          this.sql.exec("DELETE FROM tracks WHERE session_id = ?", badSessionId);
          const didClearStreamWatchers = deletedTracks.some((trackName) => trackName.startsWith("screen-"))
            && this.clearStreamWatchersByParticipantId(ownerPid);

          this.broadcast({
            op: Op.StopTracks,
            d: {
              participant_id: ownerPid,
              track_names: deletedTracks,
              session_id: badSessionId
            }
          });

          if (didClearStreamWatchers) {
            this.broadcastStreamWatcherSnapshot();
          }
        }
      }
    }
  }

  // ── Op 2: Leave & Disconnect ───────────────────────────────────────────

  private async handleLeave(ws: WebSocket, clientInitiated = false, closeSocket = true) {
    const pid = this.getParticipantId(ws);
    // Remove from in-memory WebSockets list since we're closing it.
    // The DO automatically removes it from this.ctx.getWebSockets(),
    // but we also need to clean up DB state.

    if (pid) {
      await this.disconnectParticipant(pid, !clientInitiated, closeSocket ? ws : undefined);
    }
  }

  private async disconnectParticipant(participantId: string, gracePeriod: boolean, ws?: WebSocket) {
    roomLog.info(`Participant ${participantId} disconnecting (grace=${gracePeriod})`);

    const pRows = [...this.sql.exec("SELECT clerk_user_id, push_session_cam, push_session_screen, pull_session_id FROM participants WHERE id = ?", participantId)];
    if (pRows.length === 0) return;

    // Broadcast leave
    this.broadcast({ op: Op.ClientDisconnect, d: { participant_id: participantId } });

    if (gracePeriod) {
      // Move to pending, keep tracks alive
      const now = Date.now();
      this.sql.exec(
        "INSERT INTO pending_reconnects (participant_id, disconnected_at) VALUES (?, ?) ON CONFLICT(participant_id) DO UPDATE SET disconnected_at = excluded.disconnected_at",
        participantId, now
      );
      this.scheduleAlarm();
    } else {
      // Client intended to leave forever, or we are pruning them.
      // Clean up SFU resources and SQLite data completely.
      this.ctx.waitUntil(this.cleanupSfuSessionsByParticipantId(participantId));
      const didChangeStreamWatchers = this.clearStreamWatchersByParticipantId(participantId);

      const trackNames = [...this.sql.exec("SELECT track_name FROM tracks WHERE participant_id = ?", participantId)].map(r => r.track_name as string);
      if (trackNames.length > 0) {
        this.broadcast({ op: Op.StopTracks, d: { participant_id: participantId, track_names: trackNames } });
      }

      this.sql.exec("DELETE FROM pending_reconnects WHERE participant_id = ?", participantId);
      this.sql.exec("DELETE FROM tracks WHERE participant_id = ?", participantId);
      this.sql.exec("DELETE FROM participants WHERE id = ?", participantId);

      if (didChangeStreamWatchers) {
        this.broadcastStreamWatcherSnapshot();
      }
    }

    if (ws) {
      try { ws.close(1000, "Left voice"); } catch { /* already closed */ }
    }
  }

  private async cleanupSfuSessionsByParticipantId(participantId: string) {
    const pRows = [...this.sql.exec("SELECT push_session_cam, push_session_screen FROM participants WHERE id = ?", participantId)];
    if (pRows.length === 0) return;
    const p = pRows[0];
    const push_session_cam = p.push_session_cam as string | null;
    const push_session_screen = p.push_session_screen as string | null;

    const tRows = [...this.sql.exec("SELECT track_name, session_id, mid FROM tracks WHERE participant_id = ?", participantId)];

    const camTracks = tRows.filter(t => t.session_id === push_session_cam && t.mid);
    const screenTracks = tRows.filter(t => t.session_id === push_session_screen && t.mid);

    const closeSession = async (sessionId: string, tracks: any[]) => {
      const url = `https://rtc.live.cloudflare.com/v1/apps/${this.env.CALLS_APP_ID}/sessions/${sessionId}/tracks/close`;
      try {
        const resp = await fetch(url, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${this.env.CALLS_APP_SECRET}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ tracks: tracks.map(t => ({ mid: t.mid })), force: true }),
        });
        if (resp.ok) return;
        if (resp.status === 410) {
          sfuLog.warn(`tracks/close 410 for session ${sessionId.slice(0, 8)}... — PC already disconnected, session evicted by SFU (expected)`);
          return;
        }
        const body = await resp.text().catch(() => "(unreadable)");
        sfuLog.warn(`tracks/close ${resp.status} for session ${sessionId.slice(0, 8)}...:`, body);
      } catch (err) {
        sfuLog.warn(`tracks/close network error for session ${sessionId.slice(0, 8)}...:`, err);
      }
    };

    const cleanupTasks: Promise<void>[] = [];
    if (push_session_cam && camTracks.length > 0) {
      cleanupTasks.push(closeSession(push_session_cam, camTracks));
    }
    if (push_session_screen && screenTracks.length > 0) {
      cleanupTasks.push(closeSession(push_session_screen, screenTracks));
    }
    if (cleanupTasks.length > 0) await Promise.all(cleanupTasks);
  }

  // ── SFU API Helpers ────────────────────────────────────────────────────

  private async sfuFetch(
    method: string,
    path: string
  ): Promise<Record<string, unknown>> {
    const url = `https://rtc.live.cloudflare.com/v1/apps/${this.env.CALLS_APP_ID}/${path}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const resp = await fetch(url, {
          method,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.env.CALLS_APP_SECRET}`,
          },
        });

        const text = await resp.text();

        if (resp.ok) return JSON.parse(text);

        // Retry once on 5xx (server error) after a short delay
        if (resp.status >= 500 && attempt === 0) {
          sfuLog.warn(`${method} ${path} returned ${resp.status}, retrying in 500ms...`);
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        sfuLog.error(`${method} ${path} failed (${resp.status}):`,
          text,
          `| APP_ID=${this.env.CALLS_APP_ID}`,
          `| SECRET defined=${!!this.env.CALLS_APP_SECRET}`,
          `| SECRET length=${this.env.CALLS_APP_SECRET?.length ?? 0}`,
          `| SECRET prefix=${this.env.CALLS_APP_SECRET?.slice(0, 6) ?? "N/A"}...`
        );
        throw new Error(`SFU ${method} ${path} failed (${resp.status}): ${text}`);
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error(`SFU ${method} ${path} failed after retry`);
  }

  private async sfuPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.sfuRequest("POST", path, body);
  }

  private async sfuPut(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.sfuRequest("PUT", path, body);
  }

  private async sfuRequest(
    method: string,
    path: string,
    body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const url = `https://rtc.live.cloudflare.com/v1/apps/${this.env.CALLS_APP_ID}/${path}`;
    const jsonBody = JSON.stringify(body);

    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const resp = await fetch(url, {
          method,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.env.CALLS_APP_SECRET}`,
            "Content-Type": "application/json",
          },
          body: jsonBody,
        });

        const text = await resp.text();

        if (resp.ok) return JSON.parse(text);

        // Retry once on 5xx (server error) after a short delay
        if (resp.status >= 500 && attempt === 0) {
          sfuLog.warn(`${method} ${path} returned ${resp.status}, retrying in 500ms...`);
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        sfuLog.error(`${method} ${path} failed (${resp.status}):`,
          text,
          `| APP_ID=${this.env.CALLS_APP_ID}`,
          `| SECRET defined=${!!this.env.CALLS_APP_SECRET}`,
          `| SECRET length=${this.env.CALLS_APP_SECRET?.length ?? 0}`,
          `| SECRET prefix=${this.env.CALLS_APP_SECRET?.slice(0, 6) ?? "N/A"}...`
        );
        throw new Error(`SFU ${method} ${path} failed (${resp.status}): ${text}`);
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error(`SFU ${method} ${path} failed after retry`);
  }

  private sendTo(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // ignore
    }
  }

  private broadcast(msg: ServerMsg, excludeWs?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === excludeWs) continue;
      try {
        ws.send(data);
      } catch {
        // ignore
      }
    }
  }

}
