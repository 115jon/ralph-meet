// ============================================================================
// VoiceRoom — Cloudflare Durable Object for voice presence and media metadata
//
// Browser media uses PartyTracks; this room only verifies, persists, and
// broadcasts its descriptors. Direct Calls signaling is limited to the native
// Rust screen publisher's push-only session.
//
// Clients authenticate via voice_token issued by MeetingRoom on Identify.
// ============================================================================

import { DurableObject } from "cloudflare:workers";
import { clog } from "../src/lib/console-logger";
import { isSupersededVoiceConnection } from "./connection-lifecycle";
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
import { PERMISSIONS } from "../src/lib/permissions";
import { hasServerPermission, isServerMember } from "../src/lib/channel-access";
import { isSoundboardPlaybackOwnedBy } from "../src/lib/voice/soundboard-playback-id";
import {
  getSoundboardUploadUrl,
  normalizeSoundboardUploadUrl,
  SOUNDBOARD_UPLOAD_PATH,
} from "../src/lib/voice/soundboard-media";
import {
  getSoundboardMediaCapabilityUrl,
  issueSoundboardMediaCapability,
} from "../src/lib/voice/soundboard-media-capability";
import {
  decodeVoiceGatewayClientFrame,
  GatewayCloseCode as CloseCode,
  GatewayOp as Op,
  VOICE_MOVED_CLOSE_REASON,
  type VoiceClientPayload,
} from "../src/lib/gateway-protocol";
import {
  issuePartyTracksSessionCapability,
  verifyPartyTracksSessionCapability,
} from "./partytracks-proxy";
import { initRealtimeTicketNonces } from "./realtime-admission";
import {
  acceptSocket,
  admitSocket,
  broadcastToIdentified,
  isOpcodeAllowed,
  isSilent,
  isSpentTicketReason,
  markSocketHeard,
  rateLimitedError,
  readSocketFrame,
  requestedGatewayVersion,
  sendFrame,
  silentAt,
  SocketRateLimiter,
  unauthorizedUpgrade,
  unknownOpcodeError,
} from "./socket-core";
import { verifyVoiceToken } from "./voice-token";
import {
  VOICE_JOIN_GRANT_CHECK_PATH,
  VOICE_JOIN_GRANT_PATH,
  VOICE_JOIN_GRANT_WAIT_MS,
  VOICE_MEDIA_AUTHORIZATION_PATH,
  VoiceJoinGrantStore,
  VoiceJoinGrantWaiters,
  parseVoiceMediaAuthorizationQuery,
  parseVoiceJoinGrantUpdate,
  serializeVoiceJoinGrantQuery,
  type VoiceJoinGrantQuery,
  type VoiceMediaAuthorization,
  type VoiceMediaTrackRef,
} from "./voice-join-grant";
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
  DB: D1Database;
  REALTIME_TICKET_SECRET?: string;
  MEETING_ROOM?: DurableObjectNamespace;
}

// Opcodes, codes and payload schemas: src/lib/gateway-protocol.

// ── Interfaces ──────────────────────────────────────────────────────────────

interface VoiceSql {
  exec<T extends Record<string, unknown>>(
    query: string,
    ...params: unknown[]
  ): Iterable<T>;
}

interface TrackInfo {
  participant_id: string;
  track_name: string;
  sfu_track_name?: string;
  session_id: string;
  mid?: string;
  kind: "audio" | "video";
  /** A simulcast publication's layer RIDs, highest first. */
  simulcast_rids?: string[];
}

/** Stored comma-joined; RIDs are alphanumeric (see the Video payload rule). */
function encodeSimulcastRids(
  rids: readonly string[] | undefined,
): string | null {
  return rids && rids.length > 1 ? rids.join(",") : null;
}

/** `{ simulcast_rids }` from a stored row, or nothing for a single layer. */
function withSimulcastRids(value: unknown): { simulcast_rids?: string[] } {
  if (typeof value !== "string" || !value) return {};
  const rids = value.split(",").filter(Boolean);
  return rids.length > 1 ? { simulcast_rids: rids } : {};
}

interface NativeScreenTrackRow {
  mid: string;
  track_name: string;
}

type NativeScreenSelectProtocolPayload = VoiceClientPayload<Op.SelectProtocol>;

/** An outbound frame. Inbound frames are decoded by the gateway protocol. */
interface ServerMsg {
  op: number;
  d: unknown;
}

interface VoiceSocketClose {
  code: number;
  reason: string;
}

/** Close reason (with CloseCode.SessionReplaced) when voice moves device. */
const VOICE_SESSION_REPLACED_REASON = "Voice moved to another device";

/**
 * Close code ("Try Again Later") when a voice identify's join grant could not
 * be verified with the MeetingRoom. Unlike AdmissionRejected, clients retry.
 */
const VOICE_JOIN_UNVERIFIED_CLOSE_CODE = 1013;

// WebSocket attachment for voice sessions
interface VoiceAttachment {
  admission?: {
    accessMode: "authenticated" | "public-demo";
    serverId?: string;
    subject: string;
    /**
     * Tickets from /api/voice/admission: the only participant this socket
     * may identify as. Deprecated two-request tickets leave it unset.
     */
    boundParticipantId?: string;
  };
  participant_id: string;
  connection_id?: string;
  supports_listen_together_snapshot_events?: boolean;
  /**
   * When an unidentified socket was last heard from (accepted, or a
   * heartbeat). Identified sockets track liveness in participants instead.
   */
  last_seen_at?: number;
}

// ── Constants ───────────────────────────────────────────────────────────────

const VOICE_PRUNE_ALARM_INTERVAL_MS = 300_000;
const DEMO_CHAT_TTL_MS = 10 * 60 * 1000;
const DEMO_CHAT_MAX_MESSAGES = 75;
const DEMO_CHAT_MAX_CONTENT_LENGTH = 1_000;
const RADIO_STATION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RADIO_STATION_LOOKUPS_PER_ENQUEUE = 5;
const MAX_SOUNDBOARD_DATA_URL_BYTES = 128 * 1024;
// Recheck membership on every media request, so this bounded lifetime gives
// range/retry playback room without weakening revocation.
const SOUNDBOARD_MEDIA_CAPABILITY_TTL_MS = 60 * 60 * 1000;
const MAX_SOUNDBOARD_POSITION_SECONDS = 24 * 60 * 60;
const DEFAULT_SOUNDBOARD_SOUND_IDS = new Set(["ping", "pop", "chime", "tada"]);
/** Per-opcode limits per minute (SocketRateLimiter). */
const VOICE_WS_RATE_LIMITS: Record<number, number> = {
  [Op.SelectProtocol]: 20,
  [Op.Video]: 20,
  [Op.StopTracks]: 40,
  [Op.TracksReady]: 60,
  [Op.VoiceAppEvent]: 60,
  // A listener reports each unpullable track at most 3 times until it
  // arrives; this only stops a client from spamming.
  [Op.TrackUnavailable]: 30,
};
/**
 * Republish requests for one publication: at most one per this, whoever
 * reports it. Each one costs everyone pulling the track a short gap.
 */
const REPUBLISH_REQUEST_INTERVAL_MS = 3_000;
/** How long a join grant stands before the alarm re-checks it (see reapParticipantsWithoutJoin). */
const VOICE_JOIN_GRANT_RECHECK_MS = 60_000;
/**
 * How long a participant's PartyTracks tracks outlive a voice socket that
 * closed without a leave (op 11), and how long a participant that identified
 * again has to offer them again (see holdParticipantTracks). It covers a
 * voice-socket reconnect: the client's first backoffs (0.25–1 s each), its
 * admission request and VoiceIdentify. realtime/SOCKET_CORE.md, "Voice
 * reconnect hold".
 */
export const VOICE_RECONNECT_HOLD_MS = 5_000;

// ── VoiceRoom Durable Object ────────────────────────────────────────────────

export class VoiceRoom extends DurableObject<Env, unknown> {
  private sql: VoiceSql;
  private demoChatStore: DemoChatStore;
  private streamWatcherStore: StreamWatcherStore;
  private listenTogetherStore: ListenTogetherStore;
  private radioStationResolver: RadioStationResolver;
  private sfuClient: SfuClient;
  private roomSlug: string = "";
  private listenTogetherCommandQueue: Promise<void> = Promise.resolve();
  private nativeScreenOperations = new Map<string, symbol>();
  private voiceJoinGrants: VoiceJoinGrantStore;
  private readonly rateLimiter: SocketRateLimiter;
  private readonly voiceJoinGrantWaiters = new VoiceJoinGrantWaiters();
  private readonly identifyingSockets = new Set<WebSocket>();
  private voiceJoinGrantWaitMs = VOICE_JOIN_GRANT_WAIT_MS;
  private voiceJoinGrantRecheckMs = VOICE_JOIN_GRANT_RECHECK_MS;
  private voiceReconnectHoldMs = VOICE_RECONNECT_HOLD_MS;

