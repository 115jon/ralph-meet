// ============================================================================
// SFUClient — Dual Gateway client for WebRTC room signaling
//
// Manages TWO WebSocket connections:
//   Main Gateway  (mainWs)  → presence, voice state, profile, heartbeat
//   Voice Gateway (voiceWs) → media signaling, SFU negotiation, tracks
//
// Flow:
//   1. Connect mainWs → receive Hello → send Identify → receive Ready
//   2. Ready includes voice_token → connect voiceWs
//   3. voiceWs Hello → send VoiceIdentify → receive VoiceReady
//   4. Now media operations (publish, pull, stop) go through voiceWs
//   5. VoiceStateUpdate (mute/camera), profile, heartbeat go through mainWs
//   6. Speaking (VAD) goes through voiceWs
// ============================================================================

import { wsUrl } from "./platform";
import {
  VoiceOpcode,
  type ClientMessage,
  type ErrorPayload,
  type HeartbeatACKPayload,
  type HelloPayload,
  type IceServer,
  type ProfileUpdatePayload,
  type ReadyPayload,
  type ServerMessage,
  type SessionDescriptionPayload,
  type SFUEventMap,
  type SpeakingPayloadServer,
  type StopTracksPayloadServer,
  type TrackInfo,
  type VideoPayloadServer,
  type VoiceConnectionStats,
  type VoiceReadyPayload,
  type VoiceStateUpdatePayload
} from "./types";
import { AudioPipeline } from "./voice/audio-pipeline";
import { HeartbeatManager } from "./voice/heartbeat-manager";
import { ConnectionStatsMonitor } from "./voice/stats-monitor";
import { createTrueStereoStream as _createTrueStereoStream } from "./voice/stereo-codec";
import { TrackNegotiator } from "./voice/track-negotiator";
import { VoiceActivityDetector } from "./voice/vad";

// Re-export event types so consumers can import from sfu-client.ts
export type { SFUEventMap, VoiceConnectionStats } from "./types";

type EventHandler<T> = (data: T) => void;

// ── SFUClient ───────────────────────────────────────────────────────────────

export class SFUClient {
  // ── WebSocket connections ─────────────────────────────────────────────
  private mainWs: WebSocket | null = null;   // Main Gateway (presence)
  private voiceWs: WebSocket | null = null;  // Voice Gateway (media)

  // ── WebRTC ────────────────────────────────────────────────────────────
  public readonly negotiator: TrackNegotiator;

  // ── Room state ────────────────────────────────────────────────────────
  private roomSlug: string;
  private participantId: string | null = null;
  private voiceToken: string | null = null;
  private iceServers: IceServer[] = [];
  private pendingPullTracks: TrackInfo[] = [];

  private handlers: Map<string, Set<EventHandler<any>>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isLeaving = false;
  private pullQueue: Promise<void> = Promise.resolve();
  private emittedMids: Set<string> = new Set();
  private leftParticipants: Set<string> = new Set();
  private pullRetryCount = 0;
  private pullResetCount = 0;
  private pullResetLastTime = 0;
  /** Epoch counter — incremented on every resetPullSession. Pull operations
   *  capture the epoch when they start and self-abort if it changes during
   *  their execution, preventing stale pulls from corrupting the new session. */
  private pullEpoch = 0;

  // ── Composed modules ─────────────────────────────────────────────
  private readonly vad: VoiceActivityDetector;
  private readonly audio: AudioPipeline;
  private readonly stats: ConnectionStatsMonitor;

  // ── GW readiness gates ─────────────────────────────────────────────
  private pcReadyPromise: Promise<void> = Promise.resolve();
  private pcReadyResolve: (() => void) | null = null;
  private voiceReadyPromise: Promise<void> = Promise.resolve();
  private voiceReadyResolve: (() => void) | null = null;

  // ── Queues for messages sent before identification ──────────────────
  private mainMsgQueue: ClientMessage[] = [];
  private voiceMsgQueue: ClientMessage[] = [];
  private isMainIdentified: boolean = false;
  private isVoiceIdentified: boolean = false;
  /** True after the first VoiceReady. Used to distinguish initial connect
   *  from mid-session reconnects — we only emit `voice-reconnected` on
   *  actual reconnects to avoid a redundant double-publish on first join. */
  private hasVoiceConnectedOnce: boolean = false;

  // ── Heartbeat managers ───────────────────────────────────────────────
  private readonly mainHB: HeartbeatManager;
  private readonly voiceHB: HeartbeatManager;
  private mainLastSeq: number = 0;
  private voiceLastSeq: number = 0;

  // ── Resume state ─────────────────────────────────────────────────────
  private sessionId: string | null = null;
  private lastSeqAck: number = -1;
  private connectName: string = "";
  private connectAvatarUrl?: string;
  private connectClerkUserId?: string;

  // -- Track subscription management --
  private unsubscribedTrackMids: Set<string> = new Set();
  private unsubscribedTrackNames: Set<string> = new Set();
  private trackRids: Map<string, string> = new Map();
  private lastPullPushHash: string = "";

  constructor(roomSlug: string) {
    this.roomSlug = roomSlug;

    this.negotiator = new TrackNegotiator({
      getParticipantId: () => this.participantId,
      sendWS: this.sendVoice.bind(this),
      emit: (event, ...args: any[]) => {
        (this as any).emit(event, ...args);
      },
      getUnsubscribedMids: () => this.unsubscribedTrackMids,
      getUnsubscribedNames: () => this.unsubscribedTrackNames,
      pcReadyPromise: () => this.pcReadyPromise,
      waitForPushNegotiationDone: this.waitForPushNegotiationDone.bind(this),
      waitForPushAnswer: this.waitForPushAnswer.bind(this),
    });

    // Wire up VAD module
    this.vad = new VoiceActivityDetector({
      onSpeakingChange: (isSpeaking, flags) => {
        if (this.participantId) {
          this.emit("vad-speaking", { participantId: this.participantId, isSpeaking });
          this.emit("speaking", { participantId: this.participantId, speaking: flags });
        }
      },
      sendSpeaking: (flags) => this.sendSpeaking(flags),
      getAudioTransceiver: () => {
        const name = `cam-audio-${this.participantId}`;
        return this.negotiator.getPushTransceiver(name);
      },
      getParticipantId: () => this.participantId,
    });

    // Wire up audio pipeline module
    this.audio = new AudioPipeline({
      onAudioResumed: () => this.emit("audio-resumed", {}),
    });

    // Wire up stats monitor module
    this.stats = new ConnectionStatsMonitor({
      getPushPC: () => this.negotiator.pushPC,
      getPullPC: () => this.negotiator.pullPC,
      getPulledTracks: () => this.negotiator.pulledTracks,
      getRoomSlug: () => this.roomSlug,
      getParticipantId: () => this.participantId,
      getConnectionState: () => this.getConnectionState(),
    });

    // Wire up heartbeat managers
    this.mainHB = new HeartbeatManager("MainGW", {
      sendBeat: () => {
        this.mainLastSeq++;
        this.sendMain({ op: VoiceOpcode.Heartbeat, d: { seq_ack: this.mainLastSeq } });
      },
      onZombie: () => this.mainWs?.close(),
    });
    this.voiceHB = new HeartbeatManager("VoiceGW", {
      sendBeat: () => {
        this.voiceLastSeq++;
        this.sendVoice({ op: VoiceOpcode.Heartbeat, d: { seq_ack: this.voiceLastSeq } });
      },
      onZombie: () => this.voiceWs?.close(),
    });
  }

