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
const VOICE_PRUNE_ALARM_INTERVAL_MS = 30_000; // check every 30s

// ── VoiceRoom Durable Object ────────────────────────────────────────────────

export class VoiceRoom extends DurableObject<Env> {
  private sessions: Map<WebSocket, VoiceAttachment> = new Map();

  // Shared secret used to verify voice_token from MeetingRoom.
  // In production this should be a proper HMAC secret; for now we use a
  // simple token format: "participant_id:room_slug" signed by the Main GW.
  // The VoiceRoom validates by checking the token structure.
  private roomSlug: string = "";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

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

    // Restore roomSlug from storage (survives hibernation)
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get("roomSlug") as string | undefined;
      if (stored) this.roomSlug = stored;
    });

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
        this.handleVoiceIdentify(ws, msg.d);
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
        await this.handleLeave(ws);
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
    await this.handleLeave(ws);
    try { ws.close(code, reason); } catch { /* already closed */ }
  }

  async webSocketError(ws: WebSocket) {
    await this.handleLeave(ws);
  }

  // ── Alarm: voice zombie pruning ───────────────────────────────────────

  async alarm() {
    const now = Date.now();
    const zombies: WebSocket[] = [];

    for (const [ws, session] of this.sessions) {
      if (session.last_heartbeat && now - session.last_heartbeat > VOICE_ZOMBIE_TIMEOUT_MS) {
        console.log(`[VoiceGW] Pruning zombie: ${session.participant_id}, ` +
          `last_heartbeat=${Math.round((now - session.last_heartbeat) / 1000)}s ago`);
        zombies.push(ws);
      }
    }

    for (const ws of zombies) {
      await this.handleLeave(ws);
    }

    if (this.sessions.size > 0) {
      this.scheduleAlarm();
    }
  }

  private scheduleAlarm() {
    this.ctx.storage.setAlarm(Date.now() + VOICE_PRUNE_ALARM_INTERVAL_MS).catch(() => { });
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
    if (parts.length < 3 || parts[0] !== d.participant_id || parts[1] !== this.roomSlug) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.AuthenticationFailed, message: "Invalid voice token" },
      });
      return;
    }

    // Check token expiry (24 hour window — tokens are HMAC-signed and scoped to participant+room)
    const tokenTimestamp = parseInt(parts[2], 10);
    if (isNaN(tokenTimestamp) || Date.now() - tokenTimestamp > 24 * 60 * 60 * 1000) {
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

    const attachment: VoiceAttachment = {
      participant_id: d.participant_id,
      tracks: [],
      last_heartbeat: Date.now(),
      seq: 0,
    };

    // Evict any existing session for the same participant_id (reconnect scenario)
    for (const [existingWs, existingSession] of this.sessions) {
      if (existingWs !== ws && existingSession.participant_id === d.participant_id) {
        console.log(`[VoiceRoom] Evicting duplicate session for participant=${d.participant_id}`);
        // Clean up old SFU tracks/sessions
        await this.cleanupSfuSessions(existingSession);
        this.sessions.delete(existingWs);
        try { existingWs.close(1000, "Replaced by new connection"); } catch { /* already closed */ }
      }
    }

    this.persist(ws, attachment);

    console.log(`[VoiceRoom] VoiceIdentify: participant=${d.participant_id}`);

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

    console.log(`[VoiceRoom] Sending VoiceReady with ${existingTracks.length} existing tracks`);

    this.sendTo(ws, {
      op: Op.VoiceReady,
      d: {
        participant_id: d.participant_id,
        tracks: existingTracks,
        speaking: speakingStates,
      },
    });
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

        const pushSessionId = session[sessionKey]!;
        const localTracks = d.push_tracks.map((desc) => ({
          location: "local",
          trackName: desc.track_name,
          mid: desc.mid,
        }));

        const pushResp = await this.sfuPost(`sessions/${pushSessionId}/tracks/new`, {
          sessionDescription: { type: "offer", sdp: d.sdp },
          tracks: localTracks,
        });

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
          session.pull_session_id = undefined;
          this.persist(ws, session);
          console.log("[VoiceRoom] Cleared stale pull_session_id for next retry");
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
    // For cam tracks: keep the session — cam PC persists and reuses transceivers.
    if (hasScreen) {
      session.push_session_screen = undefined;
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
      // Also remove from pending_broadcast
      if (session.pending_broadcast) {
        session.pending_broadcast = session.pending_broadcast.filter((t) => !deadSet.has(t.track_name));
      }

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

  private async handleLeave(ws: WebSocket) {
    const session = this.getSession(ws);
    if (!session) return;

    // Close SFU tracks AND sessions
    await this.cleanupSfuSessions(session);

    this.sessions.delete(ws);

    // Broadcast StopTracks for any remaining published tracks
    if (session.tracks.length > 0) {
      this.broadcast({
        op: Op.StopTracks,
        d: {
          participant_id: session.participant_id,
          track_names: session.tracks.map((t) => t.track_name),
        },
      });
    }

    try { ws.close(1000, "Left voice"); } catch { /* already closed */ }
  }

  /** Clean up SFU tracks and sessions for a participant */
  private async cleanupSfuSessions(session: VoiceAttachment) {
    // Close tracks first — group by session_id
    const camTracks = session.tracks.filter(t => t.session_id === session.push_session_cam && t.mid);
    const screenTracks = session.tracks.filter(t => t.session_id === session.push_session_screen && t.mid);

    if (session.push_session_cam && camTracks.length > 0) {
      try {
        await this.sfuPost(`sessions/${session.push_session_cam}/tracks/close`, {
          tracks: camTracks.map((t) => ({ mid: t.mid })),
          force: true,
        });
      } catch { /* Session may already be gone */ }
    }
    if (session.push_session_screen && screenTracks.length > 0) {
      try {
        await this.sfuPost(`sessions/${session.push_session_screen}/tracks/close`, {
          tracks: screenTracks.map((t) => ({ mid: t.mid })),
          force: true,
        });
      } catch { /* Session may already be gone */ }
    }

    // Then close the sessions themselves
    if (session.push_session_cam) {
      this.sfuFetch("PUT", `sessions/${session.push_session_cam}/close`)
        .catch(() => { /* best effort */ });
    }
    if (session.push_session_screen) {
      this.sfuFetch("PUT", `sessions/${session.push_session_screen}/close`)
        .catch(() => { /* best effort */ });
    }
    if (session.pull_session_id) {
      this.sfuFetch("PUT", `sessions/${session.pull_session_id}/close`)
        .catch(() => { /* best effort */ });
    }
  }

  // ── SFU API Helpers ────────────────────────────────────────────────────

  private async sfuFetch(
    method: string,
    path: string
  ): Promise<Record<string, unknown>> {
    const url = `https://rtc.live.cloudflare.com/v1/apps/${this.env.CALLS_APP_ID}/${path}`;
    const resp = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.env.CALLS_APP_SECRET}`,
      },
    });

    const text = await resp.text();
    if (!resp.ok) {
      console.error(`[VoiceRoom:SFU] ${method} ${path} failed (${resp.status}):`,
        text,
        `| APP_ID=${this.env.CALLS_APP_ID}`,
        `| SECRET defined=${!!this.env.CALLS_APP_SECRET}`,
        `| SECRET length=${this.env.CALLS_APP_SECRET?.length ?? 0}`,
        `| SECRET prefix=${this.env.CALLS_APP_SECRET?.slice(0, 6) ?? "N/A"}...`
      );
      throw new Error(`SFU ${method} ${path} failed (${resp.status}): ${text}`);
    }

    return JSON.parse(text);
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
    const resp = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.env.CALLS_APP_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    if (!resp.ok) {
      console.error(`[VoiceRoom:SFU] ${method} ${path} failed (${resp.status}):`,
        text,
        `| APP_ID=${this.env.CALLS_APP_ID}`,
        `| SECRET defined=${!!this.env.CALLS_APP_SECRET}`,
        `| SECRET length=${this.env.CALLS_APP_SECRET?.length ?? 0}`,
        `| SECRET prefix=${this.env.CALLS_APP_SECRET?.slice(0, 6) ?? "N/A"}...`
      );
      throw new Error(`SFU ${method} ${path} failed (${resp.status}): ${text}`);
    }

    return JSON.parse(text);
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