  constructor(ctx: DurableObjectState<unknown>, env: Env) {
    super(ctx, env);
    this.sql = this.ctx.storage.sql as unknown as VoiceSql;
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
    this.rateLimiter = new SocketRateLimiter(this.sql, VOICE_WS_RATE_LIMITS);
    initRealtimeTicketNonces(this.ctx.storage.sql);
    this.voiceJoinGrants = new VoiceJoinGrantStore(this.sql);
    this.scheduleAlarm();

    // Ensure roomSlug is loaded BEFORE any message processing.
    // Using blockConcurrencyWhile prevents a race where a webSocketMessage
    // arrives before the async storage read completes.
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<string>("roomSlug");
      if (stored) this.roomSlug = stored;
    });
  }

  /**
   * Drops `clerk_user_id`, the pre-rename name of `user_id`, from a
   * participants table an older version created. A row only pre-rename code
   * wrote has its user id there alone, so it is copied into `user_id` first.
   * The previous version adds the column back if a rollback starts it.
   */
  private dropParticipantsLegacyUserIdColumn() {
    const columns = new Set<string>();
    for (const row of this.sql.exec<{ name: string }>(
      "PRAGMA table_info(participants)",
    )) {
      columns.add(row.name);
    }
    if (!columns.has("clerk_user_id")) return;
    if (!columns.has("user_id")) {
      this.sql.exec("ALTER TABLE participants ADD COLUMN user_id TEXT");
    }
    this.sql.exec(
      `UPDATE participants SET user_id = clerk_user_id
       WHERE clerk_user_id IS NOT NULL AND user_id IS NOT clerk_user_id`,
    );
    this.sql.exec("ALTER TABLE participants DROP COLUMN clerk_user_id");
  }

  private initSchema() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS participants (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        native_screen_session_id TEXT,
        last_heartbeat INTEGER DEFAULT 0,
        speaking INTEGER DEFAULT 0,
        connection_id TEXT,
        held_until INTEGER
      );
    `);
    this.dropParticipantsLegacyUserIdColumn();
    // Owners of `s-<owner>-<sound>` playback ids, which no client sends any
    // more. A rollback recreates the table (CREATE IF NOT EXISTS).
    this.sql.exec(`DROP TABLE IF EXISTS soundboard_legacy_playback_owners;`);
    try {
      this.sql.exec(`ALTER TABLE participants ADD COLUMN connection_id TEXT;`);
    } catch {
      // Existing SQLite-backed Durable Objects already have the column.
    }
    try {
      this.sql.exec(
        `ALTER TABLE participants ADD COLUMN native_screen_session_id TEXT;`,
      );
    } catch {
      // Existing SQLite-backed Durable Objects already have the column.
    }

    // PartyTracks descriptors are ready immediately. Only native screen tracks
    // wait for the Rust publisher's TracksReady confirmation.
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS tracks (
        track_name TEXT PRIMARY KEY,
        participant_id TEXT NOT NULL,
        sfu_track_name TEXT,
        session_id TEXT NOT NULL,
        mid TEXT,
        kind TEXT NOT NULL,
        native_screen_pending INTEGER NOT NULL DEFAULT 0,
        simulcast_rids TEXT,
        held INTEGER NOT NULL DEFAULT 0
      );
    `);
    try {
      this.sql.exec(`ALTER TABLE tracks ADD COLUMN sfu_track_name TEXT;`);
    } catch {
      // Existing SQLite-backed Durable Objects already have the column.
    }
    try {
      this.sql.exec(
        `ALTER TABLE tracks ADD COLUMN native_screen_pending INTEGER NOT NULL DEFAULT 0;`,
      );
    } catch {
      // Existing SQLite-backed Durable Objects already have the column.
    }
    try {
      this.sql.exec(`ALTER TABLE tracks ADD COLUMN simulcast_rids TEXT;`);
    } catch {
      // Existing SQLite-backed Durable Objects already have the column.
    }
    // The voice reconnect hold (holdParticipantTracks): when a participant's
    // held tracks go, and which of its tracks are held.
    try {
      this.sql.exec(`ALTER TABLE participants ADD COLUMN held_until INTEGER;`);
    } catch {
      // Existing SQLite-backed Durable Objects already have the column.
    }
    try {
      this.sql.exec(
        `ALTER TABLE tracks ADD COLUMN held INTEGER NOT NULL DEFAULT 0;`,
      );
    } catch {
      // Existing SQLite-backed Durable Objects already have the column.
    }

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
    const gatewayVersion = requestedGatewayVersion(url);

    const match = url.pathname.match(
      /\/api\/(?:channels|room)\/([^/]+)\/voice/,
    );
    if (match) {
      this.roomSlug = match[1];
      this.ctx.storage.put("roomSlug", this.roomSlug).catch(() => {});
    }

    if (url.pathname.endsWith("/voice")) {
      const admitted = admitSocket(request.headers, this.ctx.storage.sql, {
        audience: "voice",
        roomSlug: this.roomSlug,
      });
      if (!admitted.ok) {
        if (isSpentTicketReason(admitted.reason)) {
          roomLog.warn(`Voice admission refused: ${admitted.reason}`);
        }
        return unauthorizedUpgrade();
      }
      const { admission } = admitted;

      log.info(`New connection, gateway_version=${gatewayVersion}`);
      const accepted = acceptSocket(
        this.ctx,
        {
          admission: {
            accessMode: admission.accessMode,
            subject: admission.subject,
            ...(admission.serverId ? { serverId: admission.serverId } : {}),
            ...(admission.boundParticipantId
              ? { boundParticipantId: admission.boundParticipantId }
              : {}),
          },
          last_seen_at: Date.now(),
        } satisfies Partial<VoiceAttachment>,
        gatewayVersion,
      );
      // The alarm closes this socket if it goes silent before identifying.
      this.scheduleAlarm();
      return accepted.response;
    }

    if (url.pathname === VOICE_JOIN_GRANT_PATH && request.method === "POST") {
      const update = parseVoiceJoinGrantUpdate(
        await request.json().catch(() => null),
      );
      if (!update) {
        return Response.json(
          { error: "Invalid voice join grant" },
          { status: 400 },
        );
      }
      const applied = this.voiceJoinGrants.apply(update);
      if (applied) {
        this.voiceJoinGrantWaiters.notify(update.participantId);
        if (!update.granted) {
          await this.disconnectParticipantImmediately(
            update.participantId,
            update.replaced === true,
            update.moved === true,
          );
        }
      }
      return Response.json({ applied });
    }

    if (
      url.pathname === VOICE_MEDIA_AUTHORIZATION_PATH &&
      request.method === "POST"
    ) {
      const query = parseVoiceMediaAuthorizationQuery(
        await request.json().catch(() => null),
      );
      if (!query) {
        return Response.json({ authorized: false }, { status: 400 });
      }
      const authorized = await this.waitForVoiceJoinGrant({
        participantId: query.participantId,
        subject: query.subject,
      });
      const answer: VoiceMediaAuthorization = { authorized };
      if (authorized && query.tracks) {
        const simulcast = this.publishedSimulcastRids(query.tracks);
        if (simulcast.length > 0) answer.simulcast = simulcast;
      }
      return Response.json(answer);
    }

    if (
      url.pathname === "/disconnect-participant" &&
      request.method === "POST"
    ) {
      try {
        const body = (await request.json()) as {
          participant_id?: string;
          user_id?: string;
        };

        const participantId =
          typeof body.participant_id === "string" && body.participant_id.trim()
            ? body.participant_id.trim()
            : "";
        const userId =
          typeof body.user_id === "string" && body.user_id.trim()
            ? body.user_id.trim()
            : "";

        if (!participantId || !userId) {
          return Response.json(
            { error: "Missing participant or user id" },
            { status: 400 },
          );
        }

        // Only the participant's own user may end it from here.
        const disconnected =
          this.isParticipantOwnedBy(participantId, userId) &&
          (await this.disconnectParticipantImmediately(participantId));
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
    const read = readSocketFrame(rawMsg);
    if (!read.ok) {
      this.sendTo(ws, read.error);
      return;
    }
    const frame = read.frame;

    if (
      this.isAuthenticatedMutatingOpcode(frame.op) &&
      !this.isCurrentAuthenticatedVoiceSocket(ws)
    ) {
      return;
    }

    if (!isOpcodeAllowed("voice", frame.op)) {
      this.sendTo(ws, unknownOpcodeError("voice", frame.op));
      return;
    }

    if (this.isRateLimited(ws, frame.op)) {
      this.sendTo(ws, rateLimitedError());
      return;
    }

    const decoded = decodeVoiceGatewayClientFrame(frame);
    if (!decoded.ok) {
      if (decoded.reason === "unknown-op") {
        // The voice table and the decoder list the same opcodes.
        this.sendTo(ws, unknownOpcodeError("voice", frame.op));
      } else if (frame.op === Op.SelectProtocol) {
        // As for a valid offer: an unidentified socket hears that first.
        if (this.requireParticipantId(ws)) this.rejectBrowserSfuNegotiation(ws);
      } else {
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: CloseCode.InvalidPayload, message: decoded.invalid },
        });
      }
      return;
    }

    const msg = decoded.message;
    switch (msg.op) {
      case Op.VoiceIdentify: {
        const identifyPayload = {
          participant_id: msg.d.participant_id,
          voice_token: msg.d.voice_token,
          ...(msg.d.supports_listen_together_snapshot_events === true
            ? { supports_listen_together_snapshot_events: true as const }
            : {}),
        };
        await this.handleVoiceIdentify(ws, identifyPayload);
        break;
      }

      case Op.Heartbeat:
        this.handleHeartbeat(ws);
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

      case Op.TracksReady:
        await this.handleTracksReady(ws, msg.d);
        break;

      case Op.Speaking:
        this.handleSpeaking(ws, msg.d);
        break;

      case Op.ClientDisconnect:
        await this.handleLeave(ws, true);
        break;

      case Op.VoiceAppEvent:
        await this.handleVoiceAppEvent(ws, msg.d);
        break;

      case Op.TrackUnavailable:
        this.handleTrackUnavailable(ws, msg.d);
        break;

      default: {
        // Every opcode in voiceGatewayClientRules has a case above.
        const unhandled: never = msg;
        void unhandled;
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      await this.handleLeave(ws, false);
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
      await this.handleLeave(ws, false);
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
      this.voiceJoinGrants.prune(
        now,
        new Set(
          [...this.sql.exec(`SELECT id FROM participants`)].map(
            (row) => row.id as string,
          ),
        ),
      );

      await this.expireReconnectHolds(now);

      // Check active participants for zombie timeouts using SQLite
      const participants = this.sql.exec(
        `SELECT id, last_heartbeat FROM participants`,
      );

      for (const row of participants) {
        const pid = row.id as string;
        const lastActivity = (row.last_heartbeat as number) || 0;

        if (isSilent(lastActivity, now)) {
          log.info(
            `Pruning zombie: ${pid}, last_activity=${Math.round((now - lastActivity) / 1000)}s ago`,
          );
          zombies.push(pid);
        }
      }

      for (const pid of zombies) {
        const ws = this.getWsByParticipant(pid);
        if (ws) {
          await this.handleLeave(ws, true);
        } else {
          await this.disconnectParticipant(pid);
        }
      }

      await this.reapParticipantsWithoutJoin(now);
      this.closeSilentUnidentifiedSockets(now);

      // Prune pending reconnects whose grace period expired
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
      deadlines.push(silentAt(row.last_heartbeat as number));
    }
    for (const row of this.sql.exec(
      `SELECT MIN(held_until) as held_until FROM participants WHERE held_until IS NOT NULL`,
    )) {
      if (row.held_until) deadlines.push(row.held_until as number);
    }
    for (const ws of this.unidentifiedSockets()) {
      const lastSeenAt = this.getVoiceAttachment(ws)?.last_seen_at;
      deadlines.push(silentAt(lastSeenAt ?? now));
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
      const demoChatCountRow = [
        ...this.sql.exec(`SELECT COUNT(*) as c FROM demo_chat_messages`),
      ][0];
      const demoChatCount = Number(demoChatCountRow?.c ?? 0);
      const listenTogetherDeadline = this.getListenTogetherTrackDeadline(now);
      const hasWork =
        participantCount > 0 ||
        this.unidentifiedSockets().length > 0 ||
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
    const row = [...this.sql.exec(`SELECT COUNT(*) as c FROM participants`)][0];
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
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = this.getVoiceAttachment(ws);
      // Only identified participants hear the room (see broadcast).
      if (!attachment?.participant_id) continue;
      if (attachment.supports_listen_together_snapshot_events === true) {
        this.sendTo(ws, {
          op: Op.VoiceAppEvent,
          d: {
            type: "listen_together.snapshot",
            room_slug: snapshot.roomSlug,
            snapshot,
          } satisfies ListenTogetherEvent,
        });
        continue;
      }

      if (queueChanged) {
        this.sendTo(ws, {
          op: Op.VoiceAppEvent,
          d: {
            type: "listen_together.queue.updated",
            room_slug: snapshot.roomSlug,
            snapshot,
          } satisfies ListenTogetherEvent,
        });
      }
      if (playbackChanged) {
        this.sendTo(ws, {
          op: Op.VoiceAppEvent,
          d: {
            type: "listen_together.playback.updated",
            room_slug: snapshot.roomSlug,
            snapshot,
          } satisfies ListenTogetherEvent,
        });
      }
    }
  }

  private commitListenTogetherMutation(
    result: ListenTogetherMutationResult,
    now = Date.now(),
  ) {
    if (!result.queueChanged && !result.playbackChanged) return;

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

  private asListenTogetherCommand(
    value: Record<string, unknown>,
  ): ListenTogetherCommand | null {
    const type = typeof value.type === "string" ? value.type : "";
    const roomSlug =
      typeof value.room_slug === "string" ? value.room_slug : this.roomSlug;
    if (!type.startsWith("listen_together.") || !roomSlug) return null;

    switch (type) {
      case "listen_together.state.request":
        return { type, room_slug: roomSlug };
      case "listen_together.enqueue":
        return {
          type,
          room_slug: roomSlug,
          mode:
            value.mode === "play-next" || value.mode === "play-now"
              ? value.mode
              : "append",
          entries: Array.isArray(value.entries)
            ? (value.entries as unknown as ListenTogetherEnqueueCommand["entries"])
            : [],
        };
      case "listen_together.play":
        return {
          type,
          room_slug: roomSlug,
          entryId:
            typeof value.entryId === "string" || value.entryId === null
              ? (value.entryId as string | null)
              : undefined,
        };
      case "listen_together.pause":
        if (typeof value.paused !== "boolean") return null;
        if (typeof value.entryId !== "string") return null;
        return {
          type,
          room_slug: roomSlug,
          paused: value.paused,
          entryId: value.entryId,
        };
      case "listen_together.seek":
        if (
          typeof value.positionMs !== "number" ||
          !Number.isFinite(value.positionMs)
        ) {
          return null;
        }
        if (typeof value.entryId !== "string") return null;
        return {
          type,
          room_slug: roomSlug,
          positionMs: value.positionMs,
          entryId: value.entryId,
        };
      case "listen_together.skip":
      case "listen_together.remove":
        if (typeof value.entryId !== "string") return null;
        return {
          type,
          room_slug: roomSlug,
          entryId: value.entryId,
        };
      case "listen_together.clear":
        return { type, room_slug: roomSlug };
      default:
        return null;
    }
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  private isRateLimited(ws: WebSocket, op: number): boolean {
    const attachment = this.getVoiceAttachment(ws);
    return this.rateLimiter.isLimited(
      op,
      attachment?.participant_id,
      attachment?.admission?.subject,
    );
  }

  /**
   * The rules for a native screen offer the schema cannot check: a non-blank
   * SDP, and unique `screen-…-<participant id>` track names.
   */
  private isOwnNativeScreenOffer(
    payload: NativeScreenSelectProtocolPayload,
    participantId: string,
  ): boolean {
    const trackNames = payload.push_tracks.map((track) => track.track_name);
    return (
      payload.sdp.trim().length > 0 &&
      trackNames.every(
        (name) =>
          name.startsWith("screen-") && name.endsWith(`-${participantId}`),
      ) &&
      new Set(trackNames).size === trackNames.length
    );
  }

  private rejectBrowserSfuNegotiation(ws: WebSocket): void {
    this.sendTo(ws, {
      op: Op.Error,
      d: {
        code: CloseCode.InvalidPayload,
        message: "Browser SFU negotiation is unsupported",
      },
    });
  }

  private beginNativeScreenOperation(participantId: string): symbol {
    const token = Symbol();
    this.nativeScreenOperations.set(participantId, token);
    return token;
  }

  private invalidateNativeScreenOperation(participantId: string): void {
    this.nativeScreenOperations.delete(participantId);
  }

  private finishNativeScreenOperation(
    participantId: string,
    token: symbol,
  ): void {
    if (this.nativeScreenOperations.get(participantId) === token) {
      this.nativeScreenOperations.delete(participantId);
    }
  }

  private isCurrentNativeScreenOperation(
    ws: WebSocket,
    participantId: string,
    connectionId: string | undefined,
    token: symbol,
  ): boolean {
    return (
      this.nativeScreenOperations.get(participantId) === token &&
      this.isCurrentVoiceConnection(ws, participantId, connectionId)
    );
  }

  private handleListenTogetherCommand(
    ws: WebSocket,
    d: ListenTogetherCommand,
    callerUserId: string | null,
  ) {
    if (d.type === "listen_together.state.request") {
      this.handleListenTogetherStateRequest(ws, d);
      return Promise.resolve();
    }

    const command = this.listenTogetherCommandQueue.then(() =>
      this.handleListenTogetherCommandInOrder(ws, d, callerUserId),
    );
    this.listenTogetherCommandQueue = command.catch(() => {});
    return command;
  }

  private handleListenTogetherStateRequest(
    ws: WebSocket,
    d: ListenTogetherCommand,
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

    this.sendListenTogetherSnapshot(ws);
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
        result = clearListenTogether(effectiveRoomSlug, queue, state, now);
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

  /**
   * Participants with an identified voice socket. A voice socket that
   * closes leaves its participant held (holdParticipantTracks, held_until
   * set) until it identifies again or the hold runs out. Rows of any other
   * participant only outlive their socket when the object restarts under
   * live sockets (a deploy, a crash, a dev server restart), which drops the
   * sockets without webSocketClose; the zombie alarm removes them later.
   */
  private identifiedVoiceParticipantIds(): Set<string> {
    const participantIds = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const participantId = this.getVoiceAttachment(ws)?.participant_id;
      if (participantId) participantIds.add(participantId);
    }
    return participantIds;
  }

  /** Open voice sockets that have not identified (and are not identifying). */
  private unidentifiedSockets(): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter(
        (ws) =>
          !this.getParticipantId(ws) &&
          !this.identifyingSockets.has(ws) &&
          ws.readyState === WebSocket.OPEN,
      );
  }

  /**
   * Heartbeats are the only liveness signal of an unidentified socket, as
   * participants' last_heartbeat is for identified ones. One that stops
   * sending them for VOICE_ZOMBIE_TIMEOUT_MS is closed, so a vanished peer
   * cannot hold a socket open forever. A live standby socket heartbeats and
   * stays.
   */
  private closeSilentUnidentifiedSockets(now: number): void {
    for (const ws of this.unidentifiedSockets()) {
      const attachment = this.getVoiceAttachment(ws);
      const lastSeenAt = attachment?.last_seen_at;
      if (typeof lastSeenAt !== "number") {
        // Accepted before sockets carried last_seen_at: start its clock now.
        try {
          ws.serializeAttachment({ ...attachment, last_seen_at: now });
        } catch {
          // The socket is already gone.
        }
        continue;
      }
      if (!isSilent(lastSeenAt, now)) continue;
      roomLog.info(
        `Closing unidentified voice socket, silent for ${Math.round((now - lastSeenAt) / 1000)}s`,
      );
      this.closeVoiceSocket(ws, {
        code: CloseCode.SessionTimeout,
        reason: "Voice socket timed out",
      });
    }
  }

  private getVoiceAttachment(ws: WebSocket): VoiceAttachment | null {
    return ws.deserializeAttachment() as VoiceAttachment | null;
  }

  private isPublicDemoSocket(ws: WebSocket): boolean {
    return this.getVoiceAttachment(ws)?.admission?.accessMode === "public-demo";
  }

  private async disconnectParticipantImmediately(
    participantId: string,
    replaced = false,
    moved = false,
  ): Promise<boolean> {
    const ws = this.getWsByParticipant(participantId);
    if (ws) {
      // A moderator's move says so in its reason, so the client waits for
      // the room's VoiceMove instead of treating it as a device takeover.
      const reason = moved
        ? VOICE_MOVED_CLOSE_REASON
        : VOICE_SESSION_REPLACED_REASON;
      if (replaced) {
        // The user's voice moved to another device or channel: tell this one
        // to stop (no reconnect) before its tracks go.
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: CloseCode.SessionReplaced, message: reason },
        });
      }
      await this.handleLeave(
        ws,
        replaced ? { code: CloseCode.SessionReplaced, reason } : true,
      );
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

    await this.disconnectParticipant(participantId);
    return true;
  }

  /** Whether an authenticated user owns this participant in the room. */
  private isParticipantOwnedBy(participantId: string, userId: string): boolean {
    const rows = [
      ...this.sql.exec(
        "SELECT user_id FROM participants WHERE id = ?",
        participantId,
      ),
    ];
    if (rows.length > 0) return rows[0].user_id === userId;

    const ws = this.getWsByParticipant(participantId);
    const admission = ws ? this.getVoiceAttachment(ws)?.admission : undefined;
    return (
      admission?.accessMode === "authenticated" && admission.subject === userId
    );
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
      op === Op.TracksReady ||
      op === Op.Speaking ||
      op === Op.ClientDisconnect ||
      op === Op.VoiceAppEvent ||
      op === Op.TrackUnavailable
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
        "SELECT user_id FROM participants WHERE id = ?",
        participantId,
      ),
    ];
    if (rows.length === 0) return null;
    const userId = rows[0].user_id as string | null;
    return userId || participantId;
  }

  private getActiveScreenParticipantIdForUserId(userId: string): string | null {
    const rows = [
      ...this.sql.exec(
        `SELECT p.id
       FROM participants p
       WHERE (p.user_id = ? OR p.id = ?)
         AND EXISTS (
           SELECT 1
           FROM tracks t
           WHERE t.participant_id = p.id
             AND t.track_name LIKE 'screen-%'
             AND t.native_screen_pending = 0
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
    d: {
      participant_id: string;
      voice_token: string;
      supports_listen_together_snapshot_events?: boolean;
    },
  ) {
    if (this.identifyingSockets.has(ws)) {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.AlreadyAuthenticated,
          message: "Voice identify already in progress",
        },
      });
      return;
    }
    this.identifyingSockets.add(ws);
    try {
      await this.identifyVoiceParticipant(ws, d);
    } finally {
      this.identifyingSockets.delete(ws);
      // A failed identify leaves an unidentified socket that the alarm must
      // still watch; the room's last leave may have cleared the alarm.
      await this.scheduleAlarm();
    }
  }

  /** The published layers of the given SFU tracks that have several. */
  private publishedSimulcastRids(
    tracks: readonly VoiceMediaTrackRef[],
  ): Array<VoiceMediaTrackRef & { rids: string[] }> {
    const found: Array<VoiceMediaTrackRef & { rids: string[] }> = [];
    for (const track of tracks) {
      const [row] = this.sql.exec<{ simulcast_rids: string | null }>(
        "SELECT simulcast_rids FROM tracks WHERE session_id = ? AND " +
          "(sfu_track_name = ? OR (sfu_track_name IS NULL AND track_name = ?)) " +
          "AND simulcast_rids IS NOT NULL LIMIT 1",
        track.sessionId,
        track.trackName,
        track.trackName,
      );
      const { simulcast_rids: rids } = withSimulcastRids(row?.simulcast_rids);
      if (rids) found.push({ ...track, rids });
    }
    return found;
  }

  /**
   * Waits for the MeetingRoom's join grant for this participant. A grant the
   * MeetingRoom already pushed answers immediately; otherwise the request
   * waits for the push (the room Identify is usually in flight) and asks the
   * MeetingRoom once in parallel in case a push was lost.
   */
  private async waitForVoiceJoinGrant(
    query: VoiceJoinGrantQuery,
  ): Promise<boolean> {
    return (await this.awaitVoiceJoinVerdict(query)) === "granted";
  }

  /**
   * Like waitForVoiceJoinGrant, but tells a refusal apart from a wait that
   * ended with no grant, no revocation and no answer from the MeetingRoom
   * (its check failed or is still running): "unverified".
   */
  private async awaitVoiceJoinVerdict(
    query: VoiceJoinGrantQuery,
  ): Promise<"granted" | "denied" | "unverified"> {
    const state = this.voiceJoinGrants.state(
      query.participantId,
      query.subject,
    );
    if (state !== "unknown") return state === "granted" ? "granted" : "denied";

    // undefined while the check runs; null when the MeetingRoom could not say.
    let checked: boolean | null | undefined;
    void this.checkVoiceJoinGrant(query).then((answer) => {
      checked = answer;
      if (answer !== true) return;
      this.voiceJoinGrants.recordConfirmed(query);
      this.voiceJoinGrantWaiters.notify(query.participantId);
    });

    const granted = await this.voiceJoinGrantWaiters.wait(
      query.participantId,
      this.voiceJoinGrantWaitMs,
      () => {
        const next = this.voiceJoinGrants.state(
          query.participantId,
          query.subject,
        );
        return next === "unknown" ? null : next === "granted";
      },
    );
    if (granted) return "granted";
    const final = this.voiceJoinGrants.state(
      query.participantId,
      query.subject,
    );
    return final === "unknown" && checked !== false ? "unverified" : "denied";
  }

  /**
   * Heartbeats keep a voice socket alive on their own, so a participant whose
   * MeetingRoom session ended while the revocation push was lost (a failed
   * fetch, a restart in between) would stay in the room with its tracks.
   * Each alarm re-checks, with the MeetingRoom, every identified participant
   * whose grant has not been confirmed for voiceJoinGrantRecheckMs, and
   * disconnects those it no longer reports as joined. A failed check keeps
   * the participant; the next alarm asks again.
   */
  private async reapParticipantsWithoutJoin(now: number): Promise<void> {
    const due: Array<{ ws: WebSocket; query: VoiceJoinGrantQuery }> = [];
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = this.getVoiceAttachment(ws);
      const participantId = attachment?.participant_id;
      const subject = attachment?.admission?.subject;
      if (!participantId || !subject) continue;
      if (!this.isCurrentAuthenticatedVoiceSocket(ws)) continue;
      const confirmedAt = this.voiceJoinGrants.updatedAt(participantId);
      if (
        confirmedAt !== null &&
        now - confirmedAt < this.voiceJoinGrantRecheckMs
      ) {
        continue;
      }
      due.push({ ws, query: { participantId, subject } });
    }
    if (due.length === 0) return;

    const verdicts = await Promise.all(
      due.map(({ query }) => this.checkVoiceJoinGrant(query)),
    );
    for (const [index, { ws, query }] of due.entries()) {
      const verdict = verdicts[index];
      if (verdict === null) continue;
      if (verdict) {
        this.voiceJoinGrants.recordConfirmed(query, now);
        this.voiceJoinGrants.touch(query.participantId, now);
        continue;
      }
      if (this.getParticipantId(ws) !== query.participantId) continue;
      roomLog.info(
        `Reaping participant=${query.participantId}: no longer joined in the MeetingRoom`,
      );
      // Record the verdict first: a client that reconnects this voice socket
      // is then refused (AdmissionRejected) instead of re-admitted by a
      // standing grant and reaped again at the next alarm.
      this.voiceJoinGrants.revoke(query, now);
      await this.handleLeave(ws, true);
    }
  }

  /** The MeetingRoom's answer: true, false, or null when it could not say. */
  private async checkVoiceJoinGrant(
    query: VoiceJoinGrantQuery,
  ): Promise<boolean | null> {
    const namespace = this.env.MEETING_ROOM;
    if (!namespace || !this.roomSlug) return null;
    try {
      const response = await namespace
        .get(namespace.idFromName(this.roomSlug))
        .fetch(`https://internal${VOICE_JOIN_GRANT_CHECK_PATH}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: serializeVoiceJoinGrantQuery(query),
        });
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      const body = (await response.json()) as { granted?: unknown };
      return typeof body.granted === "boolean" ? body.granted : null;
    } catch (error) {
      roomLog.warn("Voice join grant check failed", error);
      return null;
    }
  }

  private async identifyVoiceParticipant(
    ws: WebSocket,
    d: {
      participant_id: string;
      voice_token: string;
      supports_listen_together_snapshot_events?: boolean;
    },
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
    if (
      admission?.boundParticipantId !== undefined &&
      admission.boundParticipantId !== d.participant_id
    ) {
      // The ticket was for another participant of this user's join (the
      // room socket re-identified meanwhile). Not a refusal: the client
      // reconnects with a ticket for the participant it is now.
      roomLog.warn(
        `VoiceIdentify for another participant than the ticket's: participant=${d.participant_id}`,
      );
      try {
        ws.close(
          VOICE_JOIN_UNVERIFIED_CLOSE_CODE,
          "Voice ticket is for another participant",
        );
      } catch {}
      return;
    }
    const verification = await verifyVoiceToken({
      token: d.voice_token,
      participantId: d.participant_id,
      roomSlug: this.roomSlug,
      secret: this.env.CALLS_APP_SECRET,
      expectedSubject: admission?.subject,
    });

    if (!admission) {
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

    if (!verification.ok) {
      if (verification.reason === "subject") {
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

      const message =
        verification.reason === "format"
          ? "Invalid voice token format"
          : verification.reason === "identity"
            ? "Invalid voice token"
            : verification.reason === "expired"
              ? "Voice token expired"
              : "Voice token verification failed";
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.AuthenticationFailed,
          message,
        },
      });
      return;
    }

    // A valid voice token only proves identity. The participant must also be
    // joined (not standby) in this channel's MeetingRoom before it may see
    // tracks, publish or appear to the voice room.
    const joinWaitStartedAt = Date.now();
    const verdict = await this.awaitVoiceJoinVerdict({
      participantId: d.participant_id,
      subject: admission.subject,
    });
    const joinWaitMs = Date.now() - joinWaitStartedAt;
    if (ws.readyState !== WebSocket.OPEN || this.getParticipantId(ws)) return;
    if (verdict === "unverified") {
      // The MeetingRoom could not be asked (a failed or slow fetch). Not a
      // refusal: close with a retryable code so the client reconnects and
      // identifies again instead of ending the session (AdmissionRejected).
      roomLog.warn(
        `VoiceIdentify deferred: participant=${d.participant_id} join could not be verified`,
      );
      try {
        ws.close(
          VOICE_JOIN_UNVERIFIED_CLOSE_CODE,
          "Voice channel join could not be verified",
        );
      } catch {}
      return;
    }
    if (verdict === "denied") {
      roomLog.warn(
        `VoiceIdentify refused: participant=${d.participant_id} has not joined the channel`,
      );
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.AdmissionRejected,
          message: "Voice channel join required",
        },
      });
      try {
        ws.close(CloseCode.AdmissionRejected, "Voice channel join required");
      } catch {}
      return;
    }

    const userId =
      admission.accessMode === "authenticated" ? admission.subject : undefined;

    const connectionId = crypto.randomUUID();
    const attachment: VoiceAttachment = {
      admission,
      participant_id: d.participant_id,
      connection_id: connectionId,
      supports_listen_together_snapshot_events:
        d.supports_listen_together_snapshot_events === true,
    };

    // A reconnect of this participant (its old socket may still be open, or
    // closed and held). Its PartyTracks session survives the socket, so its
    // tracks are held, not purged: after VoiceReady it offers them again
    // (op 12), and an unchanged offer reaches the others as a no-op. A
    // native screen publisher establishes a fresh, explicitly owned Calls
    // session, so that share is ended now (holdParticipantTracks).
    const existingParticipant = [
      ...this.sql.exec(
        "SELECT id FROM participants WHERE id = ?",
        d.participant_id,
      ),
    ][0];
    if (existingParticipant) {
      await this.holdParticipantTracks(d.participant_id, ws);
    }

    // A reconnect replaces only the same participant identity. A user may have
    // multiple participant IDs (for example, two authenticated test/device
    // sessions) without either connection superseding the other.
    for (const otherWs of this.ctx.getWebSockets()) {
      if (otherWs === ws) continue;
      const otherAtt =
        otherWs.deserializeAttachment() as VoiceAttachment | null;
      if (otherAtt?.participant_id !== d.participant_id) continue;

      roomLog.info(
        `Evicting duplicate session for participant=${otherAtt.participant_id}`,
      );
      this.closeVoiceSocket(otherWs, {
        code: 1000,
        reason: "Replaced by new connection",
      });
    }

    ws.serializeAttachment(attachment);

    this.sql.exec(
      `INSERT INTO participants (id, user_id, native_screen_session_id, last_heartbeat, speaking, connection_id)
       VALUES (?, ?, NULL, ?, 0, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         native_screen_session_id = NULL,
         last_heartbeat = excluded.last_heartbeat,
         connection_id = excluded.connection_id`,
      d.participant_id,
      userId ?? null,
      Date.now(),
      connectionId,
    );

    roomLog.info(
      `VoiceIdentify: participant=${d.participant_id} join_wait_ms=${joinWaitMs}`,
    );
    // Only participants that still have an identified voice socket, or are
    // held through a reconnect (holdParticipantTracks). Rows of any other
    // participant are left over from a restart (see
    // identifiedVoiceParticipantIds) and name dead PartyTracks sessions.
    const liveParticipantIds = this.identifiedVoiceParticipantIds();
    for (const row of this.sql.exec(
      "SELECT id FROM participants WHERE held_until IS NOT NULL",
    )) {
      liveParticipantIds.add(row.id as string);
    }
    const existingTracks: TrackInfo[] = [];
    let staleTrackCount = 0;
    const tCursor = this.sql.exec(
      "SELECT track_name, participant_id, sfu_track_name, session_id, mid, kind, simulcast_rids FROM tracks WHERE participant_id != ? AND native_screen_pending = 0",
      d.participant_id,
    );
    for (const row of tCursor) {
      if (!liveParticipantIds.has(row.participant_id as string)) {
        staleTrackCount += 1;
        continue;
      }
      existingTracks.push({
        track_name: row.track_name as string,
        participant_id: row.participant_id as string,
        sfu_track_name: (row.sfu_track_name as string) || undefined,
        session_id: row.session_id as string,
        mid: (row.mid as string) || undefined,
        kind: row.kind as "audio" | "video",
        ...withSimulcastRids(row.simulcast_rids),
      });
    }

    const speakingStates: Record<string, number> = {};
    const sCursor = this.sql.exec(
      "SELECT id, speaking FROM participants WHERE speaking > 0 AND id != ?",
      d.participant_id,
    );
    for (const row of sCursor) {
      if (!liveParticipantIds.has(row.id as string)) continue;
      speakingStates[row.id as string] = row.speaking as number;
    }
    if (staleTrackCount > 0) {
      roomLog.info(
        `VoiceReady: skipped ${staleTrackCount} tracks of participants without a voice socket`,
      );
    }

    // A native screen share in the room is announced pullable (see
    // toPullableTracks); signing it is the only await, and only then.
    const announcedTracks = existingTracks.some(
      (track) => !track.sfu_track_name,
    )
      ? await this.toPullableTracks(existingTracks)
      : existingTracks;
    if (!this.isCurrentVoiceConnection(ws, d.participant_id, connectionId)) {
      return;
    }

    this.sendTo(ws, {
      op: Op.VoiceReady,
      d: {
        participant_id: d.participant_id,
        tracks: announcedTracks,
        speaking: speakingStates,
        join_wait_ms: joinWaitMs,
      },
    });
    this.sendStreamWatcherSnapshot(ws);
    this.sendDemoChatHistory(ws);

    this.scheduleAlarm();
  }

  // ── Op 3: Heartbeat ────────────────────────────────────────────────────

  private handleHeartbeat(ws: WebSocket) {
    const pid = this.getParticipantId(ws);
    if (!pid) {
      // A standby session keeps its socket unidentified until the user joins
      // (see SFUClient.connectVoice); its heartbeats keep it open.
      markSocketHeard(ws, "last_seen_at");
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

  /**
   * A listener's pulls of another participant's track keep getting
   * not_found_track_error. If that track is the publisher's current
   * PartyTracks publication in this room, ask the publisher to push it again
   * (RepublishRequest); the new SFU track is announced as usual. The report
   * is a hint, never trusted beyond that: the track row must match, and a
   * publication is asked at most once per REPUBLISH_REQUEST_INTERVAL_MS.
   */
  private handleTrackUnavailable(
    ws: WebSocket,
    d: VoiceClientPayload<Op.TrackUnavailable>,
  ): void {
    const reporterId = this.requireParticipantId(ws);
    if (!reporterId || reporterId === d.participant_id) return;
    const row = [
      ...this.sql.exec(
        "SELECT sfu_track_name, session_id FROM tracks " +
          "WHERE track_name = ? AND participant_id = ? AND native_screen_pending = 0",
        d.track_name,
        d.participant_id,
      ),
    ][0];
    if (
      !row ||
      typeof row.sfu_track_name !== "string" ||
      row.session_id !== d.session_id ||
      (d.sfu_track_name !== undefined &&
        row.sfu_track_name !== d.sfu_track_name)
    ) {
      return;
    }
    const publisher = this.getWsByParticipant(d.participant_id);
    if (!publisher) return;
    if (this.isRepublishRequestRateLimited(d.participant_id, d.track_name)) {
      return;
    }
    roomLog.info("Asking a publisher to republish an unpullable track", {
      reporterId,
      publisherId: d.participant_id,
      trackName: d.track_name,
    });
    this.sendTo(publisher, {
      op: Op.RepublishRequest,
      d: {
        track_name: d.track_name,
        sfu_track_name: row.sfu_track_name,
        session_id: row.session_id,
      },
    });
  }

  /** In storage, so a hibernation between reports does not reset it. */
  private isRepublishRequestRateLimited(
    publisherId: string,
    trackName: string,
  ): boolean {
    const key = `republish:${publisherId}:${trackName}`;
    const now = Date.now();
    const last = [
      ...this.sql.exec(
        "SELECT window_start FROM ws_rate_limits WHERE rate_key = ?",
        key,
      ),
    ][0];
    if (
      last &&
      now - Number(last.window_start) < REPUBLISH_REQUEST_INTERVAL_MS
    ) {
      return true;
    }
    this.sql.exec(
      `INSERT INTO ws_rate_limits (rate_key, window_start, count)
       VALUES (?, ?, 1)
       ON CONFLICT(rate_key) DO UPDATE SET window_start = excluded.window_start, count = 1`,
      key,
      now,
    );
    return false;
  }

  private handleSpeaking(ws: WebSocket, d: VoiceClientPayload<Op.Speaking>) {
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

  private async handleSelectProtocol(
    ws: WebSocket,
    payload: NativeScreenSelectProtocolPayload,
  ): Promise<void> {
    const participantId = this.requireParticipantId(ws);
    if (!participantId) return;
    if (!this.isOwnNativeScreenOffer(payload, participantId)) {
      this.rejectBrowserSfuNegotiation(ws);
      return;
    }
    await this.handleNativeScreenSelectProtocol(ws, participantId, payload);
  }

  private async handleNativeScreenSelectProtocol(
    ws: WebSocket,
    participantId: string,
    payload: NativeScreenSelectProtocolPayload,
  ): Promise<void> {
    const connectionId = this.getVoiceAttachment(ws)?.connection_id;
    if (!this.isCurrentVoiceConnection(ws, participantId, connectionId)) return;
    const operationToken = this.beginNativeScreenOperation(participantId);

    try {
      if (
        payload.push_tracks.some((track) =>
          this.hasTrackNameConflict(track.track_name, participantId),
        )
      ) {
        this.sendNativeScreenError(
          ws,
          payload.request_id,
          "Track name is already in use",
        );
        return;
      }

      const previousSession = [
        ...this.sql.exec(
          "SELECT native_screen_session_id FROM participants WHERE id = ?",
          participantId,
        ),
      ][0]?.native_screen_session_id;
      if (typeof previousSession === "string" && previousSession) {
        const previousTracks = await this.removeNativeScreenPublication(
          participantId,
          previousSession,
        );
        this.broadcastStoppedTracks(participantId, previousTracks, ws);
        if (
          !this.isCurrentNativeScreenOperation(
            ws,
            participantId,
            connectionId,
            operationToken,
          )
        ) {
          return;
        }
      }

      let sessionId: string | null = null;
      let cleanupTracks: NativeScreenTrackRow[] = payload.push_tracks.flatMap(
        (track) =>
          track.mid ? [{ mid: track.mid, track_name: track.track_name }] : [],
      );
      try {
        const sessionResponse = await this.sfuFetch("POST", "sessions/new");
        if (
          typeof sessionResponse.sessionId !== "string" ||
          !sessionResponse.sessionId
        ) {
          throw new Error("Calls did not return a native screen session");
        }
        sessionId = sessionResponse.sessionId;

        if (
          !this.isCurrentNativeScreenOperation(
            ws,
            participantId,
            connectionId,
            operationToken,
          )
        ) {
          await this.closeNativeScreenSession(sessionId, []);
          return;
        }

        const publishResponse = await this.sfuPost(
          "sessions/" + sessionId + "/tracks/new",
          {
            tracks: payload.push_tracks.map((track) => ({
              location: "local",
              trackName: track.track_name,
              mid: track.mid,
            })),
            sessionDescription: { type: "offer", sdp: payload.sdp },
          },
        );
        if (
          !this.isCurrentNativeScreenOperation(
            ws,
            participantId,
            connectionId,
            operationToken,
          )
        ) {
          await this.closeNativeScreenSession(sessionId, cleanupTracks);
          return;
        }

        const sessionDescription = this.isPlainObject(
          publishResponse.sessionDescription,
        )
          ? publishResponse.sessionDescription
          : null;
        const answerSdp =
          typeof sessionDescription?.sdp === "string"
            ? sessionDescription.sdp
            : "";
        if (sessionDescription?.type !== "answer" || !answerSdp.trim()) {
          throw new Error("Calls did not return a native screen SDP answer");
        }

        const rawResponseTracks: unknown[] = Array.isArray(
          publishResponse.tracks,
        )
          ? publishResponse.tracks
          : [];
        const responseTracks = rawResponseTracks.filter(
          (track: unknown): track is Record<string, unknown> =>
            this.isPlainObject(track),
        );
        const midByTrackName = new Map<string, string>();
        for (const track of responseTracks) {
          if (
            track.location === "local" &&
            typeof track.trackName === "string" &&
            typeof track.mid === "string" &&
            payload.push_tracks.some(
              (requested) => requested.track_name === track.trackName,
            )
          ) {
            midByTrackName.set(track.trackName, track.mid);
          }
        }
        const negotiatedTracks: TrackInfo[] = payload.push_tracks.map(
          (track) => ({
            participant_id: participantId,
            track_name: track.track_name,
            session_id: sessionId as string,
            mid: midByTrackName.get(track.track_name) ?? track.mid,
            kind: track.kind,
          }),
        );
        cleanupTracks = negotiatedTracks.flatMap((track) =>
          track.mid ? [{ mid: track.mid, track_name: track.track_name }] : [],
        );

        if (
          !this.isCurrentNativeScreenOperation(
            ws,
            participantId,
            connectionId,
            operationToken,
          )
        ) {
          await this.closeNativeScreenSession(sessionId, cleanupTracks);
          return;
        }

        for (const track of negotiatedTracks) {
          this.sql.exec(
            "INSERT INTO tracks " +
              "(track_name, participant_id, sfu_track_name, session_id, mid, kind, native_screen_pending) " +
              "VALUES (?, ?, NULL, ?, ?, ?, 1) " +
              "ON CONFLICT(track_name) DO UPDATE SET " +
              "participant_id = excluded.participant_id, " +
              "sfu_track_name = NULL, session_id = excluded.session_id, " +
              "mid = excluded.mid, kind = excluded.kind, native_screen_pending = 1, held = 0, " +
              "simulcast_rids = NULL " +
              "WHERE tracks.participant_id = excluded.participant_id",
            track.track_name,
            participantId,
            track.session_id,
            track.mid ?? null,
            track.kind,
          );
        }
        this.sql.exec(
          "UPDATE participants SET native_screen_session_id = ? " +
            "WHERE id = ? AND connection_id IS ?",
          sessionId,
          participantId,
          connectionId ?? null,
        );

        const committedSession = [
          ...this.sql.exec(
            "SELECT native_screen_session_id FROM participants " +
              "WHERE id = ? AND connection_id IS ?",
            participantId,
            connectionId ?? null,
          ),
        ][0]?.native_screen_session_id;
        if (committedSession !== sessionId) {
          this.sql.exec(
            "DELETE FROM tracks WHERE participant_id = ? AND session_id = ? " +
              "AND native_screen_pending = 1",
            participantId,
            sessionId,
          );
          await this.closeNativeScreenSession(sessionId, cleanupTracks);
          return;
        }

        if (
          !this.isCurrentNativeScreenOperation(
            ws,
            participantId,
            connectionId,
            operationToken,
          )
        ) {
          await this.removeNativeScreenPublication(participantId, sessionId);
          return;
        }

        this.sendTo(ws, {
          op: Op.SessionDescription,
          d: {
            sdp: answerSdp,
            session_id: sessionId,
            tracks: negotiatedTracks,
            sdp_type: "answer",
            push_prefix: "screen",
            request_id: payload.request_id,
            operation: "push",
          },
        });
        this.sendTo(ws, {
          op: Op.NegotiationDone,
          d: {
            session_id: sessionId,
            request_id: payload.request_id,
            operation: "push",
            push_prefix: "screen",
          },
        });
        sessionId = null;
      } catch (error) {
        if (sessionId)
          await this.closeNativeScreenSession(sessionId, cleanupTracks);
        if (
          !this.isCurrentNativeScreenOperation(
            ws,
            participantId,
            connectionId,
            operationToken,
          )
        ) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        roomLog.error("Native screen signaling failed:", message);
        this.sendNativeScreenError(ws, payload.request_id, message);
      }
    } finally {
      this.finishNativeScreenOperation(participantId, operationToken);
    }
  }

  private async handleVideo(
    ws: WebSocket,
    d: VoiceClientPayload<Op.Video>,
  ): Promise<void> {
    const participantId = this.requireParticipantId(ws);
    if (!participantId) return;
    if (d.tracks.length === 0) return;
    if (
      d.tracks.some(
        (track) =>
          typeof track.sfu_track_name !== "string" || !track.sfu_track_name,
      )
    ) {
      this.rejectBrowserSfuNegotiation(ws);
      return;
    }
    await this.handlePartyTracksPublication(ws, participantId, d.tracks);
  }

  private async handlePartyTracksPublication(
    ws: WebSocket,
    participantId: string,
    tracks: TrackInfo[],
  ): Promise<void> {
    const connectionId = this.getVoiceAttachment(ws)?.connection_id;
    const rejectOwnedTrackName = () => {
      if (
        !tracks.some((track) =>
          this.hasTrackNameConflict(track.track_name, participantId),
        )
      ) {
        return false;
      }
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.InvalidPayload,
          message: "Track name is already owned",
        },
      });
      return true;
    };
    if (rejectOwnedTrackName()) return;

    const sanitizedTracks: TrackInfo[] = [];
    for (const track of tracks) {
      const claims = await verifyPartyTracksSessionCapability(
        track.session_id,
        this.env.CALLS_APP_SECRET,
      );
      if (
        !claims ||
        claims.roomSlug !== this.roomSlug ||
        claims.participantId !== participantId
      ) {
        this.sendTo(ws, {
          op: Op.Error,
          d: {
            code: CloseCode.InvalidPayload,
            message: "Invalid PartyTracks session",
          },
        });
        return;
      }
      sanitizedTracks.push({
        participant_id: participantId,
        track_name: track.track_name,
        sfu_track_name: track.sfu_track_name,
        session_id: track.session_id,
        kind: track.kind,
        ...(track.kind === "video" && encodeSimulcastRids(track.simulcast_rids)
          ? { simulcast_rids: [...(track.simulcast_rids ?? [])] }
          : {}),
      });
    }

    // The capability checks above yield. If the participant left (or this
    // socket was replaced) meanwhile, its tracks were already purged:
    // recording these now would leave rows nobody owns. Another participant
    // may also have claimed one of the names meanwhile.
    if (!this.isCurrentVoiceConnection(ws, participantId, connectionId)) return;
    if (rejectOwnedTrackName()) return;

    for (const track of sanitizedTracks) {
      this.sql.exec(
        "INSERT INTO tracks " +
          "(track_name, participant_id, sfu_track_name, session_id, mid, kind, native_screen_pending, simulcast_rids) " +
          "VALUES (?, ?, ?, ?, NULL, ?, 0, ?) " +
          "ON CONFLICT(track_name) DO UPDATE SET " +
          "participant_id = excluded.participant_id, " +
          "sfu_track_name = excluded.sfu_track_name, " +
          "session_id = excluded.session_id, mid = NULL, " +
          "kind = excluded.kind, native_screen_pending = 0, " +
          "simulcast_rids = excluded.simulcast_rids, held = 0",
        track.track_name,
        participantId,
        track.sfu_track_name,
        track.session_id,
        track.kind,
        encodeSimulcastRids(track.simulcast_rids),
      );
    }

    this.broadcast(
      {
        op: Op.Video,
        d: { participant_id: participantId, tracks: sanitizedTracks },
      },
      ws,
    );
  }

  private async handleStopTracks(
    ws: WebSocket,
    d: VoiceClientPayload<Op.StopTracks>,
  ): Promise<void> {
    const participantId = this.requireParticipantId(ws);
    if (!participantId || d.track_names.length === 0) return;
    const connectionId = this.getVoiceAttachment(ws)?.connection_id;
    if (!this.isCurrentVoiceConnection(ws, participantId, connectionId)) return;
    if (
      d.track_names.some(
        (trackName) =>
          trackName.startsWith("screen-") &&
          trackName.endsWith(`-${participantId}`),
      )
    ) {
      this.invalidateNativeScreenOperation(participantId);
    }

    const requestedRows: TrackInfo[] = [];
    for (const trackName of d.track_names) {
      const row = [
        ...this.sql.exec(
          "SELECT track_name, participant_id, sfu_track_name, session_id, mid, kind, simulcast_rids " +
            "FROM tracks WHERE track_name = ? AND participant_id = ?",
          trackName,
          participantId,
        ),
      ][0];
      if (!row) continue;
      requestedRows.push(this.toTrackInfo(row));
    }

    const partyTracks = requestedRows.filter(
      (track) => typeof track.sfu_track_name === "string",
    );
    for (const track of partyTracks) {
      this.sql.exec(
        "DELETE FROM tracks WHERE track_name = ? AND participant_id = ? " +
          "AND sfu_track_name IS NOT NULL",
        track.track_name,
        participantId,
      );
    }

    const nativeSession = [
      ...this.sql.exec(
        "SELECT native_screen_session_id FROM participants WHERE id = ?",
        participantId,
      ),
    ][0]?.native_screen_session_id;
    const shouldStopNative =
      typeof nativeSession === "string" &&
      requestedRows.some(
        (track) =>
          track.session_id === nativeSession &&
          track.sfu_track_name === undefined &&
          track.track_name.startsWith("screen-"),
      );
    const nativeTracks = shouldStopNative
      ? await this.removeNativeScreenPublication(
          participantId,
          nativeSession as string,
        )
      : [];
    const removedTracks = [...partyTracks, ...nativeTracks];
    if (removedTracks.length === 0) return;

    this.broadcastStoppedTracks(participantId, removedTracks, ws);
  }

  private async handleTracksReady(
    ws: WebSocket,
    d: VoiceClientPayload<Op.TracksReady>,
  ): Promise<void> {
    const participantId = this.requireParticipantId(ws);
    if (!participantId || d.track_names.length === 0) return;
    const connectionId = this.getVoiceAttachment(ws)?.connection_id;
    if (!this.isCurrentVoiceConnection(ws, participantId, connectionId)) return;

    const nativeSession = [
      ...this.sql.exec(
        "SELECT native_screen_session_id FROM participants WHERE id = ?",
        participantId,
      ),
    ][0]?.native_screen_session_id;
    if (typeof nativeSession !== "string" || !nativeSession) return;

    const readyTracks: TrackInfo[] = [];
    for (const trackName of d.track_names) {
      const row = [
        ...this.sql.exec(
          "SELECT track_name, participant_id, sfu_track_name, session_id, mid, kind, simulcast_rids " +
            "FROM tracks WHERE track_name = ? AND participant_id = ? " +
            "AND session_id = ? AND sfu_track_name IS NULL " +
            "AND native_screen_pending = 1",
          trackName,
          participantId,
          nativeSession,
        ),
      ][0];
      if (!row) continue;
      this.sql.exec(
        "UPDATE tracks SET native_screen_pending = 0 " +
          "WHERE track_name = ? AND participant_id = ? AND session_id = ?",
        trackName,
        participantId,
        nativeSession,
      );
      readyTracks.push(this.toTrackInfo(row));
    }
    if (readyTracks.length === 0) return;

    const announced = await this.toPullableTracks(readyTracks);
    if (!this.isCurrentVoiceConnection(ws, participantId, connectionId)) return;
    this.broadcast(
      {
        op: Op.Video,
        d: { participant_id: participantId, tracks: announced },
      },
      ws,
    );
  }

  /**
   * Viewers pull every remote track through the PartyTracks proxy, which
   * takes a signed session capability, never a raw Calls session id, and
   * clients pull only tracks with an SFU track name. A native screen track
   * lives in the Calls session this room opened for the Rust publisher
   * (stored raw, sfu_track_name NULL, which other paths here rely on), and
   * its SFU track name is the name it was pushed under. So announce it with
   * that name and a capability for that session, bound to its publisher.
   */
  private async toPullableTracks(tracks: TrackInfo[]): Promise<TrackInfo[]> {
    return Promise.all(
      tracks.map(async (track) => {
        if (track.sfu_track_name) return track;
        return {
          ...track,
          sfu_track_name: track.track_name,
          session_id: await issuePartyTracksSessionCapability(
            {
              roomSlug: this.roomSlug,
              participantId: track.participant_id,
              sessionId: track.session_id,
            },
            this.env.CALLS_APP_SECRET,
          ),
        };
      }),
    );
  }

  private toTrackInfo(row: Record<string, unknown>): TrackInfo {
    return {
      track_name: String(row.track_name),
      participant_id: String(row.participant_id),
      ...(typeof row.sfu_track_name === "string"
        ? { sfu_track_name: row.sfu_track_name }
        : {}),
      session_id: String(row.session_id),
      ...(typeof row.mid === "string" && row.mid ? { mid: row.mid } : {}),
      kind: row.kind === "audio" ? "audio" : "video",
      ...withSimulcastRids(row.simulcast_rids),
    };
  }

  private getNativeScreenTracks(
    participantId: string,
    sessionId: string,
  ): TrackInfo[] {
    return [
      ...this.sql.exec(
        "SELECT track_name, participant_id, sfu_track_name, session_id, mid, kind, simulcast_rids " +
          "FROM tracks WHERE participant_id = ? AND session_id = ? " +
          "AND sfu_track_name IS NULL ORDER BY CASE kind WHEN 'video' THEN 0 ELSE 1 END, track_name",
        participantId,
        sessionId,
      ),
    ].map((row) => this.toTrackInfo(row));
  }

  private async removeNativeScreenPublication(
    participantId: string,
    sessionId: string,
  ): Promise<TrackInfo[]> {
    const cleared = [
      ...this.sql.exec(
        "UPDATE participants SET native_screen_session_id = NULL " +
          "WHERE id = ? AND native_screen_session_id = ? RETURNING id",
        participantId,
        sessionId,
      ),
    ];
    if (cleared.length === 0) return [];

    const tracks = this.getNativeScreenTracks(participantId, sessionId);
    this.sql.exec(
      "DELETE FROM tracks WHERE participant_id = ? AND session_id = ? " +
        "AND sfu_track_name IS NULL",
      participantId,
      sessionId,
    );
    await this.closeNativeScreenSession(
      sessionId,
      tracks.flatMap((track) =>
        track.mid ? [{ mid: track.mid, track_name: track.track_name }] : [],
      ),
    );
    return tracks;
  }

  private async closeNativeScreenSession(
    sessionId: string,
    tracks: NativeScreenTrackRow[],
  ): Promise<void> {
    try {
      await this.sfuPut("sessions/" + sessionId + "/tracks/close", {
        tracks: tracks.map((track) => ({ mid: track.mid })),
        force: true,
      });
    } catch (error) {
      sfuLog.warn(
        "Native screen cleanup failed for " +
          sessionId.slice(0, 8) +
          ": " +
          String(error),
      );
    }
  }

  private broadcastStoppedTracks(
    participantId: string,
    tracks: TrackInfo[],
    excludeWs?: WebSocket,
  ): void {
    if (tracks.length === 0) return;
    this.broadcast(
      {
        op: Op.StopTracks,
        d: {
          participant_id: participantId,
          track_names: tracks.map((track) => track.track_name),
          tracks,
        },
      },
      excludeWs,
    );
    if (
      tracks.some((track) => track.track_name.startsWith("screen-")) &&
      this.clearStreamWatchersByParticipantId(participantId)
    ) {
      this.broadcastStreamWatcherSnapshot();
    }
  }

  private sendNativeScreenError(
    ws: WebSocket,
    requestId: string | undefined,
    message: string,
  ): void {
    this.sendTo(ws, {
      op: Op.Error,
      d: {
        code: 0,
        message,
        request_id: requestId,
        operation: "push",
        push_prefix: "screen",
      },
    });
  }

  private async handleVoiceAppEvent(
    ws: WebSocket,
    d: VoiceClientPayload<Op.VoiceAppEvent>,
  ) {
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
          d: {
            code: CloseCode.InvalidPayload,
            message: wordleActivityEvent.message,
          },
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
      const command = this.asListenTogetherCommand(d);
      if (!command) {
        this.sendListenTogetherError(
          ws,
          this.roomSlug,
          "INVALID_COMMAND",
          "Listen Together command is invalid",
        );
        return;
      }
      await this.handleListenTogetherCommand(ws, command, callerUserId);
      return;
    }

    const admittedServerId =
      this.getVoiceAttachment(ws)?.admission?.serverId ?? null;
    if (
      type.startsWith("soundboard.") &&
      admittedServerId &&
      (!callerUserId ||
        !(await this.hasServerMembership(admittedServerId, callerUserId)))
    ) {
      this.sendTo(ws, {
        op: Op.Error,
        d: {
          code: CloseCode.InvalidPayload,
          message: "Server membership is required for soundboard actions",
        },
      });
      await this.handleLeave(ws, true);
      return;
    }

    const soundboardEvent = await this.sanitizeSoundboardEvent(
      type,
      d,
      pid,
      callerUserId,
      admittedServerId,
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
        d: {
          code: CloseCode.InvalidPayload,
          message: "Soundboard event was rejected",
        },
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
          code: CloseCode.InvalidPayload,
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
          d: {
            code: CloseCode.InvalidPayload,
            message: "Sticker URL is invalid or too long",
          },
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
          d: {
            code: CloseCode.InvalidPayload,
            message: "Sticker URL is not a valid URL",
          },
        });
        return;
      }

      if (parsedUrl.protocol !== "https:") {
        this.sendTo(ws, {
          op: Op.Error,
          d: {
            code: CloseCode.InvalidPayload,
            message: "Sticker URL must use HTTPS",
          },
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
          d: {
            code: CloseCode.InvalidPayload,
            message: "Sticker URL host is not allowed",
          },
        });
        return;
      }

      // Look up the sender's user_id so clients can filter per-card
      let userId: string | null = null;
      try {
        const pRows = [
          ...this.sql.exec<{ user_id: string }>(
            "SELECT user_id FROM participants WHERE id = ?",
            pid,
          ),
        ];
        userId = pRows.length > 0 ? (pRows[0].user_id ?? null) : null;
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
          user_id: userId ?? undefined,
          sent_at: Date.now(),
        },
      });
      return;
    }

    this.sendTo(ws, {
      op: Op.Error,
      d: { code: CloseCode.InvalidPayload, message: "Unknown voice app event" },
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
        d: {
          code: CloseCode.InvalidPayload,
          message: "Demo chat messages need text or a GIF",
        },
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
  private async handleLeave(
    ws: WebSocket,
    closeSocket: boolean | VoiceSocketClose = true,
  ): Promise<void> {
    const attachment = this.getVoiceAttachment(ws);
    const participantId = attachment?.participant_id;
    if (!participantId) return;

    const current = [
      ...this.sql.exec(
        "SELECT connection_id FROM participants WHERE id = ?",
        participantId,
      ),
    ][0];
    const currentConnectionId = current?.connection_id as string | null;
    if (
      isSupersededVoiceConnection(currentConnectionId, attachment.connection_id)
    ) {
      roomLog.info(
        "Ignoring stale disconnect for participant=" + participantId,
      );
      return;
    }

    if (closeSocket === false) {
      // The socket closed without a leave (op 11): most likely a reconnect.
      await this.holdDisconnectedParticipant(participantId, ws);
      return;
    }

    await this.disconnectParticipant(
      participantId,
      closeSocket ? ws : undefined,
      typeof closeSocket === "object" ? closeSocket : undefined,
    );
  }

  private async disconnectParticipant(
    participantId: string,
    ws?: WebSocket,
    close: VoiceSocketClose = { code: 1000, reason: "Left voice" },
  ): Promise<void> {
    roomLog.info("Participant " + participantId + " disconnecting");
    await this.purgeParticipantState(participantId, ws);

    if (ws) this.closeVoiceSocket(ws, close);
  }

  /**
   * The participant's voice socket closed without a leave. Its row and its
   * PartyTracks tracks are held for voiceReconnectHoldMs instead of purged:
   * its PartyTracks session outlives the socket, so a reconnect that offers
   * the same tracks again changes nothing for anyone pulling them. If it
   * does not identify again in time, expireReconnectHolds purges it as a
   * leave would.
   */
  private async holdDisconnectedParticipant(
    participantId: string,
    ws: WebSocket,
  ): Promise<void> {
    // The closing socket no longer carries the participant (see
    // closeVoiceSocket): while held, nobody is connected as it.
    const attachment = this.getVoiceAttachment(ws);
    try {
      ws.serializeAttachment(
        attachment?.admission ? { admission: attachment.admission } : null,
      );
    } catch {
      // The socket is already gone.
    }
    roomLog.info(
      "Participant " + participantId + " voice socket closed; holding tracks",
    );
    await this.holdParticipantTracks(participantId, ws);
  }

  /**
   * Holds a participant's PartyTracks tracks across a voice-socket
   * reconnect: its socket closed without a leave, or it identified again
   * (possibly before the old socket's close arrived). Nothing that keeps
   * playing is withdrawn: no ClientDisconnect (op 11) and no StopTracks
   * (op 13) for its PartyTracks tracks. What does not survive a reconnect
   * goes now: speaking (op 5 with 0), and a native screen share (its
   * publisher starts a new Calls session after a reconnect; op 13 for its
   * tracks). Each held track is released by a Video (op 12) offering it
   * again; whatever is still held at held_until goes then
   * (expireReconnectHolds).
   */
  private async holdParticipantTracks(
    participantId: string,
    excludeWs?: WebSocket,
  ): Promise<void> {
    this.invalidateNativeScreenOperation(participantId);
    const participant = [
      ...this.sql.exec(
        "SELECT speaking, native_screen_session_id FROM participants WHERE id = ?",
        participantId,
      ),
    ][0];
    if (!participant) return;
    if (Number(participant.speaking ?? 0) !== 0) {
      this.sql.exec(
        "UPDATE participants SET speaking = 0 WHERE id = ?",
        participantId,
      );
      this.broadcast(
        {
          op: Op.Speaking,
          d: { participant_id: participantId, speaking: 0 },
        },
        excludeWs,
      );
    }

    // Held before the native share's cleanup yields (an SFU request), so a
    // VoiceReady meanwhile still lists these tracks.
    this.sql.exec(
      "UPDATE tracks SET held = 1 WHERE participant_id = ?",
      participantId,
    );
    this.sql.exec(
      "UPDATE participants SET held_until = ? WHERE id = ?",
      Date.now() + this.voiceReconnectHoldMs,
      participantId,
    );

    const nativeSessionId =
      typeof participant.native_screen_session_id === "string"
        ? participant.native_screen_session_id
        : null;
    const nativeTracks = nativeSessionId
      ? await this.removeNativeScreenPublication(participantId, nativeSessionId)
      : [];
    // Native rows of no current native session (none are expected).
    const orphanedNativeTracks = [
      ...this.sql.exec(
        "DELETE FROM tracks WHERE participant_id = ? AND sfu_track_name IS NULL " +
          "RETURNING track_name, participant_id, sfu_track_name, session_id, mid, kind, simulcast_rids",
        participantId,
      ),
    ].map((row) => this.toTrackInfo(row));
    this.broadcastStoppedTracks(
      participantId,
      [...nativeTracks, ...orphanedNativeTracks],
      excludeWs,
    );
    await this.scheduleAlarm();
  }

  /**
   * Ends the holds whose time is up. A participant that identified again
   * loses only the tracks it did not offer again (op 13 for those); one
   * that did not come back is purged as a leave is (op 11, op 13).
   */
  private async expireReconnectHolds(now: number): Promise<void> {
    const due = [
      ...this.sql.exec(
        "SELECT id FROM participants WHERE held_until IS NOT NULL AND held_until <= ?",
        now,
      ),
    ].map((row) => row.id as string);
    for (const participantId of due) {
      const ws = this.getWsByParticipant(participantId);
      if (!ws || !this.isCurrentAuthenticatedVoiceSocket(ws)) {
        roomLog.info(
          "Participant " + participantId + " did not reconnect; purging",
        );
        await this.disconnectParticipant(participantId);
        continue;
      }
      const stale = [
        ...this.sql.exec(
          "DELETE FROM tracks WHERE participant_id = ? AND held = 1 " +
            "RETURNING track_name, participant_id, sfu_track_name, session_id, mid, kind, simulcast_rids",
          participantId,
        ),
      ].map((row) => this.toTrackInfo(row));
      this.sql.exec(
        "UPDATE participants SET held_until = NULL WHERE id = ?",
        participantId,
      );
      this.broadcastStoppedTracks(participantId, stale);
    }
  }

  /**
   * Closes a voice socket this room is done with. The attachment forgets the
   * participant first: a socket whose peer is gone can linger in
   * getWebSockets() while its close times out, and after a restart it must
   * not count as a live participant (identifiedVoiceParticipantIds).
   */
  private closeVoiceSocket(ws: WebSocket, close: VoiceSocketClose): void {
    const attachment = this.getVoiceAttachment(ws);
    try {
      ws.serializeAttachment(
        attachment?.admission ? { admission: attachment.admission } : null,
      );
    } catch {
      // The socket is already gone.
    }
    try {
      ws.close(close.code, close.reason);
    } catch {
      // The voice socket may already be closed.
    }
  }

  private async sanitizeSoundboardEvent(
    type: string,
    payload: Record<string, unknown>,
    participantId: string,
    callerUserId: string | null,
    authorizedServerKey: string | null,
  ): Promise<Record<string, unknown> | null> {
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
    const isDmAdmission =
      !authorizedServerKey && this.roomSlug.startsWith("dm-call-");
    if (
      !serverKey ||
      (isDmAdmission
        ? serverKey !== "dm-call"
        : serverKey !== authorizedServerKey)
    )
      return null;

    if (type === "soundboard.play") {
      const playbackId = stringField("playback_id", 160);
      const soundId = stringField("sound_id", 160);
      const name = stringField("name", 160);
      const sourceServerId = stringField("source_server_id", 160);
      const automaticEvent =
        payload.automatic_event === "join" ||
        payload.automatic_event === "leave"
          ? payload.automatic_event
          : undefined;
      const maxDurationSeconds =
        typeof payload.max_duration_seconds === "number" &&
        Number.isFinite(payload.max_duration_seconds)
          ? Math.min(3, Math.max(0, payload.max_duration_seconds))
          : undefined;
      const dataUrl = this.sanitizeSoundboardDataUrl(payload.data_url);
      const mediaUrl = this.sanitizeSoundboardMediaUrl(payload.media_url);
      const currentTime =
        typeof payload.current_time === "number" &&
        Number.isFinite(payload.current_time) &&
        payload.current_time >= 0 &&
        payload.current_time <= MAX_SOUNDBOARD_POSITION_SECONDS
          ? payload.current_time
          : undefined;
      const paused =
        typeof payload.paused === "boolean" ? payload.paused : undefined;
      const hasDataUrlInput = payload.data_url !== undefined;
      const hasValidDataUrl = !!dataUrl;
      if (!callerUserId || !playbackId) return null;
      if (
        isDmAdmission &&
        !(
          !!soundId &&
          !sourceServerId &&
          !dataUrl &&
          !mediaUrl &&
          DEFAULT_SOUNDBOARD_SOUND_IDS.has(soundId)
        ) &&
        !(
          !!soundId &&
          !!sourceServerId &&
          !dataUrl &&
          !!mediaUrl &&
          mediaUrl.startsWith(SOUNDBOARD_UPLOAD_PATH)
        )
      ) {
        return null;
      }
      if (
        !playbackId ||
        !name ||
        (hasDataUrlInput && !hasValidDataUrl && !mediaUrl) ||
        (!soundId && !hasValidDataUrl && !mediaUrl) ||
        (soundId &&
          !hasValidDataUrl &&
          !mediaUrl &&
          !DEFAULT_SOUNDBOARD_SOUND_IDS.has(soundId))
      )
        return null;
      if (!isSoundboardPlaybackOwnedBy(playbackId, callerUserId)) return null;
      let outboundMediaUrl = mediaUrl;
      if (mediaUrl?.startsWith(SOUNDBOARD_UPLOAD_PATH)) {
        if (isDmAdmission) {
          if (
            !sourceServerId ||
            !soundId ||
            mediaUrl !== getSoundboardUploadUrl(soundId) ||
            !(await this.hasAuthorizedDmSoundboardMedia(
              sourceServerId,
              soundId,
              callerUserId,
            )) ||
            !this.env.REALTIME_TICKET_SECRET
          ) {
            return null;
          }
          const capability = await issueSoundboardMediaCapability(
            {
              soundId,
              sourceServerId,
              roomSlug: this.roomSlug,
              playbackId,
              issuerSubject: callerUserId,
              expiresAt: Date.now() + SOUNDBOARD_MEDIA_CAPABILITY_TTL_MS,
            },
            this.env.REALTIME_TICKET_SECRET,
          );
          outboundMediaUrl = getSoundboardMediaCapabilityUrl(
            soundId,
            capability,
            { roomSlug: this.roomSlug, playbackId },
          );
        } else if (
          !authorizedServerKey ||
          !soundId ||
          mediaUrl !== getSoundboardUploadUrl(soundId) ||
          !(await this.hasSoundboardCatalogEntry(authorizedServerKey, soundId))
        ) {
          return null;
        }
      }
      const volume =
        typeof payload.volume === "number" && Number.isFinite(payload.volume)
          ? Math.min(1, Math.max(0, payload.volume))
          : 1;
      return {
        ...base,
        server_key: serverKey,
        playback_id: playbackId,
        ...(soundId ? { sound_id: soundId } : {}),
        ...(isDmAdmission && sourceServerId
          ? { source_server_id: sourceServerId }
          : {}),
        ...(automaticEvent ? { automatic_event: automaticEvent } : {}),
        ...(maxDurationSeconds !== undefined
          ? { max_duration_seconds: maxDurationSeconds }
          : {}),
        name,
        ...(outboundMediaUrl
          ? { media_url: outboundMediaUrl }
          : hasValidDataUrl
            ? { data_url: dataUrl }
            : {}),
        ...(currentTime !== undefined ? { current_time: currentTime } : {}),
        ...(paused !== undefined ? { paused } : {}),
        volume,
      };
    }

    if (type === "soundboard.catalog-updated") {
      if (isDmAdmission) return null;
      const sound = payload.sound;
      if (!sound || typeof sound !== "object" || Array.isArray(sound))
        return null;
      const metadata = sound as Record<string, unknown>;
      const id =
        typeof metadata.id === "string" ? metadata.id.trim().slice(0, 160) : "";
      if (!id || !authorizedServerKey || !callerUserId) return null;
      const catalogEntry = await this.getAuthorizedSoundboardCatalogEntry(
        authorizedServerKey,
        id,
        callerUserId,
      );
      if (!catalogEntry) return null;
      return {
        ...base,
        server_key: serverKey,
        sound: {
          id,
          name: catalogEntry.name,
          file_url: getSoundboardUploadUrl(id),
          ...(catalogEntry.emoji ? { emoji: catalogEntry.emoji } : {}),
          volume: catalogEntry.volume,
        },
      };
    }

    const playbackId = stringField("playback_id", 160);
    const ownsPlayback =
      !!callerUserId && isSoundboardPlaybackOwnedBy(playbackId, callerUserId);
    if (isDmAdmission && type === "soundboard.volume-set") return null;
    if (type === "soundboard.stop") {
      if (!ownsPlayback || !playbackId) return null;
      const event = { ...base, server_key: serverKey, playback_id: playbackId };
      return event;
    }
    if (type === "soundboard.pause-set") {
      return ownsPlayback && playbackId && typeof payload.paused === "boolean"
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
        !ownsPlayback ||
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

  private async hasSoundboardCatalogEntry(
    serverId: string,
    soundId: string,
  ): Promise<boolean> {
    try {
      const row = await this.env.DB.prepare(
        `SELECT 1
           FROM attachments
           WHERE id = ? AND soundboard_server_id = ?
           LIMIT 1`,
      )
        .bind(soundId, serverId)
        .first();
      return !!row;
    } catch {
      return false;
    }
  }

  private hasServerMembership(
    serverId: string,
    userId: string,
  ): Promise<boolean> {
    return isServerMember(this.env.DB, serverId, userId);
  }

  private async hasAuthorizedDmSoundboardMedia(
    sourceServerId: string,
    soundId: string,
    callerUserId: string,
  ): Promise<boolean> {
    try {
      const row = await this.env.DB.prepare(
        `SELECT a.id, a.soundboard_server_id, a.content_type
           FROM attachments a
           JOIN server_members sm
             ON sm.server_id = a.soundboard_server_id
            AND sm.user_id = ?
          WHERE a.id = ?
            AND a.soundboard_server_id = ?
            AND a.content_type LIKE 'audio/%'
          LIMIT 1`,
      )
        .bind(callerUserId, soundId, sourceServerId)
        .first<{
          id: string;
          soundboard_server_id: string;
          content_type: string;
        }>();

      return (
        !!row &&
        row.id === soundId &&
        row.soundboard_server_id === sourceServerId &&
        row.content_type.startsWith("audio/")
      );
    } catch {
      return false;
    }
  }

  private async getAuthorizedSoundboardCatalogEntry(
    serverId: string,
    soundId: string,
    callerUserId: string,
  ): Promise<{ name: string; emoji: string | null; volume: number } | null> {
    try {
      const row = await this.env.DB.prepare(
        `SELECT id, user_id, filename, sound_name, sound_emoji,
                COALESCE(sound_volume, 1.0) AS sound_volume
           FROM attachments
          WHERE id = ? AND soundboard_server_id = ?
          LIMIT 1`,
      )
        .bind(soundId, serverId)
        .first<{
          id: string;
          user_id: string;
          filename: string;
          sound_name: string | null;
          sound_emoji: string | null;
          sound_volume: number | null;
        }>();
      if (!row) return null;

      if (
        row.user_id !== callerUserId &&
        !(await this.hasManageServerPermission(serverId, callerUserId))
      ) {
        return null;
      }

      const fallbackName = String(row.filename ?? "Sound").replace(
        /\.[^.]+$/,
        "",
      );
      const rawVolume = Number(row.sound_volume ?? 1);
      return {
        name: row.sound_name?.trim() || fallbackName || "Sound",
        emoji: row.sound_emoji?.trim() || null,
        volume: Number.isFinite(rawVolume)
          ? Math.min(1, Math.max(0, rawVolume))
          : 1,
      };
    } catch {
      return null;
    }
  }

  private hasManageServerPermission(
    serverId: string,
    userId: string,
  ): Promise<boolean> {
    return hasServerPermission(
      this.env.DB,
      serverId,
      userId,
      PERMISSIONS.MANAGE_SERVER,
    );
  }

  private sanitizeSoundboardDataUrl(value: unknown): string | null {
    if (typeof value !== "string" || !value.startsWith("data:audio/"))
      return null;
    const match =
      /^data:audio\/[a-z0-9.+-]+;base64,([a-zA-Z0-9+/]+={0,2})$/.exec(value);
    const encoded = match?.[1];
    if (!encoded || encoded.length % 4 !== 0) return null;

    const paddingIndex = encoded.indexOf("=");
    const contentLength = paddingIndex === -1 ? encoded.length : paddingIndex;
    const paddingLength = encoded.length - contentLength;
    const expectedPadding = (4 - (contentLength % 4)) % 4;
    if (contentLength % 4 === 1 || paddingLength !== expectedPadding)
      return null;

    try {
      const decoded = atob(encoded);
      return btoa(decoded) === encoded &&
        decoded.length <= MAX_SOUNDBOARD_DATA_URL_BYTES
        ? value
        : null;
    } catch {
      return null;
    }
  }

  private sanitizeSoundboardMediaUrl(value: unknown): string | null {
    if (typeof value !== "string" || value.length === 0 || value.length > 2048)
      return null;
    try {
      if (value.startsWith("/")) {
        const normalized = normalizeSoundboardUploadUrl(value);
        if (!normalized) return null;
        const url = new URL(normalized, "https://voice-room.invalid");
        return this.hasCredentialBearingUrlMetadata(url) ? null : normalized;
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
      if (url.search || url.hash) return null;
      if (this.hasCredentialBearingUrlMetadata(url)) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  private hasCredentialBearingUrlMetadata(url: URL): boolean {
    const credentialKey =
      /^(?:access[_-]?token|api[_-]?key|auth(?:orization)?|credential|password|secret|token|username)$/i;
    for (const key of url.searchParams.keys()) {
      if (credentialKey.test(key)) return true;
    }
    return /(?:^|[#&?])(?:access[_-]?token|api[_-]?key|auth(?:orization)?|credential|password|secret|token|username)=/i.test(
      url.hash,
    );
  }

  private async purgeParticipantState(
    participantId: string,
    excludeWs?: WebSocket,
  ): Promise<void> {
    this.invalidateNativeScreenOperation(participantId);
    const participant = [
      ...this.sql.exec(
        "SELECT speaking, native_screen_session_id FROM participants WHERE id = ?",
        participantId,
      ),
    ][0];
    if (participant && Number(participant.speaking ?? 0) !== 0) {
      this.broadcast(
        {
          op: Op.Speaking,
          d: { participant_id: participantId, speaking: 0 },
        },
        excludeWs,
      );
    }
    if (participant) {
      this.broadcast(
        {
          op: Op.ClientDisconnect,
          d: { participant_id: participantId },
        },
        excludeWs,
      );
    }

    const tracks = [
      ...this.sql.exec(
        "SELECT track_name, participant_id, sfu_track_name, session_id, mid, kind, simulcast_rids " +
          "FROM tracks WHERE participant_id = ?",
        participantId,
      ),
    ].map((row) => this.toTrackInfo(row));
    const nativeSessionId =
      typeof participant?.native_screen_session_id === "string"
        ? participant.native_screen_session_id
        : null;
    const claimedNativeSession = nativeSessionId
      ? [
          ...this.sql.exec(
            "UPDATE participants SET native_screen_session_id = NULL " +
              "WHERE id = ? AND native_screen_session_id = ? RETURNING id",
            participantId,
            nativeSessionId,
          ),
        ].length > 0
      : false;

    const didChangeStreamWatchers =
      this.clearStreamWatchersByParticipantId(participantId);
    this.sql.exec("DELETE FROM tracks WHERE participant_id = ?", participantId);
    this.sql.exec("DELETE FROM participants WHERE id = ?", participantId);

    this.broadcastStoppedTracks(participantId, tracks, excludeWs);
    if (didChangeStreamWatchers) {
      this.broadcastStreamWatcherSnapshot();
    }

    if (nativeSessionId && claimedNativeSession) {
      const nativeTracks = tracks.filter(
        (track) =>
          track.session_id === nativeSessionId &&
          track.sfu_track_name === undefined,
      );
      await this.closeNativeScreenSession(
        nativeSessionId,
        nativeTracks.flatMap((track) =>
          track.mid ? [{ mid: track.mid, track_name: track.track_name }] : [],
        ),
      );
    }

    this.maybeFreezeListenTogetherForEmptyRoom();
    this.scheduleAlarm();
  }

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
    sendFrame(ws, msg);
  }

  /**
   * Sends to every identified voice socket. An unidentified socket (a
   * standby session, or a ticket holder that never sent VoiceIdentify) has
   * not been admitted to the room and hears none of it; VoiceReady gives it
   * the room's state once it identifies.
   */
  private broadcast(msg: ServerMsg, excludeWs?: WebSocket) {
    broadcastToIdentified(
      this.ctx.getWebSockets(),
      msg,
      (ws) => !!this.getParticipantId(ws),
      excludeWs,
    );
  }
}
