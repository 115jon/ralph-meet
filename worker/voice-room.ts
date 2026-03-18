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

// WebSocket attachment for voice sessions
interface VoiceAttachment {
  participant_id: string;
  clerk_user_id?: string;
  push_session_cam?: string;    // Separate push session for cam (audio/video)
  push_session_screen?: string; // Separate push session for screen share
  pull_session_id?: string;
  tracks: TrackInfo[];
  pending_broadcast?: TrackInfo[];
  last_heartbeat?: number;
  seq: number;
  speaking?: number;
}

// ── Constants ───────────────────────────────────────────────────────────────

const VOICE_HEARTBEAT_INTERVAL_MS = 15_000; // Shorter for voice — more responsive
const VOICE_ZOMBIE_TIMEOUT_MS = VOICE_HEARTBEAT_INTERVAL_MS * 6; // 90s — more resilient to network hiccups
const VOICE_PRUNE_ALARM_INTERVAL_MS = 300_000; // 5 min safety-net — client zombie detection fires first
const VOICE_RECONNECT_GRACE_MS = 30_000;      // 30s — keep SFU sessions alive for reconnect

// ── VoiceRoom Durable Object ────────────────────────────────────────────────

export class VoiceRoom extends DurableObject<Env> {
  private sessions: Map<WebSocket, VoiceAttachment> = new Map();
  /** Disconnected sessions whose SFU tracks are still alive, awaiting reconnect */
  private pendingReconnects: Map<string, { session: VoiceAttachment; disconnectedAt: number }> = new Map();

