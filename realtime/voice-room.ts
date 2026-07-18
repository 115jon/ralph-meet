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
import {
  isReconnectWithinGrace,
  isSupersededVoiceConnection,
} from "../src/lib/voice/connection-generation";
import {
  buildListenTogetherSnapshot,
  isValidListenTogetherVideoId,
  LISTEN_TOGETHER_IMPORT_LIMIT,
  type ListenTogetherCommand,
  type ListenTogetherEnqueueCommand,
  type ListenTogetherEvent,
  type ListenTogetherMusicProvider,
  type ListenTogetherPersistentState,
  type ListenTogetherQueueEntry,
  type ListenTogetherStateSnapshot,
} from "../src/lib/listen-together";
import { decideFailedPublisherSessionEviction } from "../src/lib/voice/sfu-publisher-eviction";
import {
  clearListenTogether,
  enqueueListenTogetherEntries,
  freezeListenTogetherPlayback,
  pauseListenTogether,
  playListenTogether,
  removeListenTogetherEntry,
  seekListenTogether,
  skipListenTogether,
  type ListenTogetherMutationResult,
} from "../src/lib/voice/listen-together-state";
import { getNextVoicePresenceAlarmTime } from "../src/lib/voice-presence";
import { toSafeSfuFailure } from "./sfu-diagnostics";
import { getRealtimeAdmissionFromHeaders } from "./realtime-admission";
import { verifyVoiceToken } from "./voice-token";
import {
  DemoChatStore,
  type DemoChatGifPayload,
  type DemoChatMessage,
} from "./voice-room/demo-chat-store";
import { StreamWatcherStore } from "./voice-room/stream-watcher-store";
import { ListenTogetherStore } from "./voice-room/listen-together-store";
import { RadioStationResolver } from "./voice-room/radio-station-resolver";
import { SfuClient } from "./voice-room/sfu-client";
import { sanitizeVoiceAppEvent } from "./voice-room-events";

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
  AdmissionRejected = 4008,
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

interface SfuTrackCloseRow {
  mid: string;
  session_id: string | null;
  track_name: string;
}

interface GatewayMessage {
  op: number;
  d: any;
}

type ServerMsg = GatewayMessage;