  // ── Event system ───────────────────────────────────────────────────────

  on<K extends keyof SFUEventMap>(
    event: K,
    handler: EventHandler<SFUEventMap[K]>
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  private emit<K extends keyof SFUEventMap>(event: K, data: SFUEventMap[K]) {
    this.handlers.get(event)?.forEach((fn) => fn(data));
  }

  // ── Main Gateway Connection ────────────────────────────────────────────

  connect(name: string, avatarUrl?: string, clerkUserId?: string) {
    this.isLeaving = false;
    this.connectName = name;
    this.connectAvatarUrl = avatarUrl;
    this.connectClerkUserId = clerkUserId;
    this.isMainIdentified = false;
    this.isVoiceIdentified = false;
    this.mainMsgQueue = [];
    this.voiceMsgQueue = [];

    // Initialize readiness promises as pending
    this.pcReadyPromise = new Promise<void>((resolve) => {
      this.pcReadyResolve = resolve;
    });
    this.voiceReadyPromise = new Promise<void>((resolve) => {
      this.voiceReadyResolve = resolve;
    });

    const mainUrl = wsUrl(`/api/channels/${this.roomSlug}/ws?v=1`);

    this.mainWs = new WebSocket(mainUrl);

    this.mainWs.onopen = () => {
      console.log("[MainGW] WebSocket connected, waiting for Hello");
    };

    this.mainWs.onmessage = (event) => {
      const msg = JSON.parse(event.data) as ServerMessage;
      this.handleMainMessage(msg);
    };

    this.mainWs.onclose = () => {
      this.stopMainHeartbeat();
      this.disconnectVoice();
      if (!this.isLeaving) {
        this.emit("disconnected", undefined as never);
        this.scheduleReconnect();
      }
    };

    this.mainWs.onerror = () => {
      // onclose will fire after this
    };
  }

  // ── Voice Gateway Connection ───────────────────────────────────────────

  private connectVoice() {
    if (!this.participantId || !this.voiceToken) {
      console.error("[VoiceGW] Cannot connect: missing participantId or voiceToken");
      return;
    }

    const voiceUrl = wsUrl(`/api/channels/${this.roomSlug}/voice?v=1`);

    this.voiceWs = new WebSocket(voiceUrl);

    this.voiceWs.onopen = () => {
      console.log("[VoiceGW] WebSocket connected, waiting for Hello");
    };

    this.voiceWs.onmessage = (event) => {
      const msg = JSON.parse(event.data) as ServerMessage;
      this.handleVoiceMessage(msg);
    };

    this.voiceWs.onclose = () => {
      this.stopVoiceHeartbeat();
      this.isVoiceIdentified = false;
      if (!this.isLeaving) {
        console.warn("[VoiceGW] Voice connection lost — reconnecting voice");
        // Reset both push and pull session state in the negotiator
        if (this.negotiator.pushPC) { this.negotiator.pushPC.close(); this.negotiator.pushPC = null; }
        this.negotiator.resetPullSession();
        this.negotiator.resetPushSession();
        this.emittedMids.clear();
        this.lastPullPushHash = "";
        // Re-create voiceReadyPromise as pending so publish/pull waits for new VoiceReady
        this.voiceReadyPromise = new Promise<void>((resolve) => {
          this.voiceReadyResolve = resolve;
        });
        // Recreate peer connections for the new SFU sessions
        this.createPeerConnections();
        // Don't schedule full reconnect; just try to reconnect voice
        setTimeout(() => {
          if (!this.isLeaving && this.mainWs?.readyState === WebSocket.OPEN) {
            this.connectVoice();
          }
        }, 2000);
      }
    };

    this.voiceWs.onerror = () => {
      // onclose will fire after this
    };
  }

  private disconnectVoice() {
    this.stopVoiceHeartbeat();
    if (this.voiceWs) {
      try { this.voiceWs.close(); } catch { /* already closed */ }
      this.voiceWs = null;
    }
  }

  disconnect() {
    this.isLeaving = true;
    this.stopMainHeartbeat();
    this.stopVoiceHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.sendMain({ op: VoiceOpcode.ClientDisconnect, d: {} });
    this.sendVoice({ op: VoiceOpcode.ClientDisconnect, d: {} });

    this.negotiator.pushPC?.close();
    this.negotiator.pushPC = null;
    this.negotiator.pullPC?.close();
    this.negotiator.pullPC = null;

    this.stats.stopStatsMonitoring();
    this.stats.stopConnectionStatsMonitoring();
    this.mainWs?.close();
    this.mainWs = null;
    this.voiceWs?.close();
    this.voiceWs = null;
    this.participantId = null;
    this.voiceToken = null;
    this.sessionId = null;

    this.negotiator.resetPushSession();
    this.negotiator.resetPullSession();

    this.pendingPullTracks = [];
    this.pullQueue = Promise.resolve();
    this.emittedMids.clear();
    this.leftParticipants.clear();
    this.lastSeqAck = -1;
  }

  private scheduleReconnect() {
    if (this.isLeaving) return;
    this.reconnectTimer = setTimeout(() => {
      console.log("[MainGW] Attempting reconnect...");
      this.stopMainHeartbeat();
      this.stopVoiceHeartbeat();
      this.disconnectVoice();
      this.negotiator.pushPC?.close();
      this.negotiator.pushPC = null;
      this.negotiator.pullPC?.close();
      this.negotiator.pullPC = null;
      this.negotiator.resetPushSession();
      this.negotiator.resetPullSession();
      this.connect(this.connectName, this.connectAvatarUrl, this.connectClerkUserId);
    }, 2000);
  }

  // ── Heartbeat — delegated to HeartbeatManager ─────────────────────────────

  private startMainHeartbeat(interval: number) { this.mainHB.start(interval); }
  private stopMainHeartbeat() { this.mainHB.stop(); }
  private startVoiceHeartbeat(interval: number) { this.voiceHB.start(interval); }
  private stopVoiceHeartbeat() { this.voiceHB.stop(); }

  // ── Main GW Message Handler ────────────────────────────────────────────

  private handleMainMessage(msg: ServerMessage) {
    switch (msg.op) {
      // Op 8: Hello — start heartbeat, send Identify or Resume
      case VoiceOpcode.Hello: {
        const hello = msg.d as HelloPayload;
        console.log(`[MainGW] Hello received, interval=${hello.heartbeat_interval}ms`);
        this.startMainHeartbeat(hello.heartbeat_interval);

        if (this.sessionId && this.participantId) {
          console.log(`[MainGW] Attempting resume for session ${this.participantId}`);
          this.sendMain({
            op: VoiceOpcode.Resume,
            d: { session_id: this.participantId, seq_ack: this.lastSeqAck },
          });
        } else {
          this.sendMain({
            op: VoiceOpcode.Identify,
            d: {
              name: this.connectName,
              avatar_url: this.connectAvatarUrl,
              clerk_user_id: this.connectClerkUserId,
            },
          });
        }
        break;
      }

      // Op 2: Ready — confirmed identification, connect to Voice Gateway
      case VoiceOpcode.Ready: {
        const ready = msg.d as ReadyPayload;
        this.participantId = ready.participant_id;
        this.sessionId = ready.participant_id;
        this.iceServers = ready.ice_servers;
        this.voiceToken = ready.voice_token;
        this.createPeerConnections();

        // Mark as identified and flush queue
        this.isMainIdentified = true;
        console.log(`[MainGW] Identified, flushing ${this.mainMsgQueue.length} queued messages`);
        const queued = [...this.mainMsgQueue];
        this.mainMsgQueue = [];
        for (const m of queued) {
          this.sendMain(m);
        }

        // Resolve PC readiness
        if (this.pcReadyResolve) {
          this.pcReadyResolve();
          this.pcReadyResolve = null;
        }

        this.emit("joined", {
          participantId: ready.participant_id,
          iceServers: ready.ice_servers,
          participants: ready.participants,
        });

        ready.participants.forEach(p => {
          if (p.clerk_user_id) this.stats.setClerkMapping(p.id, p.clerk_user_id);
        });
        // Queue existing tracks for pulling (once voice WS is ready)
        for (const p of ready.participants) {
          for (const t of p.tracks) {
            this.pendingPullTracks.push(t);
          }
        }
        // Connect to Voice Gateway
        this.connectVoice();
        break;
      }

      // Op 9: Resumed
      case VoiceOpcode.Resumed:
        console.log("[MainGW] Session resumed successfully");
        // Reconnect voice if lost
        if (!this.voiceWs || this.voiceWs.readyState !== WebSocket.OPEN) {
          this.connectVoice();
        }
        break;

      // Op 6: HeartbeatACK
      case VoiceOpcode.HeartbeatACK: {
        const ack = msg.d as HeartbeatACKPayload;
        this.mainHB.onAck();
        this.mainLastSeq = ack.seq;
        this.lastSeqAck = ack.seq;
        break;
      }

      // Op 15: VoiceStateUpdate — participant join/leave
      case VoiceOpcode.VoiceStateUpdate: {
        const vsu = msg.d as VoiceStateUpdatePayload;
        this.emit("voice-state-update", {
          participant: vsu.participant,
          action: vsu.action,
        });

        if (vsu.action === "join" || vsu.action === "update") {
          if (vsu.participant.clerk_user_id) this.stats.setClerkMapping(vsu.participant.id, vsu.participant.clerk_user_id);
          if (vsu.action === "join") {
            this.emit("participant-joined", { participant: vsu.participant });
          }
        } else if (vsu.action === "leave") {
          this.stats.deleteClerkMapping(vsu.participant.id);
          this.leftParticipants.add(vsu.participant.id);
          this.audio.removeParticipantVolume(vsu.participant.id);
          this.negotiator.pulledTracks = this.negotiator.pulledTracks.filter(
            (t) => t.participant_id !== vsu.participant.id
          );
          this.emit("participant-left", { participantId: vsu.participant.id });
        }
        break;
      }

      // Op 5: Speaking — remote participant speaking state
      case VoiceOpcode.Speaking: {
        const speak = msg.d as SpeakingPayloadServer;
        this.emit("speaking", {
          participantId: speak.participant_id,
          speaking: speak.speaking,
        });
        break;
      }

      // Op 16: ProfileUpdate
      case VoiceOpcode.ProfileUpdate: {
        const pu = msg.d as ProfileUpdatePayload;
        this.emit("profile-update", {
          participantId: pu.participant_id,
          name: pu.name,
          avatarUrl: pu.avatar_url,
        });
        break;
      }

      // Op 18: Error
      case VoiceOpcode.Error: {
        const err = msg.d as ErrorPayload;
        console.error(`[MainGW] Error (code=${err.code}):`, err.message);
        this.emit("error", { message: err.message });
        break;
      }
    }
  }

  // ── Voice GW Message Handler ───────────────────────────────────────────

  private handleVoiceMessage(msg: ServerMessage) {
    switch (msg.op) {
      // Op 8: Hello on voice — start voice heartbeat + authenticate
      case VoiceOpcode.Hello: {
        const hello = msg.d as HelloPayload;
        console.log(`[VoiceGW] Hello received, interval=${hello.heartbeat_interval}ms`);
        this.startVoiceHeartbeat(hello.heartbeat_interval);

        // Authenticate on voice gateway
        this.sendVoice({
          op: VoiceOpcode.VoiceIdentify,
          d: {
            participant_id: this.participantId!,
            voice_token: this.voiceToken!,
          },
        });
        break;
      }

      // Op 101: VoiceReady — authenticated on voice gateway
      case VoiceOpcode.VoiceReady: {
        const vr = msg.d as VoiceReadyPayload;

        // Unblock any media operations waiting for voice GW
        this.isVoiceIdentified = true;
        console.log(`[VoiceGW] Identified, flushing ${this.voiceMsgQueue.length} queued messages`);
        const queued = [...this.voiceMsgQueue];
        this.voiceMsgQueue = [];
        for (const m of queued) {
          this.sendVoice(m);
        }

        if (this.voiceReadyResolve) {
          this.voiceReadyResolve();
          this.voiceReadyResolve = null;
        }

        // Handle initial speaking states
        if (vr.speaking) {
          Object.entries(vr.speaking).forEach(([pId, speaking]) => {
            this.emit("speaking", { participantId: pId, speaking });
          });
        }

        // Queue any existing tracks from other voice participants
        // De-duplicate by track_name to prevent double-pulls from Ready + VoiceReady race
        const voiceTracks = vr.tracks ?? [];
        if (voiceTracks.length > 0) {
          console.log(`[VoiceGW] VoiceReady includes ${voiceTracks.length} existing remote tracks`);
          const existingNames = new Set(this.pendingPullTracks.map(t => t.track_name));
          for (const track of voiceTracks) {
            if (!existingNames.has(track.track_name)) {
              this.pendingPullTracks.push(track);
              existingNames.add(track.track_name);
            }
          }
        }

        // Now pull any pending tracks
        if (this.pendingPullTracks.length > 0) {
          const toPull = this.pendingPullTracks.splice(0);
          console.log(`[VoiceGW] Pulling ${toPull.length} pending tracks`);
          this.pullTracks(toPull);
        }

        // Emit voice-reconnected so hooks can re-publish their local tracks.
        // Only fire on ACTUAL reconnects — not the initial VoiceReady.
        // On first connect, the original publishTracks call is already queued
        // in voiceMsgQueue and was just flushed above. Re-publishing would
        // cause a redundant SDP renegotiation that makes the track temporarily
        // unavailable on the SFU (empty_track_error for receivers).
        if (this.hasVoiceConnectedOnce) {
          this.emit("voice-reconnected", undefined as never);
        }
        this.hasVoiceConnectedOnce = true;
        break;
      }

      // Op 6: HeartbeatACK (voice)
      case VoiceOpcode.HeartbeatACK: {
        const ack = msg.d as HeartbeatACKPayload;
        this.voiceHB.onAck();
        this.voiceLastSeq = ack.seq;
        break;
      }

      // Op 4: SessionDescription — SDP answer (push) or offer (pull)
      case VoiceOpcode.SessionDescription: {
        const sd = msg.d as SessionDescriptionPayload;
        this.handleSessionDescription(sd).catch((err) => {
          console.error("[VoiceGW] handleSessionDescription error:", err);
          this.emit("error", { message: `SDP handling error: ${err}` });
        });
        break;
      }

      // Op 12: Video — tracks published by someone else
      case VoiceOpcode.Video: {
        const video = msg.d as VideoPayloadServer;
        this.emit("tracks-published", {
          participantId: video.participant_id,
          tracks: video.tracks,
        });

        this.pullTracks(video.tracks);
        break;
      }

      // Op 13: StopTracks — tracks removed by someone
      case VoiceOpcode.StopTracks: {
        const stop = msg.d as StopTracksPayloadServer;
        console.log(`[VoiceGW] Tracks stopped by ${stop.participant_id}:`, stop.track_names, "session:", stop.session_id);

        // Cleanup volume nodes if audio tracks stopped
        if (stop.track_names.some(n => n.includes("-audio-"))) {
          this.audio.removeParticipantVolume(stop.participant_id);
        }

        const stoppedNames = new Set(stop.track_names);
        let actuallyStopped = false;

        // Only remove tracks if they match both name AND the original push session id (if provided).
        // This prevents a delayed StopTracks from a previous stream from killing a newly published stream.
        const removedMids = new Set<string>();

        this.negotiator.pulledTracks = this.negotiator.pulledTracks.filter((pt) => {
          if (!stoppedNames.has(pt.track_name)) return true;

          if (stop.session_id && pt.session_id && pt.session_id !== stop.session_id) {
            console.warn(`[VoiceGW] Ignoring stale StopTracks for ${pt.track_name} (track is from session_id=${pt.session_id}, but StopTracks is for ${stop.session_id})`);
            return true; // Keep the track!
          }

          if (pt.mid) {
            this.emittedMids.delete(pt.mid);
            removedMids.add(pt.mid);
          }
          actuallyStopped = true;
          return false; // Remove the track
        });

        if (actuallyStopped) {
          // Clear pull dedup hash so re-pulls for the same track names
          // (from a re-publish / quality change) aren't suppressed.
          this.lastPullPushHash = "";

          this.emit("tracks-stopped", {
            participantId: stop.participant_id,
            trackNames: stop.track_names,
          });
        }
        break;
      }

      // Op 5: Speaking (voice GW also receives speaking broadcasts)
      case VoiceOpcode.Speaking: {
        const speak = msg.d as SpeakingPayloadServer;
        this.emit("speaking", {
          participantId: speak.participant_id,
          speaking: speak.speaking,
        });
        break;
      }

      case VoiceOpcode.NegotiationDone: {
        console.log(`[VoiceGW] NegotiationDone received`);
        if (this.pushNegotiationResolve) {
          const resolve = this.pushNegotiationResolve;
          this.pushNegotiationResolve = null;
          resolve();

          // Push transceiver is now fully negotiated — tell the VAD to apply
          // the noise gate if we're in a silent state. This eliminates the race
          // where enableNoiseGate() fired before the transceiver existed.
          this.vad.onTransceiverReady();
        }
        if (this.pullNegotiationResolve) {
          const resolve = this.pullNegotiationResolve;
          this.pullNegotiationResolve = null;
          if (resolve) resolve();
        }
        break;
      }

      // Op 18: Error
      case VoiceOpcode.Error: {
        const err = msg.d as ErrorPayload;
        console.error(`[VoiceGW] Error (code=${err.code}):`, err.message);
        // Handle pull-retry
        if (err.message.startsWith("pull-retry:")) {
          const trackNamesJson = err.message.slice("pull-retry:".length);
          try {
            const failedTrackNames = JSON.parse(trackNamesJson) as string[];
            const tracksToRetry: TrackInfo[] = [];
            for (const name of failedTrackNames) {
              const info = this.negotiator.pulledTracks.find((t) => t.track_name === name);
              if (info) {
                tracksToRetry.push({ ...info });
                this.negotiator.pulledTracks = this.negotiator.pulledTracks.filter((t) => t.track_name !== name);
              }
            }
            if (this.pullResolver) {
              const reject = this.pullRejector;
              this.pullResolver = null;
              this.pullRejector = null;
              if (reject) reject(new Error("SFU asked to retry pull"));
            }
            if (tracksToRetry.length > 0) {
              // Exponential backoff with max retries
              const retryCount = (this.pullRetryCount ?? 0) + 1;
              this.pullRetryCount = retryCount;
              const MAX_PULL_RETRIES = 5;
              if (retryCount > MAX_PULL_RETRIES) {
                console.error(`[VoiceGW] Pull retry exhausted after ${MAX_PULL_RETRIES} attempts, giving up on: ${failedTrackNames.join(", ")}`);
                this.pullRetryCount = 0;
                return;
              }
              const delay = Math.min(2000 * Math.pow(1.5, retryCount - 1), 10000);
              console.log(`[VoiceGW] Pull retry ${retryCount}/${MAX_PULL_RETRIES} for ${tracksToRetry.length} tracks in ${Math.round(delay)}ms`);
              // Schedule the retry through the pull queue so it serializes
              // with any other in-flight pull operations (fixes concurrency bug
              // where retries via raw setTimeout raced with new Video pulls).
              this.schedulePullRetry(tracksToRetry, delay);
            }
          } catch {
            this.emit("error", { message: err.message });
          }
        } else if (
          err.message.includes("Session is not ready") ||
          err.message.includes("session_error") ||
          err.message.includes("(425)") ||
          err.message.includes("(410)")
        ) {
          // SFU session-level error: the entire pull session is dead.
          // Trigger a full pull PC + session reset so we create a fresh
          // session and re-pull all tracks.
          console.warn("[VoiceGW] Stale pull session detected — resetting pull session");
          this.resetPullSession();
        } else if (err.message.includes("invalid_session_description") || err.message.includes("(406)")) {
          // 406 = signaling state is expecting a remote answer.
          // This means a previous pull's SDP negotiation is still in-flight.
          // Reject the current pull waiter so the queue can drain, then
          // the next queued pull will retry cleanly.
          console.warn("[VoiceGW] Signaling state conflict (406) — rejecting current pull waiter");
          if (this.pullResolver) {
            const reject = this.pullRejector;
            this.pullResolver = null;
            this.pullRejector = null;
            if (reject) reject(new Error("Signaling state conflict"));
          }
        } else {
          this.emit("error", { message: err.message });
        }
        break;
      }
    }
  }

  // ── Peer Connections ──────────────────────────────────────────────────

  private createPeerConnections() {
    if (this.negotiator.pushPC) this.negotiator.pushPC.close();
    if (this.negotiator.pullPC) this.negotiator.pullPC.close();

    const config: RTCConfiguration = {
      iceServers: this.iceServers.map((s) => ({
        urls: s.urls,
        username: s.username,
        credential: s.credential,
      })),
      bundlePolicy: "max-bundle",
    };

    // Push PC: client offers, SFU answers
    this.negotiator.pushPC = new RTCPeerConnection(config);
    this.stats.startConnectionStatsMonitoring();
    this.negotiator.pushPC.onconnectionstatechange = () => {
      const state = this.negotiator.pushPC?.connectionState ?? "closed";
      console.log(`[VoiceGW:push] connectionState: ${state}`);
      this.emit("connection-state", { state });
    };
    this.negotiator.pushPC.oniceconnectionstatechange = () => {
      console.log(`[VoiceGW:push] iceConnectionState: ${this.negotiator.pushPC?.iceConnectionState}`);
      if (this.negotiator.pushPC?.iceConnectionState === "failed") {
        console.error("[VoiceGW:push] ICE connection failed — restarting ICE");
        this.negotiator.pushPC.restartIce();
      }
    };
    this.negotiator.pushPC.onsignalingstatechange = () => {
      console.log(`[VoiceGW:push] signalingState: ${this.negotiator.pushPC?.signalingState}`);
    };

    // Pull PC: SFU offers, client answers. ontrack fires here.
    this.negotiator.pullPC = new RTCPeerConnection(config);
    this.configurePullPC();
  }

  /** Centralized configuration for the pull PeerConnection */
  private configurePullPC() {
    if (!this.negotiator.pullPC) return;

    this.negotiator.pullPC.ontrack = this.createPullOnTrack();
    this.negotiator.pullPC.onconnectionstatechange = () => {
      console.log(`[VoiceGW:pull] connectionState: ${this.negotiator.pullPC?.connectionState}`);
    };
    this.negotiator.pullPC.oniceconnectionstatechange = () => {
      console.log(`[VoiceGW:pull] iceConnectionState: ${this.negotiator.pullPC?.iceConnectionState}`);
      if (this.negotiator.pullPC?.iceConnectionState === "failed") {
        console.error("[VoiceGW:pull] ICE connection failed — resetting pull session");
        this.resetPullSession();
      }
    };
    this.negotiator.pullPC.onsignalingstatechange = () => {
      console.log(`[VoiceGW:pull] signalingState: ${this.negotiator.pullPC?.signalingState}`);
    };
  }

  /** Factory: creates the ontrack handler for the pull PeerConnection */
  private createPullOnTrack(): (event: RTCTrackEvent) => void {
    return (event: RTCTrackEvent) => {
      const track = event.track;
      const mid = event.transceiver.mid;
      console.log(`[VoiceGW:pull] ontrack fired: kind=${track.kind}, mid=${mid}, readyState=${track.readyState}`);

      const trackInfo = this.findTrackByMid(mid);

      // If we already have this track NAME and MID, but the track OBJECT is different,
      // replace it and re-emit.
      if (trackInfo && mid && this.emittedMids.has(mid)) {
        console.log(`[VoiceGW:pull] ontrack for existing mid=${mid}, trackName=${trackInfo?.track_name}. Updating track object.`);
        trackInfo.track = track;
        this.emit("remote-track", {
          participantId: trackInfo.participant_id,
          track,
          trackInfo,
        });
        return;
      }

      if (mid && this.emittedMids.has(mid)) {
        console.log(`[VoiceGW:pull] Skipping duplicate ontrack for mid=${mid}`);
        return;
      }

      if (trackInfo) {
        if (this.leftParticipants.has(trackInfo.participant_id)) {
          console.log(`[VoiceGW:pull] Skipping track for left participant ${trackInfo.participant_id}`);
          return;
        }
        if (mid) this.emittedMids.add(mid);
        console.log(`[VoiceGW:pull] Matched track to participant ${trackInfo.participant_id}, name=${trackInfo.track_name}`);
        this.emit("remote-track", {
          participantId: trackInfo.participant_id,
          track,
          trackInfo,
        });
      } else {
        console.warn(`[VoiceGW:pull] Ignoring track with unknown mid=${mid} (likely stale)`);
      }
    };
  }

  /**
   * Schedule a pull retry through the pullQueue so it serializes with
   * other pull operations. The delay is spent *before* entering the queue,
   * but the actual pullTracks call goes through the queue. Captures the
   * current pullEpoch so stale retries from a previous session self-abort.
   */
  private schedulePullRetry(tracks: TrackInfo[], delayMs: number) {
    const epoch = this.pullEpoch;
    setTimeout(() => {
      if (this.pullEpoch !== epoch) {
        console.log(`[VoiceGW:pull] Retry aborted — pull epoch changed (${epoch} → ${this.pullEpoch})`);
        this.pullRetryCount = 0;
        return;
      }
      // Don't retry tracks from participants who left
      const stillValid = tracks.filter(
        (t) => !this.leftParticipants.has(t.participant_id)
      );
      if (stillValid.length > 0) {
        this.pullTracks(stillValid);
      } else {
        this.pullRetryCount = 0;
      }
    }, delayMs);
  }

  /**
   * Reset the pull PeerConnection and SFU session after ICE failure.
   * Cloudflare Calls SFU does not support ICE restart on existing sessions,
   * so we must tear down the old pull PC/session and create fresh ones,
   * then re-pull all tracks from active remote participants.
   */
  private resetPullSession() {
    // Circuit breaker: max 3 resets per 30s window to prevent infinite loops
    const now = Date.now();
    if (now - this.pullResetLastTime > 30_000) {
      this.pullResetCount = 0;
    }
    this.pullResetCount++;
    this.pullResetLastTime = now;
    if (this.pullResetCount > 3) {
      console.error("[VoiceGW:pull] Too many pull resets (3 in 30s), giving up");
      return;
    }
    console.log(`[VoiceGW:pull] Resetting pull session and PeerConnection (attempt ${this.pullResetCount}/3)`);

    // Bump epoch — all in-flight pull operations from the old session
    // will see the epoch mismatch and self-abort.
    this.pullEpoch++;

    // Cancel any dangling pull waiters so their promises reject immediately
    // instead of timing out 10s later and stomping on the new session.
    if (this.pullResolver) {
      const reject = this.pullRejector;
      this.pullResolver = null;
      this.pullRejector = null;
      if (reject) reject(new Error("Pull session reset"));
    }
    if (this.pullNegotiationResolve) {
      this.pullNegotiationResolve = null;
    }

    // Save tracks we need to re-pull before clearing state
    const tracksToPull = this.negotiator.pulledTracks.map((t) => ({
      participant_id: t.participant_id,
      track_name: t.track_name,
      session_id: t.session_id,
      kind: t.kind,
    })).filter((t) => !this.leftParticipants.has(t.participant_id));

    this.negotiator.resetPullSession();

    // Clear stale pull state
    this.emittedMids.clear();
    this.lastPullPushHash = "";
    this.pullRetryCount = 0;

    // Reset the pull queue so stale operations are dropped
    this.pullQueue = Promise.resolve();

    // Recreate pull PC (uses existing iceServers config)
    if (this.iceServers.length > 0) {
      const config: RTCConfiguration = {
        iceServers: this.iceServers.map((s) => ({
          urls: s.urls,
          username: s.username,
          credential: s.credential,
        })),
        bundlePolicy: "max-bundle",
      };
      this.negotiator.pullPC = new RTCPeerConnection(config);
      this.configurePullPC();
    }

    // Re-pull tracks through the queue after a short delay.
    // Uses schedulePullRetry which checks the epoch, so if another reset
    // happens in the meantime, this re-pull will self-abort.
    if (tracksToPull.length > 0) {
      console.log(`[VoiceGW:pull] Re-pulling ${tracksToPull.length} tracks after session reset`);
      this.schedulePullRetry(tracksToPull as TrackInfo[], 500);
    }
  }

  private findTrackByMid(mid: string | null): TrackInfo | undefined {
    if (!mid) return undefined;
    return this.negotiator.pulledTracks.find((t) => t.mid === mid);
  }

  // ── Publish local media (via Voice GW) ─────────────────────────────────

  async publishTracks(stream: MediaStream, prefix: string) {
    await this.negotiator.publishTracks(stream, prefix);
  }

  // ── Unpublish single track ──────────────────────────────────────────────

  unpublishTrack(trackName: string) {
    this.negotiator.unpublishTrack(trackName);
  }

  /**
   * Replace the track on an existing transceiver (seamlessly swap mic/camera)
   */
  async replaceTrack(trackName: string, newTrack: MediaStreamTrack) {
    console.log(`[VoiceGW] Replacing track on transceiver: ${trackName}`);
    if (!this.negotiator.pushPC) return;

    const transceiver = this.negotiator.getPushTransceiver(trackName);
    if (transceiver) {
      await transceiver.sender.replaceTrack(newTrack);
    } else {
      console.warn(`[VoiceGW] Cannot replace track: ${trackName} not found`);
    }
  }

  // ── Speaking state (Op 5) — goes to Voice GW (VAD only) ─────────────

  sendSpeaking(speaking: number) {
    this.sendVoice({
      op: VoiceOpcode.Speaking,
      d: { speaking },
    });
  }

  // ── Mute/camera state — goes to Main GW via VoiceStateUpdate ──────────

  sendMuteUpdate(isMicOn: boolean, isCameraOn: boolean) {
    this.sendMain({
      op: VoiceOpcode.VoiceStateUpdate,
      d: {
        self_mute: !isMicOn,
        self_video: isCameraOn,
      },
    });
  }

  /** Send full voice state update — direct field mapping, no inversions */
  sendVoiceState(state: {
    self_mute?: boolean;
    self_deaf?: boolean;
    self_video?: boolean;
    self_stream?: boolean;
    self_stream_audio?: boolean;
  }) {
    this.sendMain({
      op: VoiceOpcode.VoiceStateUpdate,
      d: state,
    });
  }


  sendProfileRefresh() {
    this.sendMain({ op: VoiceOpcode.ProfileRefresh, d: {} });
  }

  // ── Stop published tracks (via Voice GW) ───────────────────────────────

  stopTracks(trackNames: string[]) {
    console.log(`[VoiceGW] Stopping tracks:`, trackNames);

    // Tear down transceivers locally without sending individual StopTracks per track.
    // We send a single batched StopTracks below instead.
    for (const name of trackNames) {
      this.negotiator.teardownTransceiver(name);
    }

    this.sendVoice({
      op: VoiceOpcode.StopTracks,
      d: { track_names: trackNames },
    });
  }

  // ── Pull remote tracks (via Voice GW) ──────────────────────────────────

  async pullTracks(tracks: TrackInfo[]) {
    this.pullQueue = this.pullQueue.then(async () => {
      // Capture epoch at the start — if it changes mid-flight, another
      // resetPullSession has fired and this operation is stale.
      const epoch = this.pullEpoch;

      if (!this.negotiator.pullPC) {
        console.log("[VoiceGW:pull] pullTracks: no PC, queueing", tracks.length, "tracks");
        this.pendingPullTracks.push(...tracks);
        return;
      }

      // Wait for voiceWs to be ready
      if (!this.voiceWs || this.voiceWs.readyState !== WebSocket.OPEN) {
        console.log("[VoiceGW:pull] pullTracks: voice WS not ready, queueing", tracks.length, "tracks");
        this.pendingPullTracks.push(...tracks);
        return;
      }

      // Guard: don't start a new pull if the pull PC's signaling state
      // isn't stable — a previous pull's SDP exchange is still in progress.
      // This prevents the 406 "expecting a remote answer" error.
      if (this.negotiator.pullPC.signalingState !== "stable") {
        console.warn(`[VoiceGW:pull] pullTracks: signaling state is '${this.negotiator.pullPC.signalingState}', deferring ${tracks.length} tracks`);
        this.pendingPullTracks.push(...tracks);
        return;
      }

      // Add pending tracks from queue
      const allTracks = [...this.pendingPullTracks, ...tracks];
      this.pendingPullTracks = [];

      // Filter out tracks we already have in pulledTracks
      const newTracks = allTracks.filter(
        (nt) => !this.negotiator.pulledTracks.some((pt) => pt.track_name === nt.track_name)
      );

      // Add to tracked pulledTracks
      this.negotiator.pulledTracks.push(...newTracks);

      if (this.negotiator.pulledTracks.length === 0) {
        console.log("[VoiceGW:pull] pullTracks: no tracks to pull");
        return;
      }

      // Generate the payload — include rid for the server to forward to SFU.
      // Screen-video tracks default to "h" (high) since text/detail is unreadable
      // at lower quality. This handles the timing gap where pullTracks fires
      // before the React subscription effect calls setRemoteTrackSubscription.
      const pullTracksPayload = this.negotiator.pulledTracks.map(t => {
        const explicitRid = t.rid || this.trackRids.get(t.track_name);
        const defaultRid = t.track_name.startsWith("screen-video-") ? "h" : undefined;
        return {
          participant_id: t.participant_id,
          track_name: t.track_name,
          session_id: t.session_id,
          kind: t.kind,
          rid: explicitRid || defaultRid,
        };
      });

      // Dedup: compute hash WITHOUT rid — rid changes are handled
      // via TrackUpdate (Op 103) instead of full re-pull.
      const dedupPayload = this.negotiator.pulledTracks.map(t => ({
        participant_id: t.participant_id,
        track_name: t.track_name,
        session_id: t.session_id,
        kind: t.kind,
      }));
      const payloadHash = JSON.stringify(dedupPayload);
      if (this.lastPullPushHash === payloadHash && newTracks.length === 0) {
        return;
      }
      this.lastPullPushHash = payloadHash;

      this.stats.startStatsMonitoring();

      console.log(`[VoiceGW:pull] Requesting SFU tracks: ${this.negotiator.pulledTracks.map(t => t.track_name).join(", ")}`);

      const negotiationDonePromise = this.waitForPullNegotiationDone(10000);
      const offerPromise = this.waitForPullOffer(10000);

      // Stop unhandled rejections if one fails early
      negotiationDonePromise.catch(() => { });
      offerPromise.catch(() => { });

      this.sendVoice({
        op: VoiceOpcode.SelectProtocol,
        d: {
          push_tracks: [],
          pull_tracks: pullTracksPayload,
        },
      });

      await offerPromise;

      // Check epoch after the async SDP offer — if the session was reset
      // while we were waiting, abort to avoid corrupting the new session.
      if (this.pullEpoch !== epoch) {
        console.log(`[VoiceGW:pull] Pull aborted after offer — epoch changed (${epoch} → ${this.pullEpoch})`);
        return;
      }

      await negotiationDonePromise;
    }).catch((err) => {
      console.error("[VoiceGW:pull] pullTracks error:", err);
    });
  }

  // ── SessionDescription handling (Op 4) ─────────────────────────────────

  private pushResolver: (() => void) | null = null;
  private pullResolver: (() => void) | null = null;
  private pushNegotiationResolve: (() => void) | null = null;
  private pullNegotiationResolve: (() => void) | null = null;
  private pullRejector: ((reason?: any) => void) | null = null;

  async handleSessionDescription(sd: SessionDescriptionPayload) {
    if (sd.sdp_type === "offer") {
      await this.negotiator.handleSessionDescription(sd, 'pull');
      if (this.pullResolver) {
        const resolve = this.pullResolver;
        this.pullResolver = null;
        this.pullRetryCount = 0;
        this.pullResetCount = 0;
        resolve();
      }
    } else {
      await this.negotiator.handleSessionDescription(sd, 'push');
      if (this.pushResolver) {
        const resolve = this.pushResolver;
        this.pushResolver = null;
        resolve();
      }
    }
  }

  // ── SDP Wait Helpers ────────────────────────────────────────────────

  private waitForSignal(
    setter: (resolve: () => void, reject?: (reason?: any) => void) => void,
    timeoutMs: number,
    label: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let isDone = false;

      const wrappedResolve = () => {
        if (!isDone) { isDone = true; resolve(); }
      };
      const wrappedReject = (reason: any) => {
        if (!isDone) { isDone = true; reject(reason); }
      };

      setter(wrappedResolve, wrappedReject);

      setTimeout(() => {
        if (!isDone) {
          console.warn(`[SFU] ${label} timed out after ${timeoutMs}ms`);
          this.emit("error", { message: `${label} timed out` });
          wrappedReject(new Error(`${label} timed out`));
        }
      }, timeoutMs);
    });
  }

  private waitForPushAnswer(timeoutMs = 10000) {
    return this.waitForSignal((res) => { this.pushResolver = res; }, timeoutMs, "Push SDP Answer");
  }

  private waitForPullOffer(timeoutMs = 10000) {
    return this.waitForSignal((res, rej) => {
      this.pullResolver = res;
      this.pullRejector = rej || null;
    }, timeoutMs, "Pull SDP Offer");
  }

  async waitForPushNegotiationDone(timeoutMs = 10000) {
    return this.waitForSignal((res) => { this.pushNegotiationResolve = res; }, timeoutMs, "Push Negotiation Done");
  }

  async waitForPullNegotiationDone(timeoutMs = 10000) {
    return this.waitForSignal((res) => { this.pullNegotiationResolve = res; }, timeoutMs, "Pull Negotiation Done");
  }

  // ── Stereo codec — delegated to stereo-codec.ts ────────────────────────

  createTrueStereoStream(rawStream: MediaStream): MediaStream { return _createTrueStereoStream(rawStream); }

  // ── Send Helpers ──────────────────────────────────────────────────────

  private sendMain(msg: ClientMessage) {
    if (this.mainWs?.readyState === WebSocket.OPEN && (this.isMainIdentified || msg.op === VoiceOpcode.Identify || msg.op === VoiceOpcode.Resume || msg.op === VoiceOpcode.Heartbeat)) {
      this.mainWs.send(JSON.stringify(msg));
    } else {
      console.log(`[MainGW] Not ready (state=${this.mainWs?.readyState}, identified=${this.isMainIdentified}), queueing message op=${msg.op}`);
      this.mainMsgQueue.push(msg);
    }
  }

  private sendVoice(msg: ClientMessage) {
    if (this.voiceWs?.readyState === WebSocket.OPEN && (this.isVoiceIdentified || msg.op === VoiceOpcode.VoiceIdentify || msg.op === VoiceOpcode.Heartbeat)) {
      this.voiceWs.send(JSON.stringify(msg));
    } else {
      console.log(`[VoiceGW] Not ready (state=${this.voiceWs?.readyState}, identified=${this.isVoiceIdentified}), queueing message op=${msg.op}`);
      this.voiceMsgQueue.push(msg);
    }
  }

  getParticipantId(): string | null {
    return this.participantId;
  }

  getConnectionState(): string {
    const pushState = this.negotiator.pushPC?.connectionState ?? "new";
    const pullState = this.negotiator.pullPC?.connectionState ?? "new";
    if (pushState === "connected" || pullState === "connected") return "connected";
    if (pushState === "connecting" || pullState === "connecting") return "connecting";
    return pushState;
  }

  /**
   * Enables or disables a remote track's bandwidth usage.
   * If disabled, the transceiver direction is set to 'inactive'.
   */
  setRemoteTrackSubscription(participantId: string, trackName: string, active: boolean, rid?: string) {
    const activeTrack = this.negotiator.pulledTracks.find(t => t.participant_id === participantId && t.track_name === trackName);

    // Always update persistent state
    if (active) {
      this.unsubscribedTrackNames.delete(trackName);
      if (rid) this.trackRids.set(trackName, rid);
      else this.trackRids.delete(trackName);

      if (activeTrack) activeTrack.rid = rid;
    } else {
      this.unsubscribedTrackNames.add(trackName);
    }

    if (!activeTrack || !activeTrack.mid) {
      // If activeTrack is not found or doesn't have a mid yet,
      // the change will be applied during the next handleSessionDescription (renegotiation).
      // console.log(`[SFU:pull] Subscription change for ${trackName} will be applied on next renegotiation (mid not available yet).`);
      return;
    }

    // If mid is available, also update unsubscribedTrackMids for immediate effect
    if (active) {
      this.unsubscribedTrackMids.delete(activeTrack.mid);
    } else {
      this.unsubscribedTrackMids.add(activeTrack.mid);
    }

    // Apply immediately to current PC if available
    const tr = this.negotiator.pullPC?.getTransceivers().find(t => t.mid === activeTrack.mid);
    if (tr) {
      const newDir = active ? "recvonly" : "inactive";
      if (tr.direction !== newDir) {
        console.log(`[SFU:pull] Updating transceiver direction for ${trackName} to ${newDir}`);
        tr.direction = newDir;
      }
    }

    // If rid changed on an active track, send TrackUpdate (Op 103)
    // to the server so it can call tracks/update on the SFU — no re-negotiation needed.
    if (active && rid && activeTrack.session_id && activeTrack.mid) {
      this.sendVoice({
        op: VoiceOpcode.TrackUpdate,
        d: {
          tracks: [{
            track_name: trackName,
            session_id: activeTrack.session_id,
            mid: activeTrack.mid,
            rid,
          }],
        },
      });
    }
  }

  // ── Voice Activity Detection (VAD) — delegated to VoiceActivityDetector ────

  startVAD(stream: MediaStream) { this.vad.start(stream); }
  stopVAD() { this.vad.stop(); }
  setVADThreshold(threshold: number) { this.vad.setThreshold(threshold); }
  enableNoiseGate() { this.vad.enableNoiseGate(); }
  disableNoiseGate() { this.vad.disableNoiseGate(); }

  // ── Audio Pipeline — delegated to AudioPipeline ───────────────────────────

  public async resumeAudioContext() {
    // Resume both the audio pipeline's context AND the VAD's context
    // so the VAD can detect speech after a user gesture.
    this.vad.resumeContext();
    return this.audio.resumeAudioContext();
  }
  public isAudioSuspended() { return this.audio.isAudioSuspended(); }
  setParticipantVolume(participantId: string, level: number) { this.audio.setParticipantVolume(participantId, level); }
  setTrackVolume(participantId: string, trackName: string, level: number) { this.audio.setTrackVolume(participantId, trackName, level); }
  getParticipantVolume(participantId: string): number { return this.audio.getParticipantVolume(participantId); }
  applyVolumeToTrack(participantId: string, track: MediaStreamTrack, trackName: string): MediaStream { return this.audio.applyVolumeToTrack(participantId, track, trackName); }
  setMasterVolume(level: number) { this.audio.setMasterVolume(level); }
  async setOutputDevice(deviceId: string) { return this.audio.setOutputDevice(deviceId); }

  // ── Stats & Debug — delegated to ConnectionStatsMonitor ────────────────────

  getTrackStats(trackName: string) { return this.stats.getTrackStats(trackName); }
  getStatsByClerkId(clerkId: string, trackPrefix: 'cam' | 'screen') { return this.stats.getStatsByClerkId(clerkId, trackPrefix); }
  getConnectionStats(): VoiceConnectionStats | null { return this.stats.getConnectionStats(); }

  /** Returns the room slug for display as server identifier. */
  getRoomSlug(): string { return this.roomSlug; }

  /** Returns all debug time-series data for the full debug screen. */
  getDebugData() { return this.stats.getDebugData(); }

  /** Returns a detailed stats object matching the Discord-style JSON format. */
  async getDetailedStats(): Promise<object> { return this.stats.getDetailedStats(); }
}