  // Shared secret used to verify voice_token from MeetingRoom.
  // In production this should be a proper HMAC secret; for now we use a
  // simple token format: "participant_id:room_slug" signed by the Main GW.
  // The VoiceRoom validates by checking the token structure.
  private roomSlug: string = "";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Auto-respond to heartbeat pings without waking from hibernation
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ op: 3 }),
        JSON.stringify({ op: 6 })
      )
    );

    // Restore state from hibernating WebSockets
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const attachment = ws.deserializeAttachment() as VoiceAttachment | null;
        if (attachment?.participant_id) {
          this.sessions.set(ws, attachment);
        }
      } catch {
        // Corrupted attachment — skip
      }
    }

    // Restore roomSlug from storage on hibernation wakeup.
    // NOTE: We do NOT use blockConcurrencyWhile here — that would block ALL
    // incoming WebSocket messages (including VoiceIdentify) until the storage
    // read completes, which takes 3-5s on a cold/hibernated DO and causes the
    // visible ~5s VoiceIdentify→VoiceReady delay.
    //
    // The roomSlug is always set synchronously by fetch() before any WS message
    // handler runs on a new connection, so blocking here is redundant for the
    // normal join path. For hibernated-alarm wakeups where fetch() doesn't run,
    // the slug is read-back by handleVoiceIdentify lazily (it treats empty slug
    // as a signal to read from storage at that point).
    this.ctx.storage.get<string>("roomSlug").then((stored: string | undefined) => {
      if (stored && !this.roomSlug) this.roomSlug = stored;
    }).catch(() => { });

    // Restore pendingReconnects from storage so it survives DO hibernation.
    // When all WebSockets close simultaneously (e.g. Worker recycle), the DO
    // hibernates immediately and in-memory state is lost. Without this, both
    // users get fresh sessions with no SFU data on reconnect → audio breaks.
    this.ctx.storage.get<Record<string, { session: VoiceAttachment; disconnectedAt: number }>>("pendingReconnects")
      .then((stored) => {
        if (!stored) return;
        const now = Date.now();
        for (const [pid, entry] of Object.entries(stored)) {
          // Discard entries that have already exceeded the grace period
          if (now - entry.disconnectedAt < VOICE_RECONNECT_GRACE_MS) {
            this.pendingReconnects.set(pid, entry);
          }
        }
        if (this.pendingReconnects.size > 0) this.scheduleAlarm();
      }).catch(() => { });

    if (this.sessions.size > 0) {
      this.scheduleAlarm();
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const gatewayVersion = parseInt(url.searchParams.get("v") ?? "1", 10);

    // Extract room slug from URL path: /api/channels/:slug/voice or /api/room/:slug/voice
    const match = url.pathname.match(/\/api\/(?:channels|room)\/([^/]+)\/voice/);
    if (match) {
      this.roomSlug = match[1];
      // Persist for hibernation survival
      this.ctx.storage.put("roomSlug", this.roomSlug).catch(() => { });
    }

    if (url.pathname.endsWith("/voice")) {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);

      console.log(`[VoiceGW] New connection, gateway_version=${gatewayVersion}`);

      // Send Hello — client must respond with VoiceIdentify
      this.sendTo(server, {
        op: Op.Hello,
        d: { heartbeat_interval: VOICE_HEARTBEAT_INTERVAL_MS, gateway_version: gatewayVersion },
      });

      return new Response(null, { status: 101, webSocket: client });
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

      default:
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: CloseCode.UnknownOpcode, message: `Unknown voice opcode: ${msg.op}` },
        });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    // Guard against exceptions during abnormal closure (e.g. code 1006 from
    // edge recycling) — an unguarded throw here marks the event as outcome=exception
    // in Cloudflare observability and can leave sessions in a dangling state.
    try {
      await this.handleLeave(ws);
    } catch (e) {
      console.error(`[VoiceRoom] webSocketClose(${code}) threw in handleLeave:`, e);
    }
    try { ws.close(code, reason); } catch { /* already closed */ }
  }

  async webSocketError(ws: WebSocket) {
    try {
      await this.handleLeave(ws);
    } catch (e) {
      console.error(`[VoiceRoom] webSocketError threw in handleLeave:`, e);
    }
  }

  // ── Alarm: voice zombie pruning ───────────────────────────────────────

  async alarm() {
    const now = Date.now();
    const zombies: WebSocket[] = [];

    for (const [ws, session] of this.sessions) {
      // Use auto-response timestamp as primary liveness signal
      let lastActivity = session.last_heartbeat ?? 0;
      try {
        const autoTs = this.ctx.getWebSocketAutoResponseTimestamp(ws);
        if (autoTs) {
          const autoMs = autoTs.getTime();
          if (autoMs > lastActivity) lastActivity = autoMs;
        }
      } catch { /* ws may be invalid */ }

      if (lastActivity && now - lastActivity > VOICE_ZOMBIE_TIMEOUT_MS) {
        console.log(`[VoiceGW] Pruning zombie: ${session.participant_id}, ` +
          `last_activity=${Math.round((now - lastActivity) / 1000)}s ago`);
        zombies.push(ws);
      }
    }

    for (const ws of zombies) {
      await this.handleLeave(ws);
    }

    // Prune expired pending reconnects — clean up their SFU sessions
    for (const [participantId, pending] of this.pendingReconnects) {
      if (now - pending.disconnectedAt > VOICE_RECONNECT_GRACE_MS) {
        console.log(`[VoiceRoom] Grace period expired for ${participantId}, cleaning up ${pending.session.tracks.length} SFU tracks`);
        await this.cleanupSfuSessions(pending.session);
        // Now broadcast StopTracks since the SFU sessions are gone
        if (pending.session.tracks.length > 0) {
          this.broadcast({
            op: Op.StopTracks,
            d: {
              participant_id: participantId,
              track_names: pending.session.tracks.map((t) => t.track_name),
            },
          });
        }
        this.pendingReconnects.delete(participantId);
      }
    }
    // Sync storage after any pruning
    this.persistPendingReconnects();

    if (this.sessions.size > 0 || this.pendingReconnects.size > 0) {
      this.scheduleAlarm();
    }
  }

  private scheduleAlarm() {
    this.ctx.storage.setAlarm(Date.now() + VOICE_PRUNE_ALARM_INTERVAL_MS).catch(() => { });
  }

  /** Persist pendingReconnects to storage so it survives DO hibernation. */
  private persistPendingReconnects() {
    if (this.pendingReconnects.size === 0) {
      this.ctx.storage.delete("pendingReconnects").catch(() => { });
      return;
    }
    const serializable = Object.fromEntries(this.pendingReconnects.entries());
    this.ctx.storage.put("pendingReconnects", serializable).catch(() => { });
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private persist(ws: WebSocket, data: VoiceAttachment) {
    const wasEmpty = this.sessions.size === 0;
    this.sessions.set(ws, data);
    ws.serializeAttachment(data);
    if (wasEmpty) this.scheduleAlarm();
  }

  private getSession(ws: WebSocket): VoiceAttachment | undefined {
    return this.sessions.get(ws);
  }

  private requireSession(ws: WebSocket): VoiceAttachment | null {
    const session = this.getSession(ws);
    if (!session) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.NotAuthenticated, message: "Not identified on voice" },
      });
      return null;
    }
    return session;
  }

  // ── Op 100: VoiceIdentify ──────────────────────────────────────────────

  private async handleVoiceIdentify(
    ws: WebSocket,
    d: { participant_id: string; voice_token: string }
  ) {
    if (this.getSession(ws)) {
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

    // Lazy roomSlug load — the constructor's non-blocking background read may
    // not have resolved yet on a first-ever VoiceIdentify after hibernation wakeup.
    // The token embeds the room slug, so we can safely trust it here if our
    // stored slug is missing (we verify the full HMAC signature below anyway).
    if (!this.roomSlug && parts.length >= 2) {
      const storedSlug = await this.ctx.storage.get<string>("roomSlug");
      if (storedSlug) this.roomSlug = storedSlug;
      // If still empty, accept the token slug — HMAC verifies its authenticity.
      if (!this.roomSlug) this.roomSlug = parts[1];
    }

    if (parts.length < 3 || parts[0] !== d.participant_id || parts[1] !== this.roomSlug) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.AuthenticationFailed, message: "Invalid voice token" },
      });
      return;
    }

    // Check token expiry (1 hour window — tokens are HMAC-signed and scoped to participant+room)
    const tokenTimestamp = parseInt(parts[2], 10);
    const TOKEN_VALIDITY_MS = 60 * 60 * 1000; // 1 hour
    const tokenAge = Date.now() - tokenTimestamp;
    const clerkUserId = parts.length >= 4 && parts[3] !== "anonymous" ? parts[3] : undefined;

    if (isNaN(tokenTimestamp) || tokenAge > TOKEN_VALIDITY_MS) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.AuthenticationFailed, message: "Voice token expired" },
      });
      return;
    }

    // Verify HMAC signature
    try {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(this.env.CALLS_APP_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"]
      );
      const sigBytes = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
      const valid = await crypto.subtle.verify(
        "HMAC",
        key,
        sigBytes,
        new TextEncoder().encode(payload)
      );
      if (!valid) {
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: CloseCode.AuthenticationFailed, message: "Invalid voice token signature" },
        });
        return;
      }
    } catch {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.AuthenticationFailed, message: "Voice token verification failed" },
      });
      return;
    }

    let attachment: VoiceAttachment = {
      participant_id: d.participant_id,
      clerk_user_id: clerkUserId,
      tracks: [],
      last_heartbeat: Date.now(),
      seq: 0,
    };

    // Ensure pendingReconnects is loaded from storage before checking.
    // The constructor kicks off a non-blocking read, but on a cold hibernate
    // wakeup handleVoiceIdentify can run before it completes — causing the
    // Map to be empty and losing all SFU session transfers (0 tracks bug).
    if (this.pendingReconnects.size === 0) {
      const stored = await this.ctx.storage.get<Record<string, { session: VoiceAttachment; disconnectedAt: number }>>("pendingReconnects");
      if (stored) {
        const now = Date.now();
        for (const [pid, entry] of Object.entries(stored)) {
          if (now - entry.disconnectedAt < VOICE_RECONNECT_GRACE_MS) {
            this.pendingReconnects.set(pid, entry);
          }
        }
        if (this.pendingReconnects.size > 0) {
          console.log(`[VoiceRoom] Restored ${this.pendingReconnects.size} pendingReconnects from storage (cold wakeup)`);
        }
      }
    }

    // Check for pending reconnect — but distinguish between actual reconnects
    // (same participant_id, PCs still alive) vs fresh joins after leave
    // (different participant_id, same clerk_user_id, old PCs destroyed).
    const pendingByPid = this.pendingReconnects.get(d.participant_id);
    if (pendingByPid) {
      // Same participant_id — actual reconnect with same PCs. Transfer SFU data.
      console.log(`[VoiceRoom] Transferring pending SFU sessions for ${d.participant_id}: ` +
        `${pendingByPid.session.tracks.length} tracks, cam=${pendingByPid.session.push_session_cam ?? 'none'}, pull=${pendingByPid.session.pull_session_id ?? 'none'}`);
      attachment = {
        ...attachment,
        tracks: pendingByPid.session.tracks,
        push_session_cam: pendingByPid.session.push_session_cam,
        push_session_screen: pendingByPid.session.push_session_screen,
        pull_session_id: pendingByPid.session.pull_session_id,
        pending_broadcast: pendingByPid.session.pending_broadcast,
        speaking: pendingByPid.session.speaking,
      };
      this.pendingReconnects.delete(d.participant_id);
      this.persistPendingReconnects();
    } else if (clerkUserId) {
      // Check for stale pending sessions from the same clerk user but
      // different participant_id — this means the user left (disconnect()
      // destroyed PCs) and rejoined. Clean up the dead SFU sessions.
      let staleCleaned = false;
      for (const [oldPid, oldPending] of this.pendingReconnects) {
        if (oldPending.session.clerk_user_id === clerkUserId) {
          console.log(`[VoiceRoom] Fresh join for clerk=${clerkUserId}, cleaning up stale SFU sessions from old participant=${oldPid}`);
          this.ctx.waitUntil(this.cleanupSfuSessions(oldPending.session));
          if (oldPending.session.tracks.length > 0) {
            this.broadcast({
              op: Op.StopTracks,
              d: {
                participant_id: oldPid,
                track_names: oldPending.session.tracks.map((t) => t.track_name),
              },
            });
          }
          this.pendingReconnects.delete(oldPid);
          staleCleaned = true;
        }
      }
      if (staleCleaned) this.persistPendingReconnects();
    }

    // Evict any existing LIVE session for the same participant_id OR clerk_user_id
    for (const [existingWs, existingSession] of this.sessions) {
      if (
        existingWs !== ws &&
        (existingSession.participant_id === d.participant_id ||
          (clerkUserId && existingSession.clerk_user_id === clerkUserId))
      ) {
        console.log(`[VoiceRoom] Evicting duplicate session for participant=${existingSession.participant_id}, clerk=${existingSession.clerk_user_id}`);
        // Only clean up SFU if we didn't already transfer from pending
        if (!pendingByPid) {
          this.ctx.waitUntil(this.cleanupSfuSessions(existingSession));
        }
        this.sessions.delete(existingWs);
        try { existingWs.close(1000, "Replaced by new connection"); } catch { /* already closed */ }
      }
    }

    this.persist(ws, attachment);

    console.log(`[VoiceRoom] VoiceIdentify: participant=${d.participant_id}`);

    // ── Send VoiceReady IMMEDIATELY ─────────────────────────────────────
    // Collect existing tracks and speaking states from all other voice participants
    const existingTracks: TrackInfo[] = [];
    const speakingStates: Record<string, number> = {};
    for (const [otherWs, otherSession] of this.sessions) {
      if (otherWs === ws) continue;
      for (const track of otherSession.tracks) {
        existingTracks.push(track);
      }
      if (otherSession.speaking) {
        speakingStates[otherSession.participant_id] = otherSession.speaking;
      }
    }
    // ALSO include tracks from participants still in pendingReconnects.
    // When two users disconnect simultaneously (Worker recycle), whoever
    // reconnects first will find the other user still in pendingReconnects
    // (not yet in sessions). Without this, VoiceReady has 0 existing tracks
    // and the pull PC — which is still alive — never re-pulls. Audio breaks.
    // Their SFU sessions are still live during the grace period, so the
    // pull PC's existing ICE connection can still receive their audio.
    for (const [pid, pending] of this.pendingReconnects) {
      if (pid === d.participant_id) continue; // skip self
      for (const track of pending.session.tracks) {
        existingTracks.push(track);
      }
      if (pending.session.speaking) {
        speakingStates[pid] = pending.session.speaking;
      }
    }

    console.log(`[VoiceRoom] Sending VoiceReady with ${existingTracks.length} existing tracks`);

    this.sendTo(ws, {
      op: Op.VoiceReady,
      d: {
        participant_id: d.participant_id,
        tracks: existingTracks,
        speaking: speakingStates,
      },
    });

    // ── Pre-create SFU sessions in the BACKGROUND ──────────────────────
    // These are only needed when the client sends SelectProtocol (push/pull).
    // If pre-creation finishes before SelectProtocol arrives, great — it saves
    // ~100-300ms per session. If not, handleSelectProtocol lazily creates them.
    // Previously this blocked VoiceReady by 2-10s on cold Cloudflare Calls API.
    //
    // IMPORTANT: We do NOT call this.persist() here. The background pre-creation
    // runs concurrently with incoming webSocketMessage handlers. If we persisted,
    // we could overwrite session IDs that handleSelectProtocol lazily created.
    // Instead we only set values on the in-memory session object (which IS the
    // same reference returned by this.sessions.get(ws)), and let the next
    // handleSelectProtocol persist naturally.
    if (!attachment.push_session_cam || !attachment.pull_session_id) {
      const needCam = !attachment.push_session_cam;
      const needPull = !attachment.pull_session_id;
      this.ctx.waitUntil((async () => {
        try {
          const sessionsToCreate: Promise<Record<string, unknown>>[] = [];
          if (needCam) sessionsToCreate.push(this.sfuFetch("POST", "sessions/new"));
          if (needPull) sessionsToCreate.push(this.sfuFetch("POST", "sessions/new"));

          const results = await Promise.all(sessionsToCreate);
          let idx = 0;
          // Only set if still unset — handleSelectProtocol may have lazily created one
          if (needCam && !attachment.push_session_cam && idx < results.length) {
            attachment.push_session_cam = results[idx].sessionId as string;
            console.log(`[VoiceRoom:SFU] Pre-created cam push session: ${attachment.push_session_cam}`);
          }
          if (needCam) idx++;
          if (needPull && !attachment.pull_session_id && idx < results.length) {
            attachment.pull_session_id = results[idx].sessionId as string;
            console.log(`[VoiceRoom:SFU] Pre-created pull session: ${attachment.pull_session_id}`);
          }
          // Do NOT persist here — let handleSelectProtocol do it to avoid race
        } catch (err) {
          console.warn("[VoiceRoom:SFU] Background pre-creation failed (non-fatal, will retry lazily):", err);
        }
      })());
    }
  }

  // ── Op 3: Heartbeat ────────────────────────────────────────────────────

  private handleHeartbeat(ws: WebSocket, d: { seq_ack?: number }) {
    const session = this.getSession(ws);

    // Always ACK — even for unidentified sessions. See the identical fix in
    // meeting-room.ts for the full explanation. Short version: when the DO
    // is awake, auto-response doesn't fire and a missing ACK here causes the
    // client-side HeartbeatManager to zombie-close the connection.
    if (!session) {
      this.sendTo(ws, { op: Op.HeartbeatACK, d: { seq: 0 } });
      return;
    }

    // Update last_heartbeat as a fallback liveness signal for alarm() zombie detection.
    // When the DO is awake (e.g. from the 60s alarm), heartbeats arrive here instead
    // of through auto-response — so getWebSocketAutoResponseTimestamp() won't update.
    // Persisting the attachment ensures the timestamp survives hibernation restoration.
    session.last_heartbeat = Date.now();
    this.persist(ws, session);

    this.sendTo(ws, {
      op: Op.HeartbeatACK,
      d: { seq: session.seq ?? 0 },
    });
  }

  // ── Op 5: Speaking (forwarded to all other voice participants) ─────────

  private handleSpeaking(ws: WebSocket, d: { speaking: number }) {
    const session = this.requireSession(ws);
    if (!session) return;

    session.speaking = d.speaking;
    this.persist(ws, session);

    this.broadcast(
      {
        op: Op.Speaking,
        d: {
          participant_id: session.participant_id,
          speaking: d.speaking,
        },
      },
      ws
    );
  }

  // ── Op 1: SelectProtocol (push/pull tracks) ────────────────────────────

  private async handleSelectProtocol(
    ws: WebSocket,
    d: { sdp: string; push_tracks: PushTrackDescriptor[]; pull_tracks: TrackInfo[]; push_prefix?: string }
  ) {
    const session = this.requireSession(ws);
    if (!session) return;

    try {
      // ── Handle push (local) tracks ──────────────────────────────────
      if (d.push_tracks.length > 0 && d.sdp) {
        // Use per-prefix push sessions so cam and screen PeerConnections
        // each get their own SFU session and don't interfere with each other.
        const prefix = d.push_prefix === 'screen' ? 'screen' : 'cam';
        const sessionKey = prefix === 'screen' ? 'push_session_screen' : 'push_session_cam';

        if (!session[sessionKey]) {
          const sessionResp = await this.sfuFetch("POST", "sessions/new");
          session[sessionKey] = sessionResp.sessionId as string;
          console.log(`[VoiceRoom:SFU] Created push session (${prefix}):`, session[sessionKey]);
        }

        let pushSessionId = session[sessionKey]!;
        const localTracks = d.push_tracks.map((desc) => ({
          location: "local",
          trackName: desc.track_name,
          mid: desc.mid,
        }));

        let pushResp: Record<string, unknown>;
        try {
          pushResp = await this.sfuPost(`sessions/${pushSessionId}/tracks/new`, {
            sessionDescription: { type: "offer", sdp: d.sdp },
            tracks: localTracks,
          });
        } catch (pushErr: unknown) {
          // If the pre-created/cached push session expired (410/session_error),
          // create a fresh session and retry once. This typically happens when
          // the user waits a while before speaking — the SFU times out the idle session.
          const pushMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
          if (pushMsg.includes("(410)") || pushMsg.includes("session_error")) {
            console.warn(`[VoiceRoom:SFU] Push session ${prefix} stale (${pushSessionId.slice(0, 8)}...), creating fresh session and retrying`);
            const freshResp = await this.sfuFetch("POST", "sessions/new");
            session[sessionKey] = freshResp.sessionId as string;
            pushSessionId = session[sessionKey]!;
            console.log(`[VoiceRoom:SFU] Fresh push session (${prefix}):`, pushSessionId);
            pushResp = await this.sfuPost(`sessions/${pushSessionId}/tracks/new`, {
              sessionDescription: { type: "offer", sdp: d.sdp },
              tracks: localTracks,
            });
          } else {
            throw pushErr; // re-throw non-stale errors
          }
        }

        console.log("[VoiceRoom:SFU] Push tracks/new response tracks:", JSON.stringify(pushResp.tracks));

        const answerSdp = (pushResp.sessionDescription as { sdp: string })?.sdp ?? "";

        // Build negotiated track info
        const respTracks = (pushResp.tracks as Array<Record<string, unknown>>) ?? [];
        const negotiatedTracks: TrackInfo[] = [];
        for (const rt of respTracks) {
          if (rt.location === "local") {
            negotiatedTracks.push({
              participant_id: session.participant_id,
              track_name: rt.trackName as string,
              session_id: pushSessionId,
              mid: rt.mid as string | undefined,
              kind: (rt.trackName as string)?.includes("audio") ? "audio" : "video",
            });
          }
        }
        // Fallback
        if (negotiatedTracks.length === 0) {
          for (const desc of d.push_tracks) {
            negotiatedTracks.push({
              participant_id: session.participant_id,
              track_name: desc.track_name,
              session_id: pushSessionId,
              mid: desc.mid,
              kind: desc.kind,
            });
          }
        }

        // NOTE: Do NOT add tracks to session.tracks here.
        // They go to pending_broadcast (below) and are only promoted to
        // session.tracks when the publisher confirms TracksReady (Op 102),
        // ensuring RTP is actually flowing before viewers try to pull.

        this.persist(ws, session);

        // Op 4: SessionDescription (answer for push)
        this.sendTo(ws, {
          op: Op.SessionDescription,
          d: {
            sdp: answerSdp,
            session_id: pushSessionId,
            tracks: negotiatedTracks,
            sdp_type: "answer",
          },
        });

        // Op 12: Video (tracks published) to other voice participants
        // We do NOT broadcast immediately anymore.
        // We wait for Op.TracksReady from the publisher so we know RTP
        // is flowing before viewers try to pull. We queue them in pending_broadcast.
        const broadcastTracks = [...negotiatedTracks];
        session.pending_broadcast = (session.pending_broadcast || []).concat(broadcastTracks);
        this.persist(ws, session);
      }

      // ── Handle pull (remote) tracks ─────────────────────────────────
      if (d.pull_tracks.length > 0) {
        if (!session.pull_session_id) {
          const sessionResp = await this.sfuFetch("POST", "sessions/new");
          session.pull_session_id = sessionResp.sessionId as string;
          console.log("[VoiceRoom:SFU] Created pull session:", session.pull_session_id);
        }

        const pullSessionId = session.pull_session_id;
        const remoteTracks = d.pull_tracks.map((info) => {
          const base: Record<string, unknown> = {
            location: "remote",
            trackName: info.track_name,
            sessionId: info.session_id,
          };
          // Pass simulcast layer preference for video tracks so the SFU
          // delivers the requested quality instead of auto-selecting.
          if (info.kind === "video" && info.rid) {
            // Screen shares: force the preferred layer — text/detail is unreadable downscaled.
            // Camera: allow bandwidth-based fallback via asciibetical ordering.
            const isScreen = info.track_name.startsWith("screen-");
            base.simulcast = {
              preferredRid: info.rid,
              priorityOrdering: isScreen ? "none" : "asciibetical",
              ridNotAvailable: "asciibetical",
            };
          }
          return base;
        });

        const pullResp = await this.sfuPost(`sessions/${pullSessionId}/tracks/new`, {
          tracks: remoteTracks,
        });

        console.log("[VoiceRoom:SFU] Pull response keys:", Object.keys(pullResp).join(", "));

        const pullSdp = (pullResp.sessionDescription as { sdp: string })?.sdp ?? "";
        const pullSdpType = ((pullResp.sessionDescription as { type: string })?.type ?? "offer") as "answer" | "offer";

        const respTracks = (pullResp.tracks as Array<Record<string, unknown>>) ?? [];
        const failedTracks = respTracks.filter((rt) => rt.errorCode);
        const successTracks = respTracks.filter((rt) => !rt.errorCode);

        if (failedTracks.length > 0) {
          console.warn("[VoiceRoom:SFU] Pull had failed tracks:", JSON.stringify(failedTracks));
          // Evict permanently-failed tracks from the publisher's session.tracks
          // so other receivers (and re-pull attempts) don't keep retrying against
          // a dead push. These error codes indicate the publisher's RTP is gone.
          this.evictDeadPublisherTracks(failedTracks);
        }

        if (!pullSdp || successTracks.length === 0) {
          const failedTrackNames = failedTracks.map((rt) => rt.trackName as string);

          // CRITICAL: The SFU's signaling state might be stuck waiting for a remote answer.
          // Since all requested tracks failed, we are aborting the exchange on the client side.
          // We MUST clear the pull_session_id so the next pull attempt starts completely fresh,
          // rather than reusing a frozen session and hitting a 406 "expecting a remote answer" error.
          session.pull_session_id = undefined;
          this.persist(ws, session);

          this.sendTo(ws, {
            op: Op.Error,
            d: { code: 0, message: `pull-retry:${JSON.stringify(failedTrackNames)}` },
          });
          return;
        }

        if (failedTracks.length > 0) {
          const failedTrackNames = failedTracks.map((rt) => rt.trackName as string);
          setTimeout(() => {
            this.sendTo(ws, {
              op: Op.Error,
              d: { code: 0, message: `pull-retry:${JSON.stringify(failedTrackNames)}` },
            });
          }, 100);
        }

        const pullNegotiated: TrackInfo[] = successTracks.map((rt) => {
          const originalTrack = d.pull_tracks.find((pt) => pt.track_name === (rt.trackName as string));
          return {
            participant_id: originalTrack?.participant_id ?? "unknown",
            track_name: rt.trackName as string,
            session_id: (rt.sessionId as string) ?? pullSessionId,
            mid: rt.mid as string | undefined,
            kind: (rt.trackName as string)?.includes("audio") ? "audio" as const : "video" as const,
          };
        });

        this.persist(ws, session);

        // Op 4: SessionDescription (offer from SFU → client must answer)
        this.sendTo(ws, {
          op: Op.SessionDescription,
          d: {
            sdp: pullSdp,
            session_id: pullSessionId,
            tracks: pullNegotiated,
            sdp_type: pullSdpType,
          },
        });
      }

      // Negotiation is done immediately ONLY if push tracks were processed.
      // For pull tracks, negotiation is done later in handleAnswer after the client responds.
      if (d.push_tracks.length > 0 && d.sdp) {
        this.sendTo(ws, { op: Op.NegotiationDone, d: {} });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[VoiceRoom] SFU error:", message);
      // If the SFU says the session is stale/not-ready, clear the pull session
      // so the next request creates a fresh one
      if (
        message.includes("Session is not ready") ||
        message.includes("session_error") ||
        message.includes("(410)") ||
        message.includes("(425)")
      ) {
        const session = this.requireSession(ws);
        if (session) {
          // Clear BOTH pull and push sessions — whichever was stale.
          // handleSelectProtocol will lazily create fresh ones on next attempt.
          session.pull_session_id = undefined;
          session.push_session_cam = undefined;
          session.push_session_screen = undefined;
          this.persist(ws, session);
          console.log("[VoiceRoom] Cleared stale session IDs (push+pull) for next retry");
        }
      }
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 0, message: `SFU error: ${message}` },
      });
    }
  }

  // ── Op 12: Video (client pull request) ─────────────────────────────────

  private async handleVideo(ws: WebSocket, d: { tracks: TrackInfo[] }) {
    const session = this.requireSession(ws);
    if (!session) return;
    await this.handleSelectProtocol(ws, {
      sdp: "",
      push_tracks: [],
      pull_tracks: d.tracks,
    });
  }

  // ── Op 14: Answer (pull renegotiation) ─────────────────────────────────

  private async handleAnswer(ws: WebSocket, d: { sdp: string }) {
    const session = this.requireSession(ws);
    if (!session?.pull_session_id) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 0, message: "No pull session" },
      });
      return;
    }

    try {
      await this.sfuPut(`sessions/${session.pull_session_id}/renegotiate`, {
        sessionDescription: { type: "answer", sdp: d.sdp },
      });
      // PULL negotiation is done here (SFU received answer)
      this.sendTo(ws, { op: Op.NegotiationDone, d: {} });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 0, message: `Renegotiate error: ${message}` },
      });
    }
  }

  // ── Op 13: StopTracks ──────────────────────────────────────────────────

  private async handleStopTracks(ws: WebSocket, d: { track_names: string[] }) {
    const session = this.requireSession(ws);
    if (!session) return;

    // Determine which push session owns these tracks
    const hasScreen = d.track_names.some(n => n.startsWith('screen-'));
    const oldPushSessionId = hasScreen ? session.push_session_screen : session.push_session_cam;
    const trackNameSet = new Set(d.track_names);
    const tracksToClose = session.tracks
      .filter((t) => trackNameSet.has(t.track_name) && t.mid)
      .map((t) => ({ mid: t.mid, trackName: t.track_name }));

    session.tracks = session.tracks.filter((t) => !trackNameSet.has(t.track_name));

    // For screen tracks: clear the screen push session so the next screen share
    // gets a fresh SFU session. The client creates a new screen PC for each share,
    // so the old session's mids are stale and can't be reused.
    if (hasScreen) {
      session.push_session_screen = undefined;
    }

    // For cam tracks: if ALL cam tracks have been stopped (e.g. after ICE failure
    // and push reset), clear push_session_cam so the next publish creates a fresh
    // SFU session. When only some cam tracks are stopped (e.g. camera off but
    // audio stays), the session is preserved for transceiver reuse.
    if (!hasScreen && session.push_session_cam) {
      const hasCamTracksRemaining = session.tracks.some(
        t => t.session_id === session.push_session_cam
      );
      if (!hasCamTracksRemaining) {
        console.log(`[VoiceRoom] All cam tracks stopped — clearing push_session_cam for fresh session`);
        session.push_session_cam = undefined;
      }
    }

    this.persist(ws, session);

    console.log(`[VoiceRoom] Tracks stopped by ${session.participant_id}:`, d.track_names);

    // Op 13: broadcast to others
    this.broadcast(
      {
        op: Op.StopTracks,
        d: { participant_id: session.participant_id, track_names: d.track_names, session_id: oldPushSessionId },
      },
      ws
    );

    // Await tracks/close on SFU — MUST complete before the next SelectProtocol
    // (re-publish) runs. Fire-and-forget causes a race: tracks/close and tracks/new
    // execute concurrently on the SFU, leading to empty_track_error.
    if (oldPushSessionId && tracksToClose.length > 0) {
      try {
        await this.sfuPut(`sessions/${oldPushSessionId}/tracks/close`, {
          tracks: tracksToClose,
          force: true,
        });
      } catch (err) {
        console.warn("[VoiceRoom:SFU] tracks/close failed (non-fatal):", err);
      }
    }
  }

  // ── Op 102: TracksReady ──────────────────────────────────────────────────

  private handleTracksReady(ws: WebSocket, d: { track_names: string[] }) {
    const session = this.requireSession(ws);
    if (!session || !session.pending_broadcast || session.pending_broadcast.length === 0) return;

    // Filter pending tracks that match the ones the client marked as ready
    const trackNameSet = new Set(d.track_names);
    const readyTracks = session.pending_broadcast.filter((t) => trackNameSet.has(t.track_name));

    if (readyTracks.length === 0) return;

    // Remove them from pending
    session.pending_broadcast = session.pending_broadcast.filter((t) => !trackNameSet.has(t.track_name));

    // Add to active tracks (replace any stale entry with the same track_name)
    for (const rt of readyTracks) {
      const idx = session.tracks.findIndex((t) => t.track_name === rt.track_name);
      if (idx >= 0) {
        session.tracks[idx] = rt;
      } else {
        session.tracks.push(rt);
      }
    }
    this.persist(ws, session);

    // Broadcast the Op.Video to everyone else
    this.broadcast(
      {
        op: Op.Video,
        d: { participant_id: session.participant_id, tracks: readyTracks },
      },
      ws
    );
  }

  // ── Op 103: TrackUpdate (simulcast layer change, no renegotiation) ─────

  private async handleTrackUpdate(
    ws: WebSocket,
    d: { tracks: Array<{ track_name: string; session_id: string; mid: string; rid: string }> }
  ) {
    const session = this.requireSession(ws);
    if (!session?.pull_session_id) return;

    try {
      // Build the tracks/update payload for the Cloudflare Calls API.
      // Each entry updates the simulcast preference on an existing pulled track.
      const updates = d.tracks.map((t) => ({
        trackName: t.track_name,
        sessionId: t.session_id,
        mid: t.mid,
        simulcast: {
          preferredRid: t.rid,
          // Screen shares: force preferred layer. Camera: allow fallback.
          priorityOrdering: (t.track_name.startsWith("screen-") ? "none" : "asciibetical") as "none" | "asciibetical",
          ridNotAvailable: "asciibetical" as const,
        },
      }));

      await this.sfuPut(`sessions/${session.pull_session_id}/tracks/update`, {
        tracks: updates,
      });

      console.log(`[VoiceRoom:SFU] Updated simulcast for ${d.tracks.length} tracks: ${d.tracks.map(t => `${t.track_name}→${t.rid}`).join(", ")}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[VoiceRoom:SFU] tracks/update failed (non-fatal):", message);
    }
  }

  /**
   * When the SFU reports tracks as permanently unavailable (empty_track_error,
   * not_found_track_error, internal_error), find the publisher session that
   * owns those tracks and evict them. This stops receivers from endlessly
   * retrying pulls against a dead push session.
   */
  private evictDeadPublisherTracks(failedTracks: Array<Record<string, unknown>>) {
    const FATAL_ERRORS = new Set([
      "empty_track_error",
      "not_found_track_error",
      "internal_error",
    ]);

    const deadTrackNames = failedTracks
      .filter((ft) => FATAL_ERRORS.has(ft.errorCode as string))
      .map((ft) => ft.trackName as string);

    if (deadTrackNames.length === 0) return;

    const deadSet = new Set(deadTrackNames);

    for (const [ws, session] of this.sessions) {
      const before = session.tracks.length;
      session.tracks = session.tracks.filter((t) => !deadSet.has(t.track_name));
      // Do NOT evict from pending_broadcast. Tracks in pending_broadcast have
      // not yet fired TracksReady — the publisher's ICE is still connecting.
      // Evicting them would permanently kill a live publish that is seconds away
      // from becoming available. The client-side fix (waiting for connected before
      // TracksReady) prevents the race, but this guard protects against any future
      // timing edge-case.

      if (session.tracks.length < before) {
        const removed = deadTrackNames.filter((n) =>
          !session.tracks.some((t) => t.track_name === n)
        );
        console.log(`[VoiceRoom] Evicted ${removed.length} dead tracks from publisher ${session.participant_id}: ${removed.join(", ")}`);
        this.persist(ws, session);

        // Broadcast StopTracks so other receivers stop pulling
        this.broadcast(
          {
            op: Op.StopTracks,
            d: {
              participant_id: session.participant_id,
              track_names: removed,
              session_id: removed.some(n => n.startsWith('screen-')) ? session.push_session_screen : session.push_session_cam,
            },
          },
          ws
        );
      }
    }
  }

  // ── Leave / Disconnect ─────────────────────────────────────────────────

  private async handleLeave(ws: WebSocket, graceful = false) {
    const session = this.getSession(ws);
    if (!session) return;

    this.sessions.delete(ws);

    // Graceful leave (Op.ClientDisconnect): user intentionally left → clean up immediately.
    // Abrupt close: keep SFU sessions alive in pendingReconnects so the client
    // can reconnect and transfer them — zero audio interruption.
    if (graceful || !session.tracks.length) {
      // Immediate cleanup
      await this.cleanupSfuSessions(session);
      if (session.tracks.length > 0) {
        this.broadcast({
          op: Op.StopTracks,
          d: {
            participant_id: session.participant_id,
            track_names: session.tracks.map((t) => t.track_name),
          },
        });
      }
    } else {
      // Abrupt disconnect with active tracks — grace period
      console.log(`[VoiceRoom] Parking ${session.tracks.length} SFU tracks for ${session.participant_id} (${VOICE_RECONNECT_GRACE_MS / 1000}s grace)`);
      this.pendingReconnects.set(session.participant_id, {
        session,
        disconnectedAt: Date.now(),
      });
      // Persist immediately so it survives DO hibernation. When all clients
      // disconnect at once, the DO hibernates before any reconnect arrives
      // and the in-memory Map would be lost without this.
      this.persistPendingReconnects();
      // Don't broadcast StopTracks — SFU sessions are still alive,
      // other participants' pull PCs keep receiving the audio.
      this.scheduleAlarm();
    }

    try { ws.close(1000, "Left voice"); } catch { /* already closed */ }
  }

  /** Clean up SFU tracks and sessions for a participant.
   *
   * A 410 "session_error" response means the Cloudflare Calls SFU has already
   * detected the dead PeerConnection and evicted the session — this is the
   * expected outcome when the client closed its RTCPeerConnection before we
   * get to issue the tracks/close API call (e.g. tab close race condition).
   * We treat 410 as success and log at warn level instead of error. */
  private async cleanupSfuSessions(session: VoiceAttachment) {
    // Close tracks — group by session_id and run in parallel
    const camTracks = session.tracks.filter(t => t.session_id === session.push_session_cam && t.mid);
    const screenTracks = session.tracks.filter(t => t.session_id === session.push_session_screen && t.mid);

    const closeSession = async (sessionId: string, tracks: TrackInfo[]) => {
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
        // 410 = SFU already evicted the session because the PeerConnection died.
        // This is the expected outcome on tab-close — treat it as a silent success.
        if (resp.status === 410) {
          console.warn(`[VoiceRoom:SFU] tracks/close 410 for session ${sessionId.slice(0, 8)}... — PC already disconnected, session evicted by SFU (expected)`);
          return;
        }
        // Any other non-2xx: log for visibility but still don't throw —
        // cleanup failures are non-fatal; the SFU will GC sessions eventually.
        const body = await resp.text().catch(() => "(unreadable)");
        console.warn(`[VoiceRoom:SFU] tracks/close ${resp.status} for session ${sessionId.slice(0, 8)}...:`, body);
      } catch (err) {
        // Network error — non-fatal, SFU will GC on its own
        console.warn(`[VoiceRoom:SFU] tracks/close network error for session ${sessionId.slice(0, 8)}...:`, err);
      }
    };

    // Run cam and screen cleanup in parallel
    const cleanupTasks: Promise<void>[] = [];
    if (session.push_session_cam && camTracks.length > 0) {
      cleanupTasks.push(closeSession(session.push_session_cam, camTracks));
    }
    if (session.push_session_screen && screenTracks.length > 0) {
      cleanupTasks.push(closeSession(session.push_session_screen, screenTracks));
    }
    if (cleanupTasks.length > 0) await Promise.all(cleanupTasks);

    // Sessions themselves are automatically evicted by Cloudflare Calls when the
    // client disconnects its RTCPeerConnection and the tracks are explicitly closed.
    // There is no /close endpoint (it returns 405 reserved for WHIP/WHEP).
  }

  // ── SFU API Helpers ────────────────────────────────────────────────────

  private async sfuFetch(
    method: string,
    path: string
  ): Promise<Record<string, unknown>> {
    const url = `https://rtc.live.cloudflare.com/v1/apps/${this.env.CALLS_APP_ID}/${path}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      const resp = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.env.CALLS_APP_SECRET}`,
        },
      });

      const text = await resp.text();

      if (resp.ok) return JSON.parse(text);

      // Retry once on 5xx (server error) after a short delay
      if (resp.status >= 500 && attempt === 0) {
        console.warn(`[VoiceRoom:SFU] ${method} ${path} returned ${resp.status}, retrying in 500ms...`);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      console.error(`[VoiceRoom:SFU] ${method} ${path} failed (${resp.status}):`,
        text,
        `| APP_ID=${this.env.CALLS_APP_ID}`,
        `| SECRET defined=${!!this.env.CALLS_APP_SECRET}`,
        `| SECRET length=${this.env.CALLS_APP_SECRET?.length ?? 0}`,
        `| SECRET prefix=${this.env.CALLS_APP_SECRET?.slice(0, 6) ?? "N/A"}...`
      );
      throw new Error(`SFU ${method} ${path} failed (${resp.status}): ${text}`);
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
      const resp = await fetch(url, {
        method,
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
        console.warn(`[VoiceRoom:SFU] ${method} ${path} returned ${resp.status}, retrying in 500ms...`);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      console.error(`[VoiceRoom:SFU] ${method} ${path} failed (${resp.status}):`,
        text,
        `| APP_ID=${this.env.CALLS_APP_ID}`,
        `| SECRET defined=${!!this.env.CALLS_APP_SECRET}`,
        `| SECRET length=${this.env.CALLS_APP_SECRET?.length ?? 0}`,
        `| SECRET prefix=${this.env.CALLS_APP_SECRET?.slice(0, 6) ?? "N/A"}...`
      );
      throw new Error(`SFU ${method} ${path} failed (${resp.status}): ${text}`);
    }

    throw new Error(`SFU ${method} ${path} failed after retry`);
  }

  // ── Utilities ─────────────────────────────────────────────────────────

  private sendTo(ws: WebSocket, msg: ServerMsg) {
    try { ws.send(JSON.stringify(msg)); } catch { /* closed */ }
  }

  private broadcast(msg: ServerMsg, excludeWs?: WebSocket) {
    const json = JSON.stringify(msg);
    for (const [ws] of this.sessions) {
      if (ws === excludeWs) continue;
      try { ws.send(json); } catch { /* skip dead */ }
    }
  }
}