// WebSocket attachment for voice sessions
interface VoiceAttachment {
  admission?: {
    accessMode: "authenticated" | "public-demo";
    connectionGeneration: string;
    subject: string;
  };
  participant_id: string;
  connection_id?: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const VOICE_HEARTBEAT_INTERVAL_MS = 15_000;
const VOICE_ZOMBIE_TIMEOUT_MS = VOICE_HEARTBEAT_INTERVAL_MS * 6;
const VOICE_PRUNE_ALARM_INTERVAL_MS = 300_000;
const SFU_SESSION_REUSE_GRACE_MS = 20_000;
const DEMO_CHAT_TTL_MS = 10 * 60 * 1000;
const DEMO_CHAT_MAX_MESSAGES = 75;
const DEMO_CHAT_MAX_CONTENT_LENGTH = 1_000;
const RADIO_STATION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RADIO_STATION_LOOKUPS_PER_ENQUEUE = 5;
const MAX_SOUNDBOARD_DATA_URL_BYTES = 512 * 1024;
const MAX_NEGOTIATION_TRACKS = 32;
const MAX_SDP_LENGTH = 1_000_000;
const MAX_VOICE_FRAME_BYTES = 1_000_000;
const VOICE_WS_RATE_LIMIT_WINDOW_MS = 60_000;
const VOICE_WS_RATE_LIMITS: Record<number, number> = {
  [Op.SelectProtocol]: 20,
  [Op.Video]: 20,
  [Op.Answer]: 20,
  [Op.StopTracks]: 40,
  [Op.TrackUpdate]: 60,
  [Op.IceRestart]: 10,
  [Op.TracksReady]: 60,
  [Op.VoiceAppEvent]: 60,
};

// ── VoiceRoom Durable Object ────────────────────────────────────────────────

export class VoiceRoom extends DurableObject<Env> {
  public ctx: DurableObjectState;
  public env: Env;
  private sql: SqlStorage;
  private demoChatStore: DemoChatStore;
  private streamWatcherStore: StreamWatcherStore;
  private listenTogetherStore: ListenTogetherStore;
  private radioStationResolver: RadioStationResolver;
  private sfuClient: SfuClient;
  private roomSlug: string = "";
  private listenTogetherCommandQueue: Promise<void> = Promise.resolve();
  private selectProtocolQueue: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.sql = this.ctx.storage.sql;
    this.demoChatStore = new DemoChatStore(this.sql, DEMO_CHAT_MAX_MESSAGES);
    this.streamWatcherStore = new StreamWatcherStore(this.sql);
    this.listenTogetherStore = new ListenTogetherStore(
      this.sql,
      () => this.roomSlug,
    );
    this.radioStationResolver = new RadioStationResolver({
      fetch: (...args) => globalThis.fetch(...args),
    });
    this.sfuClient = new SfuClient({
      appId: this.env.CALLS_APP_ID,
      secret: this.env.CALLS_APP_SECRET,
      fetch: (...args) => globalThis.fetch(...args),
      log: sfuLog,
    });

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
        speaking INTEGER DEFAULT 0,
        connection_id TEXT
      );
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS ws_rate_limits (
        rate_key TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL
      );
    `);
    try {
      this.sql.exec(`ALTER TABLE participants ADD COLUMN connection_id TEXT;`);
    } catch {
      // Existing SQLite-backed Durable Objects already have the column.
    }

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

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS listen_together_state (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        room_slug TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        paused INTEGER NOT NULL DEFAULT 1,
        current_entry_id TEXT,
        anchor_position_ms INTEGER NOT NULL DEFAULT 0,
        anchor_updated_at INTEGER,
        last_updated_at INTEGER NOT NULL DEFAULT 0,
        recently_played_json TEXT
      );
    `);
    try {
      this.sql.exec(
        `ALTER TABLE listen_together_state ADD COLUMN recently_played_json TEXT;`,
      );
    } catch {
      // Existing SQLite-backed Durable Objects already have the column.
    }

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS listen_together_queue (
        entry_id TEXT PRIMARY KEY,
        sort_order INTEGER NOT NULL,
        entry_json TEXT NOT NULL,
        requested_at INTEGER NOT NULL
      );
    `);

    // Indexes for common query paths — CREATE INDEX IF NOT EXISTS is idempotent
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_tracks_participant ON tracks(participant_id);`,
    );
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_tracks_session ON tracks(session_id);`,
    );
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_tracks_name_pid ON tracks(track_name, participant_id);`,
    );
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_demo_chat_expires ON demo_chat_messages(expires_at);`,
    );
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_demo_chat_created ON demo_chat_messages(created_at);`,
    );
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_stream_watchers_streamer ON stream_watchers(streamer_user_id);`,
    );
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_stream_watchers_viewer ON stream_watchers(viewer_user_id);`,
    );
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_stream_watchers_streamer_pid ON stream_watchers(streamer_participant_id);`,
    );
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_stream_watchers_viewer_pid ON stream_watchers(viewer_participant_id);`,
    );
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_listen_together_queue_order ON listen_together_queue(sort_order);`,
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const gatewayVersion = parseInt(url.searchParams.get("v") ?? "1", 10);

    const match = url.pathname.match(
      /\/api\/(?:channels|room)\/([^/]+)\/voice/,
    );
    if (match) {
      this.roomSlug = match[1];
      this.ctx.storage.put("roomSlug", this.roomSlug).catch(() => {});
    }

    if (url.pathname.endsWith("/voice")) {
      const admission = getRealtimeAdmissionFromHeaders(request.headers);
      if (
        !admission ||
        admission.audience !== "voice" ||
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
          heartbeat_interval: VOICE_HEARTBEAT_INTERVAL_MS,
          gateway_version: gatewayVersion,
        },
      });

      return new Response(null, {
        status: 101,
        headers: { "Sec-WebSocket-Protocol": "ralph.realtime.v1" },
        webSocket: client,
      } as any);
    }

    if (
      url.pathname === "/disconnect-participant" &&
      request.method === "POST"
    ) {
      try {
        const body = (await request.json()) as {
          participant_id?: string;
        };

        const participantId =
          typeof body.participant_id === "string" && body.participant_id.trim()
            ? body.participant_id.trim()
            : "";

        if (!participantId) {
          return Response.json(
            { error: "Missing participant id" },
            { status: 400 },
          );
        }

        const disconnected =
          await this.disconnectParticipantImmediately(participantId);
        return Response.json({ disconnected }, { status: 200 });
      } catch (error) {
        return Response.json(
          { error: `Disconnect participant error: ${error}` },
          { status: 500 },
        );
      }
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, rawMsg: string | ArrayBuffer) {
    if (typeof rawMsg !== "string") {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4000, message: "Text websocket frames are required" },
      });
      return;
    }
    if (rawMsg.length > MAX_VOICE_FRAME_BYTES) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4000, message: "Websocket frame is too large" },
      });
      return;
    }

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
      this.isPublicDemoSocket(ws) &&
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

    if (
      this.isAuthenticatedMutatingOpcode(msg.op) &&
      !this.isCurrentAuthenticatedVoiceSocket(ws)
    ) {
      return;
    }

    if (this.isRateLimited(ws, msg.op)) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4290, message: "Operation rate limit exceeded" },
      });
      return;
    }

    switch (msg.op) {
      case Op.VoiceIdentify:
        if (
          !this.isPlainObject(msg.d) ||
          typeof msg.d.participant_id !== "string" ||
          typeof msg.d.voice_token !== "string"
        ) {
          this.sendTo(ws, {
            op: Op.Error,
            d: { code: 4000, message: "Invalid voice identify payload" },
          });
          break;
        }
        await this.handleVoiceIdentify(ws, msg.d);
        break;

      case Op.Heartbeat:
        this.handleHeartbeat(ws, msg.d);
        break;

      case Op.SelectProtocol:
        if (!this.isSelectProtocolPayload(msg.d)) {
          this.sendTo(ws, {
            op: Op.Error,
            d: { code: 4000, message: "Invalid select protocol payload" },
          });
          break;
        }
        await this.handleSelectProtocol(ws, msg.d);
        break;

      case Op.Video:
        if (
          !this.isPlainObject(msg.d) ||
          !Array.isArray(msg.d.tracks) ||
          !this.isTrackInfoArray(msg.d.tracks)
        ) {
          this.sendTo(ws, {
            op: Op.Error,
            d: { code: 4000, message: "Invalid video payload" },
          });
          break;
        }
        await this.handleVideo(ws, msg.d);
        break;

      case Op.StopTracks:
        if (
          !this.isPlainObject(msg.d) ||
          !Array.isArray(msg.d.track_names) ||
          !msg.d.track_names.every(
            (name: unknown) => typeof name === "string" && name.length > 0,
          )
        ) {
          this.sendTo(ws, {
            op: Op.Error,
            d: { code: 4000, message: "Invalid stop tracks payload" },
          });
          break;
        }
        await this.handleStopTracks(ws, msg.d);
        break;

      case Op.Answer:
        if (
          !this.isPlainObject(msg.d) ||
          typeof msg.d.sdp !== "string" ||
          msg.d.sdp.length > MAX_SDP_LENGTH
        ) {
          this.sendTo(ws, {
            op: Op.Error,
            d: { code: 4000, message: "Invalid answer payload" },
          });
          break;
        }
        await this.handleAnswer(ws, msg.d);
        break;

      case Op.TracksReady:
        if (
          !this.isPlainObject(msg.d) ||
          !this.isTrackNameArray(msg.d.track_names)
        ) {
          this.sendTo(ws, {
            op: Op.Error,
            d: { code: 4000, message: "Invalid tracks ready payload" },
          });
          break;
        }
        this.handleTracksReady(ws, msg.d);
        break;

      case Op.Speaking:
        if (
          !this.isPlainObject(msg.d) ||
          typeof msg.d.speaking !== "number" ||
          !Number.isFinite(msg.d.speaking)
        ) {
          this.sendTo(ws, {
            op: Op.Error,
            d: { code: 4000, message: "Invalid speaking payload" },
          });
          break;
        }
        this.handleSpeaking(ws, msg.d);
        break;

      case Op.ClientDisconnect:
        await this.handleLeave(ws, true);
        break;

      case Op.TrackUpdate:
        if (
          !this.isPlainObject(msg.d) ||
          !Array.isArray(msg.d.tracks) ||
          !msg.d.tracks.every(
            (track: unknown) =>
              this.isPlainObject(track) &&
              typeof track.track_name === "string" &&
              typeof track.session_id === "string" &&
              typeof track.mid === "string" &&
              typeof track.rid === "string",
          )
        ) {
          this.sendTo(ws, {
            op: Op.Error,
            d: { code: 4000, message: "Invalid track update payload" },
          });
          break;
        }
        await this.handleTrackUpdate(ws, msg.d);
        break;

      case Op.IceRestart:
        if (
          !this.isPlainObject(msg.d) ||
          typeof msg.d.sdp !== "string" ||
          (msg.d.session_type !== "push_cam" &&
            msg.d.session_type !== "push_screen" &&
            msg.d.session_type !== "pull")
        ) {
          this.sendTo(ws, {
            op: Op.Error,
            d: { code: 4000, message: "Invalid ICE restart payload" },
          });
          break;
        }
        await this.handleIceRestart(ws, msg.d);
        break;

      case Op.ResetPullSession:
        this.handleResetPullSession(ws);
        break;

      case Op.VoiceAppEvent:
        if (!this.isPlainObject(msg.d)) {
          this.sendTo(ws, {
            op: Op.Error,
            d: {
              code: 4000,
              message: "Voice app event payload must be a plain object",
            },
          });
          break;
        }
        await this.handleVoiceAppEvent(ws, msg.d);
        break;

      default:
        this.sendTo(ws, {
          op: Op.Error,
          d: {
            code: CloseCode.UnknownOpcode,
            message: `Unknown voice opcode: ${msg.op}`,
          },
        });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      await this.handleLeave(ws, false, false);
    } catch (e) {
      roomLog.error(`webSocketClose(${code}) threw in handleLeave:`, e);
    }
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
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
    let processingFailed = false;
    try {
      const now = Date.now();
      const zombies: string[] = [];

      this.demoChatStore.pruneExpired(now);

      // Check active participants for zombie timeouts using SQLite
      const participants = this.sql.exec(
        `SELECT id, last_heartbeat FROM participants`,
      );

      for (const row of participants) {
        const pid = row.id as string;
        const lastActivity = (row.last_heartbeat as number) || 0;

        if (lastActivity && now - lastActivity >= VOICE_ZOMBIE_TIMEOUT_MS) {
          log.info(
            `Pruning zombie: ${pid}, last_activity=${Math.round((now - lastActivity) / 1000)}s ago`,
          );
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
      const pending = this.sql.exec(
        `SELECT participant_id, disconnected_at FROM pending_reconnects`,
      );
      for (const row of pending) {
        const pid = row.participant_id as string;
        const disconnectedAt = row.disconnected_at as number;

        if (now - disconnectedAt >= SFU_SESSION_REUSE_GRACE_MS) {
          roomLog.info(`Grace period expired for ${pid}, cleaning up SFU`);
          await this.purgeParticipantState(pid);
        }
      }

      // Garbage-collect pending tracks from participants that went zombie
      // (is_pending = 1 means TracksReady was never received — publisher crashed)
      this.sql.exec(
        `DELETE FROM tracks WHERE is_pending = 1 AND participant_id NOT IN (SELECT id FROM participants)`,
      );
      const pendingZombie = this.sql.exec(
        `DELETE FROM tracks WHERE is_pending = 1 AND participant_id IN (
        SELECT id FROM participants WHERE last_heartbeat > 0 AND last_heartbeat < ?
      ) RETURNING track_name, participant_id`,
        now - VOICE_ZOMBIE_TIMEOUT_MS,
      );
      for (const row of pendingZombie) {
        log.info(
          `GC pending track: ${row.track_name} from ${row.participant_id}`,
        );
      }

      // SFU session health check — validate pull sessions are still alive
      // Run every cycle to detect 410'd sessions quickly
      this.ctx.waitUntil(this.validateSfuSessions());

      this.advanceListenTogetherIfNeeded(now);
    } catch (error) {
      processingFailed = true;
      roomLog.error(
        "alarm(): uncaught exception; state may be inconsistent",
        error,
      );
    } finally {
      if (processingFailed) {
        await this.ctx.storage.setAlarm(Date.now() + 60_000);
      } else {
        await this.scheduleAlarm(true);
      }
    }
  }

  private getNextAlarmTime(now: number) {
    const deadlines: number[] = [];

    for (const row of this.sql.exec(
      `SELECT last_heartbeat FROM participants WHERE last_heartbeat > 0`,
    )) {
      deadlines.push((row.last_heartbeat as number) + VOICE_ZOMBIE_TIMEOUT_MS);
    }
    for (const row of this.sql.exec(
      `SELECT disconnected_at FROM pending_reconnects`,
    )) {
      deadlines.push(
        (row.disconnected_at as number) + SFU_SESSION_REUSE_GRACE_MS,
      );
    }
    for (const row of this.sql.exec(
      `SELECT MIN(expires_at) as expires_at FROM demo_chat_messages`,
    )) {
      if (row.expires_at) deadlines.push(row.expires_at as number);
    }

    const listenTogetherDeadline = this.getListenTogetherTrackDeadline(now);
    if (listenTogetherDeadline) {
      deadlines.push(listenTogetherDeadline);
    }

    return getNextVoicePresenceAlarmTime(
      now,
      VOICE_PRUNE_ALARM_INTERVAL_MS,
      deadlines,
    );
  }

  private async scheduleAlarm(rethrow = false) {
    const now = Date.now();
    try {
      const currentAlarm = await this.ctx.storage.getAlarm();
      const countRow = [
        ...this.sql.exec(`SELECT COUNT(*) as c FROM participants`),
      ][0];
      const participantCount = Number(countRow?.c ?? 0);
      const pendingCountRow = [
        ...this.sql.exec(`SELECT COUNT(*) as c FROM pending_reconnects`),
      ][0];
      const pendingCount = Number(pendingCountRow?.c ?? 0);
      const demoChatCountRow = [
        ...this.sql.exec(`SELECT COUNT(*) as c FROM demo_chat_messages`),
      ][0];
      const demoChatCount = Number(demoChatCountRow?.c ?? 0);
      const listenTogetherDeadline = this.getListenTogetherTrackDeadline(now);
      const hasWork =
        participantCount > 0 ||
        pendingCount > 0 ||
        demoChatCount > 0 ||
        typeof listenTogetherDeadline === "number";

      if (!hasWork) {
        if (currentAlarm !== null) {
          return this.ctx.storage.deleteAlarm();
        }
        return;
      }

      const nextAlarm = this.getNextAlarmTime(now);
      if (currentAlarm === null || currentAlarm !== nextAlarm) {
        await this.ctx.storage.setAlarm(nextAlarm);
      }
    } catch (error) {
      if (rethrow) throw error;
      roomLog.error("Failed to schedule voice-room alarm", error);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private getActiveParticipantCount() {
    const row = [
      ...this.sql.exec(`
      SELECT COUNT(*) as c
      FROM participants
      WHERE id NOT IN (SELECT participant_id FROM pending_reconnects)
    `),
    ][0];
    return Number(row?.c ?? 0);
  }

  private loadListenTogetherState(): ListenTogetherPersistentState {
    return this.listenTogetherStore.loadState();
  }

  private loadListenTogetherQueue(): ListenTogetherQueueEntry[] {
    return this.listenTogetherStore.loadQueue();
  }

  private persistListenTogetherState(
    state: ListenTogetherPersistentState,
    queue: ListenTogetherQueueEntry[],
  ) {
    this.listenTogetherStore.persist(state, queue);
  }

  private getListenTogetherSnapshot(
    now = Date.now(),
  ): ListenTogetherStateSnapshot {
    const state = this.loadListenTogetherState();
    const effectiveState = state.roomSlug
      ? state
      : { ...state, roomSlug: this.roomSlug || state.roomSlug };
    return buildListenTogetherSnapshot(
      effectiveState,
      this.loadListenTogetherQueue(),
      now,
    );
  }

  private sendListenTogetherError(
    ws: WebSocket,
    roomSlug: string,
    code: string,
    message: string,
  ) {
    const payload: ListenTogetherEvent = {
      type: "listen_together.error",
      room_slug: roomSlug,
      code,
      message,
    };
    this.sendTo(ws, { op: Op.VoiceAppEvent, d: payload });
  }

  private sendListenTogetherSnapshot(
    ws: WebSocket,
    snapshot?: ListenTogetherStateSnapshot,
  ) {
    const effectiveSnapshot = snapshot ?? this.getListenTogetherSnapshot();
    const payload: ListenTogetherEvent = {
      type: "listen_together.snapshot",
      room_slug: effectiveSnapshot.roomSlug,
      snapshot: effectiveSnapshot,
    };
    this.sendTo(ws, { op: Op.VoiceAppEvent, d: payload });
  }

  private broadcastListenTogetherUpdates(
    snapshot: ListenTogetherStateSnapshot,
    queueChanged: boolean,
    playbackChanged: boolean,
  ) {
    this.broadcast({
      op: Op.VoiceAppEvent,
      d: {
        type: "listen_together.snapshot",
        room_slug: snapshot.roomSlug,
        snapshot,
      } satisfies ListenTogetherEvent,
    });

    if (queueChanged) {
      this.broadcast({
        op: Op.VoiceAppEvent,
        d: {
          type: "listen_together.queue.updated",
          room_slug: snapshot.roomSlug,
          snapshot,
        } satisfies ListenTogetherEvent,
      });
    }

    if (playbackChanged) {
      this.broadcast({
        op: Op.VoiceAppEvent,
        d: {
          type: "listen_together.playback.updated",
          room_slug: snapshot.roomSlug,
          snapshot,
        } satisfies ListenTogetherEvent,
      });
    }
  }

  private commitListenTogetherMutation(
    result: ListenTogetherMutationResult,
    now = Date.now(),
  ) {
    this.persistListenTogetherState(result.state, result.queue);
    this.broadcastListenTogetherUpdates(
      buildListenTogetherSnapshot(result.state, result.queue, now),
      result.queueChanged,
      result.playbackChanged,
    );
    this.scheduleAlarm();
  }

  private getListenTogetherTrackDeadline(now = Date.now()) {
    if (this.getActiveParticipantCount() <= 0) return null;
    const snapshot = this.getListenTogetherSnapshot(now);
    if (
      !snapshot.currentEntry ||
      snapshot.paused ||
      typeof snapshot.durationMs !== "number"
    ) {
      return null;
    }
    return now + Math.max(0, snapshot.durationMs - snapshot.positionMs);
  }

  private maybeFreezeListenTogetherForEmptyRoom(now = Date.now()) {
    if (this.getActiveParticipantCount() > 0) return;
    const state = this.loadListenTogetherState();
    const queue = this.loadListenTogetherQueue();
    const result = freezeListenTogetherPlayback(
      this.roomSlug || state.roomSlug,
      queue,
      state,
      now,
    );
    if (!result.playbackChanged) return;
    this.persistListenTogetherState(result.state, result.queue);
  }

  private advanceListenTogetherIfNeeded(now = Date.now()) {
    if (this.getActiveParticipantCount() <= 0) return;

    const state = this.loadListenTogetherState();
    const queue = this.loadListenTogetherQueue();
    const snapshot = buildListenTogetherSnapshot(state, queue, now);
    if (
      !snapshot.currentEntry ||
      snapshot.paused ||
      typeof snapshot.durationMs !== "number"
    ) {
      return;
    }
    if (snapshot.positionMs < snapshot.durationMs) {
      return;
    }

    const result = skipListenTogether(
      this.roomSlug || snapshot.roomSlug,
      queue,
      state,
      now,
    );
    this.commitListenTogetherMutation(
      {
        ...result,
        playbackChanged: true,
      },
      now,
    );
  }

  private async sanitizeListenTogetherEnqueueEntries(
    entries: unknown,
    callerUserId: string | null,
  ): Promise<ListenTogetherEnqueueCommand["entries"]> {
    if (!Array.isArray(entries)) return [];
    const musicProviders = new Set<ListenTogetherMusicProvider>([
      "youtube",
      "youtube_music",
      "spotify",
    ]);

    const sanitizedEntries: ListenTogetherEnqueueCommand["entries"] = [];
    const resolvedRadioStations = new Map<
      string,
      Awaited<ReturnType<VoiceRoom["resolveRadioStation"]>>
    >();
    const queuedRadioStationIds = new Set<string>();
    for (const entry of entries.slice(0, LISTEN_TOGETHER_IMPORT_LIMIT)) {
      if (!entry || typeof entry !== "object") continue;
      const payload = entry as Record<string, unknown>;
      const track = payload.track as Record<string, unknown> | undefined;
      const requester = payload.requester as
        | Record<string, unknown>
        | undefined;
      const kind = track?.kind === "radio" ? "radio" : "music";

      if (kind === "radio") {
        if (track?.provider !== "radio") continue;

        // Radio track validation
        const stationUuid =
          typeof track?.station_uuid === "string"
            ? track.station_uuid.trim()
            : "";
        if (!RADIO_STATION_UUID_PATTERN.test(stationUuid)) continue;

        if (
          !resolvedRadioStations.has(stationUuid) &&
          resolvedRadioStations.size >= MAX_RADIO_STATION_LOOKUPS_PER_ENQUEUE
        ) {
          continue;
        }
        if (!resolvedRadioStations.has(stationUuid)) {
          resolvedRadioStations.set(
            stationUuid,
            await this.resolveRadioStation(stationUuid, callerUserId),
          );
        }
        const station = resolvedRadioStations.get(stationUuid);
        if (!station || queuedRadioStationIds.has(stationUuid)) continue;
        queuedRadioStationIds.add(stationUuid);

        sanitizedEntries.push({
          track: station,
          requester: {
            userId:
              callerUserId ||
              (typeof requester?.userId === "string"
                ? requester.userId.slice(0, 160)
                : "guest"),
            displayName:
              typeof requester?.displayName === "string"
                ? requester.displayName.trim().slice(0, 80)
                : "Guest",
            avatarUrl:
              typeof requester?.avatarUrl === "string"
                ? requester.avatarUrl.slice(0, 2048)
                : null,
            avatarDisplay:
              typeof requester?.avatarDisplay === "string"
                ? requester.avatarDisplay.slice(0, 64)
                : null,
          },
          importBatchId:
            typeof payload.importBatchId === "string"
              ? payload.importBatchId.slice(0, 120)
              : null,
          importBatchLabel:
            typeof payload.importBatchLabel === "string"
              ? payload.importBatchLabel.slice(0, 120)
              : null,
        });
      } else {
        const provider =
          typeof track?.provider === "string" &&
          musicProviders.has(track.provider as ListenTogetherMusicProvider)
            ? (track.provider as ListenTogetherMusicProvider)
            : null;
        if (!provider) continue;

        // Music track validation (existing logic)
        const videoId =
          typeof track?.videoId === "string" &&
          isValidListenTogetherVideoId(track.videoId)
            ? track.videoId
            : null;
        const title =
          typeof track?.title === "string"
            ? track.title.trim().slice(0, 160)
            : "";
        const durationMs = Number(track?.durationMs ?? 0);
        if (
          !videoId ||
          !title ||
          !Number.isFinite(durationMs) ||
          durationMs <= 0
        ) {
          continue;
        }

        sanitizedEntries.push({
          track: {
            kind: "music" as const,
            id:
              typeof track?.id === "string"
                ? track.id.slice(0, 160)
                : `${provider}:${videoId}`,
            provider,
            videoId,
            title,
            artist:
              typeof track?.artist === "string"
                ? track.artist.trim().slice(0, 120)
                : null,
            album:
              typeof track?.album === "string"
                ? track.album.trim().slice(0, 120)
                : null,
            durationMs: Math.max(1, Math.floor(durationMs)),
            artworkUrl:
              typeof track?.artworkUrl === "string"
                ? track.artworkUrl.slice(0, 2048)
                : null,
            canonicalUrl:
              typeof track?.canonicalUrl === "string"
                ? track.canonicalUrl.slice(0, 2048)
                : `https://www.youtube.com/watch?v=${videoId}`,
            sourceUrl:
              typeof track?.sourceUrl === "string"
                ? track.sourceUrl.slice(0, 2048)
                : null,
            sourceLabel:
              typeof track?.sourceLabel === "string"
                ? track.sourceLabel.trim().slice(0, 48)
                : "YouTube",
          },
          requester: {
            userId:
              callerUserId ||
              (typeof requester?.userId === "string"
                ? requester.userId.slice(0, 160)
                : "guest"),
            displayName:
              typeof requester?.displayName === "string"
                ? requester.displayName.trim().slice(0, 80)
                : "Guest",
            avatarUrl:
              typeof requester?.avatarUrl === "string"
                ? requester.avatarUrl.slice(0, 2048)
                : null,
            avatarDisplay:
              typeof requester?.avatarDisplay === "string"
                ? requester.avatarDisplay.slice(0, 64)
                : null,
          },
          importBatchId:
            typeof payload.importBatchId === "string"
              ? payload.importBatchId.slice(0, 120)
              : null,
          importBatchLabel:
            typeof payload.importBatchLabel === "string"
              ? payload.importBatchLabel.slice(0, 120)
              : null,
        });
      }
    }

    return sanitizedEntries;
  }

  private async resolveRadioStation(
    stationUuid: string,
    callerUserId: string | null,
  ) {
    return this.radioStationResolver.resolve(stationUuid, callerUserId);
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  private isRateLimited(ws: WebSocket, op: number): boolean {
    const limit = VOICE_WS_RATE_LIMITS[op];
    if (!limit) return false;

    const attachment = this.getVoiceAttachment(ws);
    const subject = attachment?.admission?.subject;
    const keys = [
      `session:${attachment?.participant_id ?? "unidentified"}:${op}`,
      ...(subject ? [`subject:${subject}:${op}`] : []),
    ];
    const now = Date.now();
    let limited = false;

    for (const key of keys) {
      const rows = [
        ...this.sql.exec(
          "SELECT window_start, count FROM ws_rate_limits WHERE rate_key = ?",
          key,
        ),
      ];
      const existing = rows[0];
      if (
        !existing ||
        now - Number(existing.window_start) >= VOICE_WS_RATE_LIMIT_WINDOW_MS
      ) {
        this.sql.exec(
          `INSERT INTO ws_rate_limits (rate_key, window_start, count)
           VALUES (?, ?, 1)
           ON CONFLICT(rate_key) DO UPDATE SET window_start = excluded.window_start, count = 1`,
          key,
          now,
        );
        continue;
      }
      const count = Number(existing.count) + 1;
      this.sql.exec(
        "UPDATE ws_rate_limits SET count = ? WHERE rate_key = ?",
        count,
        key,
      );
      if (count > limit) limited = true;
    }
    this.sql.exec(
      "DELETE FROM ws_rate_limits WHERE window_start < ?",
      now - VOICE_WS_RATE_LIMIT_WINDOW_MS,
    );
    return limited;
  }

  private isTrackInfoArray(value: unknown): value is TrackInfo[] {
    if (!Array.isArray(value) || value.length > MAX_NEGOTIATION_TRACKS)
      return false;
    return value.every((item) => {
      if (!this.isPlainObject(item)) return false;
      return (
        typeof item.participant_id === "string" &&
        item.participant_id.length > 0 &&
        item.participant_id.length <= 200 &&
        typeof item.track_name === "string" &&
        item.track_name.length > 0 &&
        item.track_name.length <= 200 &&
        typeof item.session_id === "string" &&
        item.session_id.length > 0 &&
        item.session_id.length <= 200 &&
        (item.mid === undefined ||
          (typeof item.mid === "string" && item.mid.length <= 64)) &&
        (item.kind === "audio" || item.kind === "video") &&
        (item.rid === undefined ||
          (typeof item.rid === "string" && item.rid.length <= 32))
      );
    });
  }

  private isSelectProtocolPayload(value: unknown): value is {
    sdp?: string;
    push_tracks: PushTrackDescriptor[];
    pull_tracks: TrackInfo[];
    push_prefix?: string;
    request_id?: string;
  } {
    if (!this.isPlainObject(value)) return false;
    if (
      (value.sdp !== undefined &&
        (typeof value.sdp !== "string" || value.sdp.length > MAX_SDP_LENGTH)) ||
      !Array.isArray(value.push_tracks) ||
      value.push_tracks.length > MAX_NEGOTIATION_TRACKS ||
      !value.push_tracks.every((item) => {
        if (!this.isPlainObject(item)) return false;
        return (
          typeof item.track_name === "string" &&
          item.track_name.length > 0 &&
          item.track_name.length <= 200 &&
          (item.mid === undefined ||
            (typeof item.mid === "string" && item.mid.length <= 64)) &&
          (item.kind === "audio" || item.kind === "video")
        );
      }) ||
      !this.isTrackInfoArray(value.pull_tracks)
    ) {
      return false;
    }
    if (value.push_tracks.length > 0 && !value.sdp?.trim()) return false;
    return (
      (value.push_prefix === undefined ||
        value.push_prefix === "cam" ||
        value.push_prefix === "screen") &&
      (value.request_id === undefined ||
        (typeof value.request_id === "string" &&
          value.request_id.length <= 200))
    );
  }

  private handleListenTogetherCommand(
    ws: WebSocket,
    d: ListenTogetherCommand,
    callerUserId: string | null,
  ) {
    const command = this.listenTogetherCommandQueue.then(() =>
      this.handleListenTogetherCommandInOrder(ws, d, callerUserId),
    );
    this.listenTogetherCommandQueue = command.catch(() => {});
    return command;
  }

  private async handleListenTogetherCommandInOrder(
    ws: WebSocket,
    d: ListenTogetherCommand,
    callerUserId: string | null,
  ) {
    if (!this.isCurrentAuthenticatedVoiceSocket(ws)) return;

    const roomSlug =
      typeof d.room_slug === "string" && d.room_slug.trim()
        ? d.room_slug.trim()
        : this.roomSlug;

    if (!roomSlug || (this.roomSlug && roomSlug !== this.roomSlug)) {
      this.sendListenTogetherError(
        ws,
        roomSlug || this.roomSlug,
        "ROOM_MISMATCH",
        "Voice room mismatch",
      );
      return;
    }

    if (d.type === "listen_together.state.request") {
      this.sendListenTogetherSnapshot(ws);
      return;
    }

    if (d.type === "listen_together.enqueue") {
      const entries = await this.sanitizeListenTogetherEnqueueEntries(
        d.entries,
        callerUserId,
      );
      if (!this.isCurrentAuthenticatedVoiceSocket(ws)) return;
      const state = this.loadListenTogetherState();
      const queue = this.loadListenTogetherQueue();
      const effectiveRoomSlug = this.roomSlug || roomSlug || state.roomSlug;
      if (entries.length === 0) {
        this.sendListenTogetherError(
          ws,
          effectiveRoomSlug,
          "EMPTY_QUEUE",
          "Nothing valid to queue",
        );
        return;
      }
      const result = enqueueListenTogetherEntries(
        effectiveRoomSlug,
        queue,
        state,
        entries,
        d.mode === "play-next" || d.mode === "play-now" ? d.mode : "append",
        Date.now(),
      );
      this.commitListenTogetherMutation(result);
      return;
    }

    const state = this.loadListenTogetherState();
    const queue = this.loadListenTogetherQueue();
    const effectiveRoomSlug = this.roomSlug || roomSlug || state.roomSlug;
    const now = Date.now();
    const requiresCurrentEntry =
      d.type === "listen_together.pause" ||
      d.type === "listen_together.seek" ||
      d.type === "listen_together.skip";
    if (requiresCurrentEntry) {
      const entryId =
        "entryId" in d && typeof d.entryId === "string" ? d.entryId.trim() : "";
      if (!entryId) {
        this.sendListenTogetherError(
          ws,
          effectiveRoomSlug,
          "INVALID_ENTRY",
          "Playback command is missing its queue entry",
        );
        return;
      }
      if (entryId !== state.currentEntryId) return;
    }
    let result:
      | ReturnType<typeof enqueueListenTogetherEntries>
      | ReturnType<typeof playListenTogether>
      | ReturnType<typeof pauseListenTogether>
      | ReturnType<typeof seekListenTogether>
      | ReturnType<typeof skipListenTogether>
      | ReturnType<typeof removeListenTogetherEntry>
      | ReturnType<typeof clearListenTogether>
      | null = null;

    switch (d.type) {
      case "listen_together.play":
        result = playListenTogether(
          effectiveRoomSlug,
          queue,
          state,
          d.entryId,
          now,
        );
        break;
      case "listen_together.pause":
        if (typeof d.paused !== "boolean") {
          this.sendListenTogetherError(
            ws,
            effectiveRoomSlug,
            "INVALID_PAUSE",
            "Pause state is invalid",
          );
          return;
        }
        result = pauseListenTogether(
          effectiveRoomSlug,
          queue,
          state,
          d.paused,
          now,
        );
        break;
      case "listen_together.seek":
        if (
          typeof d.positionMs !== "number" ||
          !Number.isFinite(d.positionMs)
        ) {
          this.sendListenTogetherError(
            ws,
            effectiveRoomSlug,
            "INVALID_SEEK",
            "Seek position is invalid",
          );
          return;
        }
        result = seekListenTogether(
          effectiveRoomSlug,
          queue,
          state,
          d.positionMs,
          now,
        );
        break;
      case "listen_together.skip":
        result = skipListenTogether(effectiveRoomSlug, queue, state, now);
        break;
      case "listen_together.remove":
        if (typeof d.entryId !== "string" || !d.entryId.trim()) {
          this.sendListenTogetherError(
            ws,
            effectiveRoomSlug,
            "INVALID_REMOVE",
            "Queue entry is invalid",
          );
          return;
        }
        result = removeListenTogetherEntry(
          effectiveRoomSlug,
          queue,
          state,
          d.entryId.trim(),
          now,
        );
        break;
      case "listen_together.clear":
        result = clearListenTogether(effectiveRoomSlug, state, now);
        break;
    }

    if (!result) return;

    if (!this.isCurrentAuthenticatedVoiceSocket(ws)) return;

    this.commitListenTogetherMutation(result, now);
  }

  private getWsByParticipant(participantId: string): WebSocket | undefined {
    const rows = [
      ...this.sql.exec(
        "SELECT connection_id FROM participants WHERE id = ?",
        participantId,
      ),
    ];
    const currentConnectionId =
      rows.length > 0 ? (rows[0].connection_id as string | null) : null;
    let fallback: WebSocket | undefined;

    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as VoiceAttachment | null;
      if (attachment?.participant_id === participantId) {
        if (
          !currentConnectionId ||
          attachment.connection_id === currentConnectionId
        ) {
          return ws;
        }
        fallback = fallback ?? ws;
      }
    }
    return fallback;
  }

  private getVoiceAttachment(ws: WebSocket): VoiceAttachment | null {
    return ws.deserializeAttachment() as VoiceAttachment | null;
  }

  private isPublicDemoSocket(ws: WebSocket): boolean {
    return this.getVoiceAttachment(ws)?.admission?.accessMode === "public-demo";
  }

  private isAllowedPublicDemoOpcode(op: number): boolean {
    return (
      op === Op.VoiceIdentify ||
      op === Op.Heartbeat ||
      op === Op.SelectProtocol ||
      op === Op.Video ||
      op === Op.StopTracks ||
      op === Op.Answer ||
      op === Op.TracksReady ||
      op === Op.Speaking ||
      op === Op.ClientDisconnect ||
      op === Op.TrackUpdate ||
      op === Op.IceRestart ||
      op === Op.ResetPullSession ||
      op === Op.VoiceAppEvent
    );
  }

  private async disconnectParticipantImmediately(
    participantId: string,
  ): Promise<boolean> {
    const ws = this.getWsByParticipant(participantId);
    if (ws) {
      await this.handleLeave(ws, true, true);
      return true;
    }

    const row = [
      ...this.sql.exec(
        "SELECT id FROM participants WHERE id = ?",
        participantId,
      ),
    ][0];
    if (!row) {
      return false;
    }

    await this.disconnectParticipant(participantId, false);
    return true;
  }

  private getParticipantId(ws: WebSocket): string | undefined {
    const attachment = this.getVoiceAttachment(ws);
    return attachment?.participant_id;
  }

  private isCurrentVoiceConnection(
    ws: WebSocket,
    participantId: string,
    connectionId: string | undefined,
  ): boolean {
    if (this.getParticipantId(ws) !== participantId) return false;
    if (!connectionId) return true;
    const rows = [
      ...this.sql.exec(
        "SELECT connection_id FROM participants WHERE id = ?",
        participantId,
      ),
    ];
    return rows.length > 0 && rows[0].connection_id === connectionId;
  }

  private isAuthenticatedMutatingOpcode(op: number): boolean {
    return (
      op === Op.Heartbeat ||
      op === Op.SelectProtocol ||
      op === Op.Video ||
      op === Op.StopTracks ||
      op === Op.Answer ||
      op === Op.TracksReady ||
      op === Op.Speaking ||
      op === Op.ClientDisconnect ||
      op === Op.TrackUpdate ||
      op === Op.IceRestart ||
      op === Op.ResetPullSession ||
      op === Op.VoiceAppEvent
    );
  }

  private isCurrentAuthenticatedVoiceSocket(ws: WebSocket): boolean {
    const participantId = this.getParticipantId(ws);
    if (!participantId) return true;
    return this.isCurrentVoiceConnection(
      ws,
      participantId,
      this.getVoiceAttachment(ws)?.connection_id,
    );
  }

  private isTrackNameArray(value: unknown): value is string[] {
    return (
      Array.isArray(value) &&
      value.length <= MAX_NEGOTIATION_TRACKS &&
      value.every(
        (name) =>
          typeof name === "string" && name.length > 0 && name.length <= 200,
      )
    );
  }

  private hasTrackNameConflict(trackName: string, participantId: string) {
    const rows = [
      ...this.sql.exec(
        "SELECT participant_id FROM tracks WHERE track_name = ? LIMIT 1",
        trackName,
      ),
    ];
    return rows.length > 0 && rows[0].participant_id !== participantId;
  }

  private requireParticipantId(ws: WebSocket): string | null {
    const pid = this.getParticipantId(ws);
    if (!pid) {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.NotAuthenticated,
          message: "Not identified on voice",
        },
      });
      return null;
    }
    return pid;
  }

  private getUserIdForParticipant(participantId: string): string | null {
    const rows = [
      ...this.sql.exec(
        "SELECT clerk_user_id FROM participants WHERE id = ?",
        participantId,
      ),
    ];
    if (rows.length === 0) return null;
    const clerkUserId = rows[0].clerk_user_id as string | null;
    return clerkUserId || participantId;
  }

  private getActiveScreenParticipantIdForUserId(userId: string): string | null {
    const rows = [
      ...this.sql.exec(
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
      ),
    ];
    return rows.length > 0 ? (rows[0].id as string) : null;
  }

  private getStreamWatcherSnapshot() {
    return this.streamWatcherStore.snapshot();
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
    return this.streamWatcherStore.remove(streamerUserId, viewerUserId);
  }

  private clearStreamWatchersByViewerUserId(viewerUserId: string) {
    return this.streamWatcherStore.clearByViewer(viewerUserId);
  }

  private clearStreamWatchersByStreamerUserId(streamerUserId: string) {
    return this.streamWatcherStore.clearByStreamer(streamerUserId);
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
    d: { participant_id: string; voice_token: string },
  ) {
    if (this.getParticipantId(ws)) {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.AlreadyAuthenticated,
          message: "Already identified",
        },
      });
      return;
    }

    const admission = this.getVoiceAttachment(ws)?.admission;
    const verification = await verifyVoiceToken({
      token: d.voice_token,
      participantId: d.participant_id,
      roomSlug: this.roomSlug,
      secret: this.env.CALLS_APP_SECRET,
      expectedSubject: admission?.subject,
    });

    if (!admission || verification.reason === "subject") {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.AdmissionRejected,
          message: "Voice token subject mismatch",
        },
      });
      try {
        ws.close(CloseCode.AdmissionRejected, "Voice token subject mismatch");
      } catch {}
      return;
    }

    if (verification.reason === "format") {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.AuthenticationFailed,
          message: "Invalid voice token format",
        },
      });
      return;
    }

    if (verification.reason === "identity") {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.AuthenticationFailed,
          message: "Invalid voice token",
        },
      });
      return;
    }

    if (verification.reason === "expired") {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.AuthenticationFailed,
          message: "Voice token expired",
        },
      });
      return;
    }

    if (verification.reason === "signature") {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.AuthenticationFailed,
          message: "Voice token verification failed",
        },
      });
      return;
    }

    const clerkUserId =
      admission.accessMode === "authenticated" ? admission.subject : undefined;

    const connectionId = crypto.randomUUID();
    const attachment: VoiceAttachment = {
      admission,
      participant_id: d.participant_id,
      connection_id: connectionId,
    };

    let push_session_cam: string | null = null;
    let push_session_screen: string | null = null;
    const pull_session_id: string | null = null;
    let didTransfer = false;

    // Check for pending reconnects or stale sessions
    const pendingRows = [
      ...this.sql.exec(
        "SELECT * FROM pending_reconnects WHERE participant_id = ?",
        d.participant_id,
      ),
    ];

    if (pendingRows.length > 0) {
      const pending = pendingRows[0];
      const disconnectedAt = pending.disconnected_at as number;
      if (
        isReconnectWithinGrace(
          disconnectedAt,
          Date.now(),
          SFU_SESSION_REUSE_GRACE_MS,
        )
      ) {
        const pRows = [
          ...this.sql.exec(
            "SELECT push_session_cam, push_session_screen FROM participants WHERE id = ?",
            d.participant_id,
          ),
        ];
        if (pRows.length > 0) {
          push_session_cam = pRows[0].push_session_cam as string;
          push_session_screen = pRows[0].push_session_screen as string;

          const tRows = [
            ...this.sql.exec(
              "SELECT COUNT(*) as c FROM tracks WHERE participant_id = ? AND is_pending = 0",
              d.participant_id,
            ),
          ];
          didTransfer = (tRows[0].c as number) > 0;

          roomLog.info(
            `Transferring pending SFU sessions for ${d.participant_id}: cam=${push_session_cam ?? "none"}`,
          );
        }
        this.sql.exec(
          "DELETE FROM pending_reconnects WHERE participant_id = ?",
          d.participant_id,
        );
      } else {
        roomLog.info(
          `Pending reconnect already expired for ${d.participant_id}, forcing fresh media state`,
        );
        await this.purgeParticipantState(d.participant_id);
      }
    } else if (clerkUserId) {
      const staleCursor = this.sql.exec(
        "SELECT p.id as pid FROM pending_reconnects r JOIN participants p ON r.participant_id = p.id WHERE p.clerk_user_id = ?",
        clerkUserId,
      );
      for (const row of staleCursor) {
        const oldPid = row.pid as string;
        roomLog.info(
          `Fresh join for clerk=${clerkUserId}, cleaning up stale SFU sessions from old participant=${oldPid}`,
        );
        this.ctx.waitUntil(this.cleanupSfuSessionsByParticipantId(oldPid));

        const trackNames = [
          ...this.sql.exec(
            "SELECT track_name FROM tracks WHERE participant_id = ?",
            oldPid,
          ),
        ].map((r) => r.track_name as string);
        if (trackNames.length > 0) {
          this.broadcast({
            op: Op.StopTracks,
            d: { participant_id: oldPid, track_names: trackNames },
          });
        }

        this.sql.exec(
          "DELETE FROM pending_reconnects WHERE participant_id = ?",
          oldPid,
        );
        this.sql.exec("DELETE FROM tracks WHERE participant_id = ?", oldPid);
        this.sql.exec("DELETE FROM participants WHERE id = ?", oldPid);
      }
    }

    // Evict any existing LIVE session for the same participant_id OR clerk_user_id
    for (const otherWs of this.ctx.getWebSockets()) {
      if (otherWs === ws) continue;
      const otherAtt =
        otherWs.deserializeAttachment() as VoiceAttachment | null;
      if (!otherAtt?.participant_id) continue;

      const pRows = [
        ...this.sql.exec(
          "SELECT clerk_user_id FROM participants WHERE id = ?",
          otherAtt.participant_id,
        ),
      ];
      const otherClerkId =
        pRows.length > 0 ? (pRows[0].clerk_user_id as string) : undefined;

      if (
        otherAtt.participant_id === d.participant_id ||
        (clerkUserId && otherClerkId === clerkUserId)
      ) {
        roomLog.info(
          `Evicting duplicate session for participant=${otherAtt.participant_id}`,
        );
        if (otherAtt.participant_id !== d.participant_id) {
          // not already transferred
          this.ctx.waitUntil(
            this.cleanupSfuSessionsByParticipantId(otherAtt.participant_id),
          );
        }
        try {
          otherWs.close(1000, "Replaced by new connection");
        } catch {}
      }
    }

    ws.serializeAttachment(attachment);

    this.sql.exec(
      `INSERT INTO participants (id, clerk_user_id, push_session_cam, push_session_screen, pull_session_id, last_heartbeat, speaking, connection_id)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(id) DO UPDATE SET
         clerk_user_id = excluded.clerk_user_id,
         last_heartbeat = excluded.last_heartbeat,
         connection_id = excluded.connection_id`,
      d.participant_id,
      clerkUserId ?? null,
      push_session_cam,
      push_session_screen,
      pull_session_id,
      Date.now(),
      connectionId,
    );

    roomLog.info(`VoiceIdentify: participant=${d.participant_id}`);

    const existingTracks: TrackInfo[] = [];
    const tCursor = this.sql.exec(
      "SELECT track_name, participant_id, session_id, mid, kind FROM tracks WHERE participant_id != ? AND is_pending = 0",
      d.participant_id,
    );
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
    const sCursor = this.sql.exec(
      "SELECT id, speaking FROM participants WHERE speaking > 0 AND id != ?",
      d.participant_id,
    );
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

    // Pull sessions are created lazily by the current negotiation. Creating
    // them in the background can race a reconnect and strand an unused SFU
    // session behind the newer participant generation.
  }

  // ── Op 3: Heartbeat ────────────────────────────────────────────────────

  private handleHeartbeat(ws: WebSocket) {
    const pid = this.getParticipantId(ws);
    if (!pid) {
      this.sendTo(ws, { op: Op.HeartbeatACK, d: { seq: 0 } });
      return;
    }

    this.sql.exec(
      "UPDATE participants SET last_heartbeat = ? WHERE id = ?",
      Date.now(),
      pid,
    );
    this.sendTo(ws, { op: Op.HeartbeatACK, d: { seq: 0 } });
  }

  // ── Op 5: Speaking (forwarded to all other voice participants) ─────────

  private handleSpeaking(ws: WebSocket, d: { speaking: number }) {
    const pid = this.requireParticipantId(ws);
    if (!pid) return;
    const connectionId = this.getVoiceAttachment(ws)?.connection_id;
    const isCurrent = () =>
      this.isCurrentVoiceConnection(ws, pid, connectionId);
    if (!isCurrent()) return;

    this.sql.exec(
      "UPDATE participants SET speaking = ? WHERE id = ?",
      d.speaking,
      pid,
    );

    this.broadcast(
      {
        op: Op.Speaking,
        d: { participant_id: pid, speaking: d.speaking },
      },
      ws,
    );
  }

  // ── Op 1: SelectProtocol (push/pull tracks) ────────────────────────────

  private handleSelectProtocol(
    ws: WebSocket,
    d: {
      sdp?: string;
      push_tracks: PushTrackDescriptor[];
      pull_tracks: TrackInfo[];
      push_prefix?: string;
      request_id?: string;
    },
  ) {
    const operation = this.selectProtocolQueue.then(() =>
      this.handleSelectProtocolInOrder(ws, d),
    );
    this.selectProtocolQueue = operation.catch(() => {});
    return operation;
  }

  private async handleSelectProtocolInOrder(
    ws: WebSocket,
    d: {
      sdp?: string;
      push_tracks: PushTrackDescriptor[];
      pull_tracks: TrackInfo[];
      push_prefix?: string;
      request_id?: string;
    },
  ) {
    const pid = this.requireParticipantId(ws);
    if (!pid) return;
    const connectionId = this.getVoiceAttachment(ws)?.connection_id;
    const isCurrent = () =>
      this.isCurrentVoiceConnection(ws, pid, connectionId);
    if (!isCurrent()) return;

    let activeOperation: "push" | "pull" | null = null;
    let activePushPrefix: "cam" | "screen" | null = null;

    try {
      const pRows = [
        ...this.sql.exec(
          "SELECT push_session_cam, push_session_screen, pull_session_id FROM participants WHERE id = ?",
          pid,
        ),
      ];
      if (pRows.length === 0) return;
      const row = pRows[0];
      let push_session_cam = row.push_session_cam as string | null;
      let push_session_screen = row.push_session_screen as string | null;
      let pull_session_id = row.pull_session_id as string | null;

      // ── Handle push (local) tracks ──────────────────────────────────
      if (d.push_tracks.length > 0 && d.sdp) {
        const prefix = d.push_prefix === "screen" ? "screen" : "cam";
        const isScreen = prefix === "screen";
        activeOperation = "push";
        activePushPrefix = prefix;

        if (
          new Set(d.push_tracks.map((track) => track.track_name)).size !==
            d.push_tracks.length ||
          d.push_tracks.some((track) =>
            this.hasTrackNameConflict(track.track_name, pid),
          )
        ) {
          this.sendTo(ws, {
            op: Op.Error,
            d: { code: 4000, message: "Track name is already in use" },
          });
          return;
        }

        let pushSessionId = isScreen ? push_session_screen : push_session_cam;

        if (!pushSessionId) {
          if (!isCurrent()) return;
          const sessionResp = await this.sfuFetch("POST", "sessions/new");
          if (!isCurrent()) return;
          pushSessionId = sessionResp.sessionId as string;
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
          if (!isCurrent()) return;
          pushResp = await this.sfuPost(
            `sessions/${pushSessionId}/tracks/new`,
            {
              tracks: localTracks,
              sessionDescription: { type: "offer", sdp: d.sdp },
            },
          );
        } catch (pushErr: unknown) {
          const pushMsg =
            pushErr instanceof Error ? pushErr.message : String(pushErr);
          if (pushMsg.includes("(410)") || pushMsg.includes("session_error")) {
            sfuLog.warn(
              `Push session ${prefix} stale (${pushSessionId.slice(0, 8)}...), creating fresh session and retrying`,
            );
            if (!isCurrent()) return;
            const freshResp = await this.sfuFetch("POST", "sessions/new");
            if (!isCurrent()) return;
            pushSessionId = freshResp.sessionId as string;

            sfuLog.info(`Fresh push session (${prefix}):`, pushSessionId);
            if (!isCurrent()) return;
            pushResp = await this.sfuPost(
              `sessions/${pushSessionId}/tracks/new`,
              {
                tracks: localTracks,
                sessionDescription: { type: "offer", sdp: d.sdp },
              },
            );
          } else {
            throw pushErr;
          }
        }

        if (!isCurrent()) return;
        if (isScreen) {
          push_session_screen = pushSessionId;
          this.sql.exec(
            "UPDATE participants SET push_session_screen = ? WHERE id = ?",
            pushSessionId,
            pid,
          );
        } else {
          push_session_cam = pushSessionId;
          this.sql.exec(
            "UPDATE participants SET push_session_cam = ? WHERE id = ?",
            pushSessionId,
            pid,
          );
        }
        sfuLog.info(
          "Push tracks/new response tracks:",
          JSON.stringify(pushResp.tracks),
        );
        const answerSdp =
          (pushResp.sessionDescription as { sdp?: string } | undefined)?.sdp ??
          "";
        if (!answerSdp) {
          throw new Error(
            `SFU push tracks/new returned no answer SDP for ${prefix} session ${pushSessionId.slice(0, 8)}...`,
          );
        }

        const respTracks =
          (pushResp.tracks as Array<Record<string, unknown>>) ?? [];
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

        if (
          !isCurrent() ||
          negotiatedTracks.some((track) =>
            this.hasTrackNameConflict(track.track_name, pid),
          )
        ) {
          if (isCurrent()) {
            this.sendTo(ws, {
              op: Op.Error,
              d: { code: 4000, message: "Track name is already in use" },
            });
          }
          return;
        }

        // Insert tracks into SQLite as PENDING (is_pending = 1)
        try {
          for (const t of negotiatedTracks) {
            this.sql.exec(
              `INSERT INTO tracks (track_name, participant_id, session_id, mid, kind, is_pending)
               VALUES (?, ?, ?, ?, ?, 1)
               ON CONFLICT(track_name) DO UPDATE SET session_id=excluded.session_id, mid=excluded.mid, is_pending=1
               WHERE tracks.participant_id = excluded.participant_id`,
              t.track_name,
              pid,
              t.session_id,
              t.mid ?? null,
              t.kind,
            );
          }
        } catch {
          this.sendTo(ws, {
            op: Op.Error,
            d: { code: 4000, message: "Track name is already in use" },
          });
          return;
        }

        this.sendTo(ws, {
          op: Op.SessionDescription,
          d: {
            sdp: answerSdp,
            session_id: pushSessionId,
            tracks: negotiatedTracks,
            sdp_type: "answer",
            push_prefix: prefix,
            request_id: d.request_id,
            operation: "push",
          },
        });
      }

      // ── Handle pull (remote) tracks ─────────────────────────────────
      if (d.pull_tracks.length > 0) {
        if (!isCurrent()) return;
        activeOperation = "pull";
        activePushPrefix = null;

        const requestedNames = d.pull_tracks.map((track) => track.track_name);
        if (
          requestedNames.some(
            (name) => typeof name !== "string" || !name.trim(),
          ) ||
          new Set(requestedNames).size !== requestedNames.length
        ) {
          this.sendTo(ws, {
            op: Op.Error,
            d: { code: 4000, message: "Invalid pull track list" },
          });
          return;
        }

        const placeholders = requestedNames.map(() => "?").join(",");
        const persistedTracks = new Map<string, TrackInfo>();
        for (const row of this.sql.exec(
          `SELECT track_name, participant_id, session_id, mid, kind
           FROM tracks
           WHERE track_name IN (${placeholders}) AND is_pending = 0`,
          ...requestedNames,
        )) {
          persistedTracks.set(row.track_name as string, {
            track_name: row.track_name as string,
            participant_id: row.participant_id as string,
            session_id: row.session_id as string,
            mid: (row.mid as string) || undefined,
            kind: row.kind as "audio" | "video",
          });
        }

        const canonicalPullTracks = d.pull_tracks.map((requested) => {
          const persisted = persistedTracks.get(requested.track_name);
          if (
            !persisted ||
            requested.participant_id !== persisted.participant_id ||
            requested.session_id !== persisted.session_id
          )
            return null;
          return { requested, persisted };
        });
        if (canonicalPullTracks.some((track) => track === null)) {
          this.sendTo(ws, {
            op: Op.Error,
            d: { code: 4000, message: "Requested track is not available" },
          });
          return;
        }
        const validCanonicalPullTracks = canonicalPullTracks.filter(
          (track): track is { requested: TrackInfo; persisted: TrackInfo } =>
            track !== null,
        );

        if (!pull_session_id) {
          if (!isCurrent()) return;
          const sessionResp = await this.sfuFetch("POST", "sessions/new");
          if (!isCurrent()) return;
          pull_session_id = sessionResp.sessionId as string;
          this.sql.exec(
            "UPDATE participants SET pull_session_id = ? WHERE id = ?",
            pull_session_id,
            pid,
          );
          sfuLog.info("Created pull session:", pull_session_id);
        }

        const remoteTracks = validCanonicalPullTracks.map(
          ({ requested, persisted }) => {
            const base: Record<string, unknown> = {
              location: "remote",
              trackName: persisted.track_name,
              sessionId: persisted.session_id,
            };
            if (persisted.kind === "video" && requested.rid) {
              const isScreen = persisted.track_name.startsWith("screen-");
              base.simulcast = {
                preferredRid: requested.rid,
                priorityOrdering: isScreen ? "none" : "asciibetical",
                ridNotAvailable: "asciibetical",
              };
            }
            return base;
          },
        );

        let pullResp: Record<string, unknown>;
        try {
          if (!isCurrent()) return;
          pullResp = await this.sfuPost(
            `sessions/${pull_session_id}/tracks/new`,
            {
              tracks: remoteTracks,
            },
          );
        } catch (pullErr: unknown) {
          const pullMsg =
            pullErr instanceof Error ? pullErr.message : String(pullErr);
          if (pullMsg.includes("(410)") || pullMsg.includes("session_error")) {
            sfuLog.warn(
              `Pull session stale (${pull_session_id.slice(0, 8)}...), creating fresh session and retrying`,
            );
            if (!isCurrent()) return;
            const freshResp = await this.sfuFetch("POST", "sessions/new");
            if (!isCurrent()) return;
            pull_session_id = freshResp.sessionId as string;
            this.sql.exec(
              "UPDATE participants SET pull_session_id = ? WHERE id = ?",
              pull_session_id,
              pid,
            );
            sfuLog.info("Fresh pull session:", pull_session_id);

            if (!isCurrent()) return;
            pullResp = await this.sfuPost(
              `sessions/${pull_session_id}/tracks/new`,
              {
                tracks: remoteTracks,
              },
            );
          } else {
            throw pullErr;
          }
        }

        if (!isCurrent()) return;
        sfuLog.info("Pull response keys:", Object.keys(pullResp).join(", "));
        const pullSdp =
          (pullResp.sessionDescription as { sdp: string })?.sdp ?? "";
        const pullSdpType = ((pullResp.sessionDescription as { type: string })
          ?.type ?? "offer") as "answer" | "offer";

        const rawResponseTracks = pullResp.tracks;
        const respTracks = Array.isArray(rawResponseTracks)
          ? rawResponseTracks.filter(
              (track): track is Record<string, unknown> =>
                this.isPlainObject(track),
            )
          : [];
        const hasInvalidTrackShape =
          !Array.isArray(rawResponseTracks) ||
          respTracks.length !== rawResponseTracks.length;
        const matchedTrackNames = new Set<string>();
        const hasInvalidTrackResponse =
          hasInvalidTrackShape ||
          respTracks.length !== validCanonicalPullTracks.length ||
          respTracks.some((rt) => {
            const trackName = rt.trackName;
            const publisherSessionId = rt.sessionId;
            const canonicalTrack =
              typeof trackName === "string"
                ? persistedTracks.get(trackName)
                : undefined;

            if (
              (rt.location !== undefined && rt.location !== "remote") ||
              typeof trackName !== "string" ||
              typeof publisherSessionId !== "string" ||
              !canonicalTrack ||
              canonicalTrack.session_id !== publisherSessionId ||
              matchedTrackNames.has(trackName)
            ) {
              return true;
            }

            matchedTrackNames.add(trackName);
            return false;
          }) ||
          matchedTrackNames.size !== validCanonicalPullTracks.length;

        if (hasInvalidTrackResponse) {
          const activePullSessionId = pull_session_id;
          if (!activePullSessionId) {
            throw new Error("pull_session_missing");
          }

          await this.resetAndClosePullSession(
            pid,
            activePullSessionId,
            respTracks,
          );
          if (!isCurrent()) return;
          this.sendTo(ws, {
            op: Op.Error,
            d: {
              code: 0,
              message: "session-dead-reconnect",
              request_id: d.request_id,
              operation: "pull",
            },
          });
          return;
        }

        const failedTracks = respTracks.filter((rt) => rt.errorCode);
        const successTracks = respTracks.filter((rt) => !rt.errorCode);

        if (failedTracks.length > 0) {
          sfuLog.warn("Pull had failed tracks:", JSON.stringify(failedTracks));
          this.evictDeadPublisherTracks(failedTracks);
        }

        if (!pullSdp || successTracks.length === 0) {
          const failedTrackNames = failedTracks.map(
            (rt) => rt.trackName as string,
          );

          this.sql.exec(
            "UPDATE participants SET pull_session_id = NULL WHERE id = ?",
            pid,
          );
          if (!isCurrent()) return;
          this.sendTo(ws, {
            op: Op.Error,
            d: {
              code: 0,
              message: `pull-retry:${JSON.stringify(failedTrackNames)}`,
              request_id: d.request_id,
              operation: "pull",
            },
          });
          return;
        }

        if (failedTracks.length > 0) {
          const failedTrackNames = failedTracks.map(
            (rt) => rt.trackName as string,
          );
          setTimeout(() => {
            this.sendTo(ws, {
              op: Op.Error,
              d: {
                code: 0,
                message: `pull-retry:${JSON.stringify(failedTrackNames)}`,
                request_id: d.request_id,
                operation: "pull",
              },
            });
          }, 100);
        }

        const pullNegotiated: TrackInfo[] = successTracks.map((rt) => {
          const canonicalTrack = persistedTracks.get(rt.trackName as string);
          return {
            participant_id: canonicalTrack?.participant_id ?? "unknown",
            track_name: rt.trackName as string,
            session_id: (rt.sessionId as string) ?? pull_session_id,
            mid: rt.mid as string | undefined,
            kind: (rt.trackName as string)?.includes("audio")
              ? ("audio" as const)
              : ("video" as const),
          };
        });

        this.sendTo(ws, {
          op: Op.SessionDescription,
          d: {
            sdp: pullSdp,
            session_id: pull_session_id,
            tracks: pullNegotiated,
            sdp_type: pullSdpType,
            request_id: d.request_id,
            operation: "pull",
          },
        });
      }

      if (d.push_tracks.length > 0 && d.sdp) {
        if (!isCurrent()) return;
        const prefix = d.push_prefix === "screen" ? "screen" : "cam";
        const sessionId =
          prefix === "screen" ? push_session_screen : push_session_cam;
        this.sendTo(ws, {
          op: Op.NegotiationDone,
          d: {
            session_id: sessionId ?? undefined,
            request_id: d.request_id,
            operation: "push",
            push_prefix: prefix,
          },
        });
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
          this.sql.exec(
            "UPDATE participants SET pull_session_id = NULL WHERE id = ?",
            pid,
          );
          roomLog.info(
            `Cleared stale pull session ID for next retry for ${pid}`,
          );
        } else if (
          activeOperation === "push" &&
          activePushPrefix === "screen"
        ) {
          this.sql.exec(
            "UPDATE participants SET push_session_screen = NULL WHERE id = ?",
            pid,
          );
          roomLog.info(
            `Cleared stale screen push session ID for next retry for ${pid}`,
          );
        } else if (activeOperation === "push") {
          this.sql.exec(
            "UPDATE participants SET push_session_cam = NULL WHERE id = ?",
            pid,
          );
          roomLog.info(
            `Cleared stale cam push session ID for next retry for ${pid}`,
          );
        }
      }
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: 0,
          message: `SFU error: ${message}`,
          request_id: d.request_id,
          operation: activeOperation ?? undefined,
        },
      });
    }
  }

  // ── Op 12: Video (client pull request) ─────────────────────────────────

  private async handleVideo(ws: WebSocket, d: { tracks: TrackInfo[] }) {
    const pid = this.getParticipantId(ws);
    if (!pid) return;
    await this.handleSelectProtocol(ws, {
      sdp: "",
      push_tracks: [],
      pull_tracks: d.tracks,
    });
  }

  // ── Op 14: Answer (pull renegotiation) ─────────────────────────────────

  private async handleAnswer(
    ws: WebSocket,
    d: { sdp: string; request_id?: string },
  ) {
    const pid = this.requireParticipantId(ws);
    if (!pid) return;
    const connectionId = this.getVoiceAttachment(ws)?.connection_id;
    if (!this.isCurrentVoiceConnection(ws, pid, connectionId)) return;

    const pRows = [
      ...this.sql.exec(
        "SELECT pull_session_id FROM participants WHERE id = ?",
        pid,
      ),
    ];
    const pullId =
      pRows.length > 0 ? (pRows[0].pull_session_id as string | null) : null;

    if (!pullId) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 0, message: "No pull session" },
      });
      return;
    }

    try {
      if (!this.isCurrentVoiceConnection(ws, pid, connectionId)) return;
      await this.sfuPut(`sessions/${pullId}/renegotiate`, {
        sessionDescription: { type: "answer", sdp: d.sdp },
      });
      if (!this.isCurrentVoiceConnection(ws, pid, connectionId)) return;
      this.sendTo(ws, {
        op: Op.NegotiationDone,
        d: { session_id: pullId, request_id: d.request_id, operation: "pull" },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: 0,
          message: `Renegotiate error: ${message}`,
          request_id: d.request_id,
          operation: "pull",
        },
      });
    }
  }

  // ── Op 13: StopTracks ──────────────────────────────────────────────────

  private async handleStopTracks(ws: WebSocket, d: { track_names: string[] }) {
    const pid = this.requireParticipantId(ws);
    if (!pid) return;
    const connectionId = this.getVoiceAttachment(ws)?.connection_id;
    if (!this.isCurrentVoiceConnection(ws, pid, connectionId)) return;

    const pRows = [
      ...this.sql.exec(
        "SELECT push_session_cam, push_session_screen FROM participants WHERE id = ?",
        pid,
      ),
    ];
    if (pRows.length === 0) return;
    const row = pRows[0];
    const push_session_cam = row.push_session_cam as string | null;
    const push_session_screen = row.push_session_screen as string | null;

    const trackNameSet = new Set(d.track_names);
    const hasScreen = d.track_names.some((n) => n.startsWith("screen-"));
    const oldPushSessionId = hasScreen ? push_session_screen : push_session_cam;

    // Find matching tracks
    const tracksToClose: Array<{ mid: string; trackName: string }> = [];
    const tCursor = this.sql.exec(
      "SELECT track_name, mid FROM tracks WHERE participant_id = ?",
      pid,
    );
    for (const tRow of tCursor) {
      const name = tRow.track_name as string;
      const mid = tRow.mid as string | null;
      if (trackNameSet.has(name) && mid) {
        tracksToClose.push({ mid, trackName: name });
      }
    }

    // Delete them
    for (const name of d.track_names) {
      this.sql.exec(
        "DELETE FROM tracks WHERE track_name = ? AND participant_id = ?",
        name,
        pid,
      );
    }

    if (hasScreen) {
      this.sql.exec(
        "UPDATE participants SET push_session_screen = NULL WHERE id = ?",
        pid,
      );
    } else if (push_session_cam) {
      // Check if any cam tracks remain
      const cur = this.sql.exec(
        "SELECT COUNT(*) as c FROM tracks WHERE participant_id = ? AND session_id = ?",
        pid,
        push_session_cam,
      );
      if (([...cur][0].c as number) === 0) {
        roomLog.info(
          `All cam tracks stopped — clearing push_session_cam for fresh session`,
        );
        this.sql.exec(
          "UPDATE participants SET push_session_cam = NULL WHERE id = ?",
          pid,
        );
      }
    }

    roomLog.info(`Tracks stopped by ${pid}:`, d.track_names);

    this.broadcast(
      {
        op: Op.StopTracks,
        d: {
          participant_id: pid,
          track_names: d.track_names,
          session_id: oldPushSessionId,
        },
      },
      ws,
    );

    if (hasScreen && this.clearStreamWatchersByParticipantId(pid)) {
      this.broadcastStreamWatcherSnapshot();
    }

    if (oldPushSessionId && tracksToClose.length > 0) {
      try {
        if (!this.isCurrentVoiceConnection(ws, pid, connectionId)) return;
        await this.sfuPut(`sessions/${oldPushSessionId}/tracks/close`, {
          tracks: tracksToClose,
          force: true,
        });
        if (!this.isCurrentVoiceConnection(ws, pid, connectionId)) return;
      } catch {
        sfuLog.warn("tracks/close failed (non-fatal)");
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
      const cur = this.sql.exec(
        "SELECT session_id, mid, kind FROM tracks WHERE track_name = ? AND participant_id = ? AND is_pending = 1",
        name,
        pid,
      );
      const rows = [...cur];
      if (rows.length > 0) {
        readyTracks.push({
          track_name: name,
          participant_id: pid,
          session_id: rows[0].session_id as string,
          mid: (rows[0].mid as string) || undefined,
          kind: rows[0].kind as "audio" | "video",
        });

        this.sql.exec(
          "UPDATE tracks SET is_pending = 0 WHERE track_name = ?",
          name,
        );
      }
    }

    if (readyTracks.length === 0) return;

    this.broadcast(
      {
        op: Op.Video,
        d: { participant_id: pid, tracks: readyTracks },
      },
      ws,
    );
  }

  // ── Op 103: TrackUpdate (simulcast layer change, no renegotiation) ─────

  private async handleTrackUpdate(
    ws: WebSocket,
    d: {
      tracks: Array<{
        track_name: string;
        session_id: string;
        mid: string;
        rid: string;
      }>;
    },
  ) {
    const pid = this.requireParticipantId(ws);
    if (!pid) return;
    const connectionId = this.getVoiceAttachment(ws)?.connection_id;
    if (!this.isCurrentVoiceConnection(ws, pid, connectionId)) return;

    const pRows = [
      ...this.sql.exec(
        "SELECT pull_session_id FROM participants WHERE id = ?",
        pid,
      ),
    ];
    const pullId =
      pRows.length > 0 ? (pRows[0].pull_session_id as string | null) : null;

    if (!pullId) return;

    try {
      if (!this.isCurrentVoiceConnection(ws, pid, connectionId)) return;
      const updates = d.tracks.map((t) => ({
        trackName: t.track_name,
        sessionId: t.session_id,
        mid: t.mid,
        simulcast: {
          preferredRid: t.rid,
          priorityOrdering: (t.track_name.startsWith("screen-")
            ? "none"
            : "asciibetical") as "none" | "asciibetical",
          ridNotAvailable: "asciibetical" as const,
        },
      }));

      await this.sfuPut(`sessions/${pullId}/tracks/update`, {
        tracks: updates,
      });
      if (!this.isCurrentVoiceConnection(ws, pid, connectionId)) return;

      sfuLog.info(`Updated simulcast for ${d.tracks.length} tracks`);
    } catch (err: unknown) {
      sfuLog.warn("tracks/update failed (non-fatal):", String(err));
    }
  }

  // ── Op 104: IceRestart ──────────────────────────────────────────────────

  private handleResetPullSession(ws: WebSocket) {
    const pid = this.requireParticipantId(ws);
    if (!pid) return;

    const rows = [
      ...this.sql.exec(
        "SELECT pull_session_id FROM participants WHERE id = ?",
        pid,
      ),
    ];
    const oldPullId =
      rows.length > 0 ? (rows[0].pull_session_id as string | null) : null;

    this.sql.exec(
      "UPDATE participants SET pull_session_id = NULL WHERE id = ?",
      pid,
    );
    sfuLog.info(
      `Reset pull session for ${pid}${oldPullId ? ` (${oldPullId.slice(0, 8)}...)` : ""}`,
    );
  }

  private async resetAndClosePullSession(
    participantId: string,
    pullSessionId: string,
    responseTracks: Array<Record<string, unknown>>,
  ) {
    this.sql.exec(
      "UPDATE participants SET pull_session_id = NULL WHERE id = ? AND pull_session_id = ?",
      participantId,
      pullSessionId,
    );

    const mids = Array.from(
      new Set(
        responseTracks.flatMap((track) =>
          typeof track.mid === "string" && track.mid ? [track.mid] : [],
        ),
      ),
    );
    if (mids.length === 0) return;

    try {
      await this.sfuPut(`sessions/${pullSessionId}/tracks/close`, {
        tracks: mids.map((mid) => ({ mid })),
        force: true,
      });
    } catch {
      sfuLog.warn("Invalid pull response cleanup failed (non-fatal)");
    }
  }

  private async handleVoiceAppEvent(ws: WebSocket, d: Record<string, unknown>) {
    if (!this.isCurrentAuthenticatedVoiceSocket(ws)) return;

    const pid = this.requireParticipantId(ws);
    if (!pid) return;

    const type = typeof d.type === "string" ? d.type : "";
    const callerUserId = this.getUserIdForParticipant(pid);

    if (this.isPublicDemoSocket(ws)) {
      if (type === "demo.chat.send") {
        this.handleDemoChatSend(ws, pid, d);
      } else if (type === "demo.chat.history.request") {
        this.sendDemoChatHistory(ws);
      } else {
        this.sendTo(ws, {
          op: Op.Error,
          d: {
            code: CloseCode.NotAuthenticated,
            message: "Voice app event is unavailable in public demo rooms",
          },
        });
      }
      return;
    }

    const wordleActivityEvent = sanitizeVoiceAppEvent(
      d,
      callerUserId ?? pid,
      pid,
    );
    if (wordleActivityEvent) {
      if (wordleActivityEvent.kind === "invalid") {
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: 4000, message: wordleActivityEvent.message },
        });
        return;
      }
      this.broadcast({
        op: Op.VoiceAppEvent,
        d: { ...wordleActivityEvent.event, sent_at: Date.now() },
      });
      return;
    }

    if (type.startsWith("listen_together.")) {
      await this.handleListenTogetherCommand(
        ws,
        d as ListenTogetherCommand,
        callerUserId,
      );
      return;
    }

    const soundboardEvent = this.sanitizeSoundboardEvent(
      type,
      d,
      pid,
      callerUserId,
    );
    if (soundboardEvent) {
      this.broadcast({
        op: Op.VoiceAppEvent,
        d: { ...soundboardEvent, sent_at: Date.now() },
      });
      return;
    }

    if (type.startsWith("soundboard.")) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4000, message: "Soundboard event was rejected" },
      });
      return;
    }

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
      const streamerUserId =
        typeof d.streamer_user_id === "string" ? d.streamer_user_id : "";
      if (!streamerUserId || streamerUserId === callerUserId) return;

      if (type === "stream.watch.stop") {
        if (this.deleteStreamWatcher(streamerUserId, callerUserId)) {
          this.broadcastStreamWatcherSnapshot();
        }
        return;
      }

      const streamerParticipantId =
        this.getActiveScreenParticipantIdForUserId(streamerUserId);
      if (!streamerParticipantId) {
        if (this.deleteStreamWatcher(streamerUserId, callerUserId)) {
          this.broadcastStreamWatcherSnapshot();
        }
        return;
      }

      const didChange = this.streamWatcherStore.upsert({
        streamerUserId,
        viewerUserId: callerUserId,
        streamerParticipantId,
        viewerParticipantId: pid,
        createdAt: Date.now(),
      });
      if (didChange) this.broadcastStreamWatcherSnapshot();
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
        d: {
          code: 4000,
          message: "Voice app events cannot create persisted channel messages",
        },
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
      const displayMode =
        typeof d.displayMode === "string" ? d.displayMode : "single";
      const ALLOWED_MODES = new Set(["single", "burst", "rain", "bounce"]);
      const SAFE_CONTENT_TYPES = new Set([
        "image/gif",
        "image/webp",
        "image/apng",
        "image/png",
        "image/jpeg",
        "video/mp4",
      ]);
      const rawContentType =
        typeof d.contentType === "string" ? d.contentType : "";
      const contentType: string = SAFE_CONTENT_TYPES.has(rawContentType)
        ? rawContentType
        : "image/gif";
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
        const pRows = [
          ...this.sql.exec<{ clerk_user_id: string }>(
            "SELECT clerk_user_id FROM participants WHERE id = ?",
            pid,
          ),
        ];
        clerkUserId =
          pRows.length > 0 ? (pRows[0].clerk_user_id ?? null) : null;
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

    this.sendTo(ws, {
      op: Op.Error,
      d: { code: 4000, message: "Unknown voice app event" },
    });
  }

  private handleDemoChatSend(
    ws: WebSocket,
    participantId: string,
    d: Record<string, unknown>,
  ) {
    const authorName = this.sanitizeDemoChatText(d.author_name, 48) || "Guest";
    const content = this.sanitizeDemoChatText(
      d.content,
      DEMO_CHAT_MAX_CONTENT_LENGTH,
    );
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

    this.demoChatStore.append(message, now);

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
    const messages = this.demoChatStore.listLive(now);

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
    if (contentType !== "image/gif" && contentType !== "video/mp4")
      return undefined;

    const normalized: DemoChatGifPayload = {
      url,
      content_type: contentType,
    };

    if (typeof gif.title === "string")
      normalized.title = gif.title.slice(0, 120);
    if (
      typeof gif.source_url === "string" &&
      this.isAllowedRemoteGifUrl(gif.source_url)
    ) {
      normalized.source_url = gif.source_url;
    }
    if (gif.provider === "klipy" || gif.provider === "tenor")
      normalized.provider = gif.provider;
    if (typeof gif.width === "number" && Number.isFinite(gif.width))
      normalized.width = Math.max(1, Math.min(4000, Math.round(gif.width)));
    if (typeof gif.height === "number" && Number.isFinite(gif.height))
      normalized.height = Math.max(1, Math.min(4000, Math.round(gif.height)));

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
    return (
      normalized === "messagecreate" ||
      normalized === "messagesend" ||
      normalized === "channelmessagecreate"
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
    d: { sdp: string; session_type: "push_cam" | "push_screen" | "pull" },
  ) {
    const pid = this.requireParticipantId(ws);
    if (!pid) return;

    roomLog.warn(
      `Received deprecated IceRestart op from ${pid} for ${d.session_type} — sending reset instruction`,
    );
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
    const participants = [
      ...this.sql.exec(
        "SELECT id, pull_session_id FROM participants WHERE pull_session_id IS NOT NULL",
      ),
    ];
    if (participants.length === 0) return;

    for (const p of participants) {
      const pullId = p.pull_session_id as string;
      try {
        // Lightweight probe — a GET on the session endpoint
        await this.sfuFetch("GET", `sessions/${pullId}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("(410)")) {
          sfuLog.warn(
            `Pull session ${pullId.slice(0, 8)}... is 410 — clearing for participant ${p.id}`,
          );
          this.sql.exec(
            "UPDATE participants SET pull_session_id = NULL WHERE id = ?",
            p.id,
          );
          // Notify the client so it can re-pull
          const ws = this.getWsByParticipant(p.id as string);
          if (ws) {
            this.sendTo(ws, {
              op: Op.Error,
              d: { code: 0, message: "pull-session-expired" },
            });
          }
        } else {
          // Non-410 errors (5xx, network) = transient, skip for now
          sfuLog.warn(
            `Session probe for ${pullId.slice(0, 8)}... errored (non-fatal): ${message}`,
          );
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
  private evictDeadPublisherTracks(
    failedTracks: Array<Record<string, unknown>>,
  ) {
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
      failedSids.set(
        sid,
        prev === undefined ? isTransient : prev && isTransient,
      );
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
        badSessionId,
        badSessionId,
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
          sfuLog.info(
            `Skipping eviction for connected publisher ${ownerPid} (session ${badSessionId.slice(0, 8)}…) — ${reason}`,
          );
          continue;
        }

        const deletedTracks: string[] = [];
        const tCur = this.sql.exec(
          "SELECT track_name FROM tracks WHERE session_id = ?",
          badSessionId,
        );
        for (const tr of tCur) deletedTracks.push(tr.track_name as string);

        if (deletedTracks.length > 0) {
          sfuLog.warn(
            `Evicting dead tracks for disconnected publisher ${ownerPid} due to pull failures. tracks=${deletedTracks.join(",")}`,
          );

          this.sql.exec(
            "DELETE FROM tracks WHERE session_id = ?",
            badSessionId,
          );
          const didClearStreamWatchers =
            deletedTracks.some((trackName) =>
              trackName.startsWith("screen-"),
            ) && this.clearStreamWatchersByParticipantId(ownerPid);

          this.broadcast({
            op: Op.StopTracks,
            d: {
              participant_id: ownerPid,
              track_names: deletedTracks,
              session_id: badSessionId,
            },
          });

          if (didClearStreamWatchers) {
            this.broadcastStreamWatcherSnapshot();
          }
        }
      }
    }
  }

  // ── Op 2: Leave & Disconnect ───────────────────────────────────────────

  private async handleLeave(
    ws: WebSocket,
    clientInitiated = false,
    closeSocket = true,
  ) {
    const attachment = this.getVoiceAttachment(ws);
    const pid = attachment?.participant_id;
    // Remove from in-memory WebSockets list since we're closing it.
    // The DO automatically removes it from this.ctx.getWebSockets(),
    // but we also need to clean up DB state.

    if (pid) {
      const rows = [
        ...this.sql.exec(
          "SELECT connection_id FROM participants WHERE id = ?",
          pid,
        ),
      ];
      const currentConnectionId =
        rows.length > 0 ? (rows[0].connection_id as string | null) : null;

      if (
        isSupersededVoiceConnection(
          currentConnectionId,
          attachment?.connection_id,
        )
      ) {
        roomLog.info(`Ignoring stale disconnect for participant=${pid}`);
        return;
      }

      await this.disconnectParticipant(
        pid,
        !clientInitiated,
        closeSocket ? ws : undefined,
      );
    }
  }

  private async disconnectParticipant(
    participantId: string,
    gracePeriod: boolean,
    ws?: WebSocket,
  ) {
    roomLog.info(
      `Participant ${participantId} disconnecting (grace=${gracePeriod})`,
    );

    const pRows = [
      ...this.sql.exec(
        "SELECT clerk_user_id, push_session_cam, push_session_screen, pull_session_id FROM participants WHERE id = ?",
        participantId,
      ),
    ];
    if (pRows.length === 0) return;

    // Broadcast leave
    this.broadcast({
      op: Op.ClientDisconnect,
      d: { participant_id: participantId },
    });

    if (gracePeriod) {
      // Move to pending, keep tracks alive
      const now = Date.now();
      this.sql.exec(
        "INSERT INTO pending_reconnects (participant_id, disconnected_at) VALUES (?, ?) ON CONFLICT(participant_id) DO UPDATE SET disconnected_at = excluded.disconnected_at",
        participantId,
        now,
      );
    } else {
      // Client intended to leave forever, or we are pruning them.
      // Clean up SFU resources and SQLite data completely.
      this.ctx.waitUntil(this.cleanupSfuSessionsByParticipantId(participantId));
      const didChangeStreamWatchers =
        this.clearStreamWatchersByParticipantId(participantId);

      const trackNames = [
        ...this.sql.exec(
          "SELECT track_name FROM tracks WHERE participant_id = ?",
          participantId,
        ),
      ].map((r) => r.track_name as string);
      if (trackNames.length > 0) {
        this.broadcast({
          op: Op.StopTracks,
          d: { participant_id: participantId, track_names: trackNames },
        });
      }

      this.sql.exec(
        "DELETE FROM pending_reconnects WHERE participant_id = ?",
        participantId,
      );
      this.sql.exec(
        "DELETE FROM tracks WHERE participant_id = ?",
        participantId,
      );
      this.sql.exec("DELETE FROM participants WHERE id = ?", participantId);

      if (didChangeStreamWatchers) {
        this.broadcastStreamWatcherSnapshot();
      }
    }

    this.maybeFreezeListenTogetherForEmptyRoom();
    this.scheduleAlarm();

    if (ws) {
      try {
        ws.close(1000, "Left voice");
      } catch {
        /* already closed */
      }
    }
  }

  private sanitizeSoundboardEvent(
    type: string,
    payload: Record<string, unknown>,
    participantId: string,
    callerUserId: string | null,
  ): Record<string, unknown> | null {
    const stringField = (name: string, maxLength: number) => {
      const value = payload[name];
      return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
    };
    const base = {
      type,
      participant_id: participantId,
      ...(callerUserId ? { user_id: callerUserId } : {}),
    };
    const serverKey = stringField("server_key", 160);
    if (!serverKey) return null;

    if (type === "soundboard.play") {
      const playbackId = stringField("playback_id", 160);
      const soundId = stringField("sound_id", 160);
      const name = stringField("name", 160);
      const dataUrl = this.sanitizeSoundboardDataUrl(payload.data_url);
      const mediaUrl = this.sanitizeSoundboardMediaUrl(payload.media_url);
      const hasValidDataUrl = !!dataUrl;
      if (!callerUserId || !playbackId.startsWith(`s-${callerUserId}-`))
        return null;
      if (!playbackId || !name || (!soundId && !hasValidDataUrl && !mediaUrl))
        return null;
      const volume =
        typeof payload.volume === "number" && Number.isFinite(payload.volume)
          ? Math.min(1, Math.max(0, payload.volume))
          : 1;
      return {
        ...base,
        server_key: serverKey,
        playback_id: playbackId,
        ...(soundId ? { sound_id: soundId } : {}),
        name,
        ...(hasValidDataUrl ? { data_url: dataUrl } : {}),
        ...(mediaUrl ? { media_url: mediaUrl } : {}),
        volume,
      };
    }

    if (type === "soundboard.catalog-updated") {
      const sound = payload.sound;
      if (!sound || typeof sound !== "object" || Array.isArray(sound))
        return null;
      const metadata = sound as Record<string, unknown>;
      const id =
        typeof metadata.id === "string" ? metadata.id.trim().slice(0, 160) : "";
      const name =
        typeof metadata.name === "string"
          ? metadata.name.trim().slice(0, 160)
          : "";
      if (!id || !name) return null;
      const fileUrl = this.sanitizeSoundboardMediaUrl(metadata.file_url);
      const emoji =
        typeof metadata.emoji === "string"
          ? metadata.emoji.trim().slice(0, 32)
          : "";
      const volume =
        typeof metadata.volume === "number" && Number.isFinite(metadata.volume)
          ? Math.min(1, Math.max(0, metadata.volume))
          : 1;
      return {
        ...base,
        server_key: serverKey,
        sound: {
          id,
          name,
          ...(fileUrl ? { file_url: fileUrl } : {}),
          ...(emoji ? { emoji } : {}),
          volume,
        },
      };
    }

    const playbackId = stringField("playback_id", 160);
    if (type === "soundboard.stop") {
      return playbackId
        ? { ...base, server_key: serverKey, playback_id: playbackId }
        : null;
    }
    if (type === "soundboard.pause-set") {
      return playbackId && typeof payload.paused === "boolean"
        ? {
            ...base,
            server_key: serverKey,
            playback_id: playbackId,
            paused: payload.paused,
          }
        : null;
    }
    if (type === "soundboard.volume-set") {
      if (
        !playbackId ||
        typeof payload.volume !== "number" ||
        !Number.isFinite(payload.volume)
      )
        return null;
      return {
        ...base,
        server_key: serverKey,
        playback_id: playbackId,
        volume: Math.min(1, Math.max(0, payload.volume)),
      };
    }
    return null;
  }

  private sanitizeSoundboardDataUrl(value: unknown): string | null {
    if (typeof value !== "string" || !value.startsWith("data:audio/"))
      return null;
    const match = /^data:audio\/[a-z0-9.+-]+;base64,([a-z0-9+/=]+)$/i.exec(
      value,
    );
    if (!match?.[1]) return null;
    const decodedBytes =
      Math.floor((match[1].length * 3) / 4) -
      (match[1].endsWith("==") ? 2 : match[1].endsWith("=") ? 1 : 0);
    return decodedBytes <= MAX_SOUNDBOARD_DATA_URL_BYTES ? value : null;
  }

  private sanitizeSoundboardMediaUrl(value: unknown): string | null {
    if (typeof value !== "string" || value.length === 0 || value.length > 2048)
      return null;
    try {
      if (value.startsWith("/")) {
        if (!value.startsWith("/api/") || value.startsWith("//")) return null;
        const url = new URL(value, "https://voice-room.invalid");
        decodeURIComponent(url.pathname);
        return `${url.pathname}${url.search}${url.hash}`;
      }
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.hostname !== "www.myinstants.com" ||
        !url.pathname.startsWith("/media/sounds/")
      ) {
        return null;
      }
      return url.href;
    } catch {
      return null;
    }
  }

  private async purgeParticipantState(participantId: string): Promise<void> {
    await this.cleanupSfuSessionsByParticipantId(participantId);
    const didChangeStreamWatchers =
      this.clearStreamWatchersByParticipantId(participantId);

    const trackNames = [
      ...this.sql.exec(
        "SELECT track_name FROM tracks WHERE participant_id = ?",
        participantId,
      ),
    ].map((r) => r.track_name as string);
    if (trackNames.length > 0) {
      this.broadcast({
        op: Op.StopTracks,
        d: { participant_id: participantId, track_names: trackNames },
      });
    }

    this.sql.exec(
      "DELETE FROM pending_reconnects WHERE participant_id = ?",
      participantId,
    );
    this.sql.exec("DELETE FROM tracks WHERE participant_id = ?", participantId);
    this.sql.exec("DELETE FROM participants WHERE id = ?", participantId);

    if (didChangeStreamWatchers) {
      this.broadcastStreamWatcherSnapshot();
    }

    this.maybeFreezeListenTogetherForEmptyRoom();
    this.scheduleAlarm();
  }

  private async cleanupSfuSessionsByParticipantId(participantId: string) {
    const pRows = [
      ...this.sql.exec(
        "SELECT push_session_cam, push_session_screen FROM participants WHERE id = ?",
        participantId,
      ),
    ];
    if (pRows.length === 0) return;
    const p = pRows[0];
    const push_session_cam = p.push_session_cam as string | null;
    const push_session_screen = p.push_session_screen as string | null;

    const tRows: SfuTrackCloseRow[] = [];
    for (const row of this.sql.exec(
      "SELECT track_name, session_id, mid FROM tracks WHERE participant_id = ?",
      participantId,
    )) {
      if (typeof row.mid !== "string" || !row.mid) continue;
      tRows.push({
        mid: row.mid,
        session_id: typeof row.session_id === "string" ? row.session_id : null,
        track_name: String(row.track_name),
      });
    }

    const camTracks = tRows.filter((t) => t.session_id === push_session_cam);
    const screenTracks = tRows.filter(
      (t) => t.session_id === push_session_screen,
    );

    const closeSession = async (
      sessionId: string,
      tracks: SfuTrackCloseRow[],
    ) => {
      const path = `sessions/${sessionId}/tracks/close`;
      const operation = `PUT ${path}`;
      const url = `https://rtc.live.cloudflare.com/v1/apps/${this.env.CALLS_APP_ID}/${path}`;
      try {
        const resp = await fetch(url, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${this.env.CALLS_APP_SECRET}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tracks: tracks.map((t) => ({ mid: t.mid })),
            force: true,
          }),
        });
        if (resp.ok) return;
        if (resp.status === 410) {
          sfuLog.warn(
            `tracks/close 410 for session ${sessionId.slice(0, 8)}... — PC already disconnected, session evicted by SFU (expected)`,
          );
          return;
        }
        sfuLog.warn(
          "SFU tracks/close failed",
          toSafeSfuFailure({
            attempt: 0,
            operation,
            requestId: resp.headers.get("cf-ray"),
            status: resp.status,
          }),
        );
      } catch (err) {
        sfuLog.warn(
          "SFU tracks/close failed",
          toSafeSfuFailure({
            attempt: 0,
            operation,
            status: null,
            timedOut: err instanceof DOMException && err.name === "AbortError",
          }),
        );
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
    path: string,
  ): Promise<Record<string, unknown>> {
    return this.sfuClient.fetch(method, path);
  }

  private async sfuPost(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.sfuRequest("POST", path, body);
  }

  private async sfuPut(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.sfuRequest("PUT", path, body);
  }

  private async sfuRequest(
    method: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.sfuClient.request(method, path, body);
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
