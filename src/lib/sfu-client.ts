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

import {
  VoiceOpcode,
  type ClientMessage,
  type ErrorPayload,
  type HeartbeatACKPayload,
  type HelloPayload,
  type IceServer,
  type ProfileUpdatePayload,
  type PushTrackDescriptor,
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
import { createTrueStereoStream as _createTrueStereoStream, mungeStereoOpus as _mungeStereoOpus } from "./voice/stereo-codec";
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
  private pushPC: RTCPeerConnection | null = null;
  private pullPC: RTCPeerConnection | null = null;

  // ── Room state ────────────────────────────────────────────────────────
  private roomSlug: string;
  private participantId: string | null = null;
  private voiceToken: string | null = null;
  private pushSessionId: string | null = null;
  private pullSessionId: string | null = null;
  private iceServers: IceServer[] = [];
  private pendingPullTracks: TrackInfo[] = [];
  private publishedTrackNames: Set<string> = new Set();
  private pushTransceivers: Map<string, RTCRtpTransceiver> = new Map();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlers: Map<string, Set<EventHandler<any>>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isLeaving = false;
  private pulledTracks: TrackInfo[] = [];
  private pushQueue: Promise<void> = Promise.resolve();
  private pullQueue: Promise<void> = Promise.resolve();
  private emittedMids: Set<string> = new Set();
  private leftParticipants: Set<string> = new Set();
  private pullRetryCount = 0;
  private pullResetCount = 0;
  private pullResetLastTime = 0;

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
        return this.pushTransceivers.get(name);
      },
      getParticipantId: () => this.participantId,
    });

    // Wire up audio pipeline module
    this.audio = new AudioPipeline({
      onAudioResumed: () => this.emit("audio-resumed", {}),
    });

    // Wire up stats monitor module
    this.stats = new ConnectionStatsMonitor({
      getPushPC: () => this.pushPC,
      getPullPC: () => this.pullPC,
      getPulledTracks: () => this.pulledTracks,
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

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const mainUrl = `${protocol}//${window.location.host}/api/channels/${this.roomSlug}/ws?v=1`;

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

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const voiceUrl = `${protocol}//${window.location.host}/api/channels/${this.roomSlug}/voice?v=1`;

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
        // Reset push state so re-publish creates fresh SFU sessions
        this.pushSessionId = null;
        this.pullSessionId = null;
        this.publishedTrackNames.clear();
        this.pushTransceivers.clear();
        this.emittedMids.clear();
        this.pulledTracks = [];
        this.lastPullPushHash = "";
        // Re-create voiceReadyPromise as pending so publish/pull waits for new VoiceReady
        this.voiceReadyPromise = new Promise<void>((resolve) => {
          this.voiceReadyResolve = resolve;
        });
        // Recreate peer connections for the new SFU sessions
        this.pushPC?.close();
        this.pushPC = null;
        this.pullPC?.close();
        this.pullPC = null;
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
    this.pushPC?.close();
    this.pushPC = null;
    this.pullPC?.close();
    this.pullPC = null;
    this.stats.stopStatsMonitoring();
    this.stats.stopConnectionStatsMonitoring();
    this.mainWs?.close();
    this.mainWs = null;
    this.voiceWs?.close();
    this.voiceWs = null;
    this.participantId = null;
    this.voiceToken = null;
    this.sessionId = null;
    this.pushSessionId = null;
    this.pullSessionId = null;
    this.publishedTrackNames.clear();
    this.pushTransceivers.clear();
    this.pendingPullTracks = [];
    this.pulledTracks = [];
    this.pushQueue = Promise.resolve();
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
      this.pushPC?.close();
      this.pushPC = null;
      this.pullPC?.close();
      this.pullPC = null;
      this.pushSessionId = null;
      this.pullSessionId = null;
      this.publishedTrackNames.clear();
      this.pushTransceivers.clear();
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
          this.pulledTracks = this.pulledTracks.filter(
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

        // Emit voice-reconnected so hooks can re-publish their local tracks
        this.emit("voice-reconnected", undefined as never);
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

        this.pulledTracks = this.pulledTracks.filter((pt) => {
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
        }
        if (this.pullNegotiationResolve) {
          const resolve = this.pullNegotiationResolve; // Wait, this should be pullNegotiationResolve
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
              const info = this.pulledTracks.find((t) => t.track_name === name);
              if (info) {
                tracksToRetry.push({ ...info });
                this.pulledTracks = this.pulledTracks.filter((t) => t.track_name !== name);
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
              setTimeout(() => {
                // Don't retry tracks from participants who left
                const stillValid = tracksToRetry.filter(
                  (t) => !this.leftParticipants.has(t.participant_id)
                );
                if (stillValid.length > 0) {
                  this.pullTracks(stillValid);
                } else {
                  this.pullRetryCount = 0;
                }
              }, delay);
            }
          } catch {
            this.emit("error", { message: err.message });
          }
        } else if (
          err.message.includes("Session is not ready") ||
          err.message.includes("session_error") ||
          err.message.includes("(425)")
        ) {
          // SFU session-level error: the entire pull session is dead.
          // Trigger a full pull PC + session reset so we create a fresh
          // session and re-pull all tracks.
          console.warn("[VoiceGW] Stale pull session detected — resetting pull session");
          this.resetPullSession();
        } else {
          this.emit("error", { message: err.message });
        }
        break;
      }
    }
  }

  // ── Peer Connections ──────────────────────────────────────────────────

  private createPeerConnections() {
    if (this.pushPC) this.pushPC.close();
    if (this.pullPC) this.pullPC.close();

    const config: RTCConfiguration = {
      iceServers: this.iceServers.map((s) => ({
        urls: s.urls,
        username: s.username,
        credential: s.credential,
      })),
      bundlePolicy: "max-bundle",
    };

    // Push PC: client offers, SFU answers
    this.pushPC = new RTCPeerConnection(config);
    this.stats.startConnectionStatsMonitoring();
    this.pushPC.onconnectionstatechange = () => {
      const state = this.pushPC?.connectionState ?? "closed";
      console.log(`[VoiceGW:push] connectionState: ${state}`);
      this.emit("connection-state", { state });
    };
    this.pushPC.oniceconnectionstatechange = () => {
      console.log(`[VoiceGW:push] iceConnectionState: ${this.pushPC?.iceConnectionState}`);
      if (this.pushPC?.iceConnectionState === "failed") {
        console.error("[VoiceGW:push] ICE connection failed — restarting ICE");
        this.pushPC.restartIce();
      }
    };
    this.pushPC.onsignalingstatechange = () => {
      console.log(`[VoiceGW:push] signalingState: ${this.pushPC?.signalingState}`);
    };

    // Pull PC: SFU offers, client answers. ontrack fires here.
    this.pullPC = new RTCPeerConnection(config);
    this.configurePullPC();
  }

  /** Centralized configuration for the pull PeerConnection */
  private configurePullPC() {
    if (!this.pullPC) return;

    this.pullPC.ontrack = this.createPullOnTrack();
    this.pullPC.onconnectionstatechange = () => {
      console.log(`[VoiceGW:pull] connectionState: ${this.pullPC?.connectionState}`);
    };
    this.pullPC.oniceconnectionstatechange = () => {
      console.log(`[VoiceGW:pull] iceConnectionState: ${this.pullPC?.iceConnectionState}`);
      if (this.pullPC?.iceConnectionState === "failed") {
        console.error("[VoiceGW:pull] ICE connection failed — resetting pull session");
        this.resetPullSession();
      }
    };
    this.pullPC.onsignalingstatechange = () => {
      console.log(`[VoiceGW:pull] signalingState: ${this.pullPC?.signalingState}`);
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

    // Save tracks we need to re-pull before clearing state
    const tracksToPull = this.pulledTracks.map((t) => ({
      participant_id: t.participant_id,
      track_name: t.track_name,
      session_id: t.session_id,
      kind: t.kind,
    })).filter((t) => !this.leftParticipants.has(t.participant_id));

    // Tear down old pull PC
    if (this.pullPC) {
      this.pullPC.ontrack = null;
      this.pullPC.onconnectionstatechange = null;
      this.pullPC.oniceconnectionstatechange = null;
      this.pullPC.onsignalingstatechange = null;
      this.pullPC.close();
      this.pullPC = null;
    }

    // Clear stale pull state
    this.pullSessionId = null;
    this.pulledTracks = [];
    this.emittedMids.clear();
    this.lastPullPushHash = "";

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
      this.pullPC = new RTCPeerConnection(config);
      this.configurePullPC();
    }

    // Re-pull tracks after a short delay to let the new PC stabilize
    if (tracksToPull.length > 0) {
      console.log(`[VoiceGW:pull] Re-pulling ${tracksToPull.length} tracks after session reset`);
      setTimeout(() => {
        if (!this.isLeaving && this.voiceWs?.readyState === WebSocket.OPEN) {
          this.pullTracks(tracksToPull as TrackInfo[]);
        }
      }, 500);
    }
  }

  private findTrackByMid(mid: string | null): TrackInfo | undefined {
    if (!mid) return undefined;
    return this.pulledTracks.find((t) => t.mid === mid);
  }

  // ── Publish local media (via Voice GW) ─────────────────────────────────

  async publishTracks(stream: MediaStream, prefix: string) {
    console.log(`[VoiceGW:push] publishTracks called: prefix=${prefix}, tracks=${stream.getTracks().length}, kinds=${stream.getTracks().map(t => t.kind).join(",")}, pushPC=${!!this.pushPC}`);
    this.pushQueue = this.pushQueue.then(async () => {
      console.log(`[VoiceGW:push] publishTracks queue executing: prefix=${prefix}, pushPC=${!!this.pushPC}`);

      // Wait for PeerConnection to be created (which happens after Main GW Ready)
      if (!this.pushPC) {
        console.log(`[VoiceGW:push] Waiting for pushPC to be created...`);
        await this.pcReadyPromise;
      }

      const pushPC = this.pushPC;
      if (!pushPC) {
        console.error("[VoiceGW:push] pushPC still null after pcReadyPromise!");
        return;
      }

      const pushTracks: PushTrackDescriptor[] = [];

      for (const track of stream.getTracks()) {
        const trackName = `${prefix}-${track.kind}-${this.participantId}`;

        // Optimization: Content Hints
        if (track.kind === "video") {
          track.contentHint = prefix === "screen" ? "detail" : "motion";
        } else if (track.kind === "audio") {
          track.contentHint = prefix === "screen" ? "music" : "speech";
        }

        let transceiver = this.pushTransceivers.get(trackName);

        if (transceiver) {
          console.log(`[VoiceGW:push] Reusing transceiver for ${trackName}, replacing track`);
          transceiver.sender.replaceTrack(track).catch(err => {
            console.warn(`[VoiceGW:push] replaceTrack failed for ${trackName}:`, err);
          });
        } else {
          console.log(`[VoiceGW:push] Adding new transceiver for ${trackName}`);
          const encodings: RTCRtpEncodingParameters[] = [];
          if (track.kind === "video") {
            if (prefix === "cam") {
              // Camera: Standard 3-layer simulcast
              encodings.push(
                { rid: "h", maxBitrate: 1_200_000, priority: "high" },
                { rid: "m", maxBitrate: 400_000, scaleResolutionDownBy: 2, priority: "medium" },
                { rid: "l", maxBitrate: 100_000, scaleResolutionDownBy: 4, priority: "low" }
              );
            } else {
              // Screen: SINGLE stream, NO simulcast. VP8 simulcast in Chrome
              // has a known bug that internally downscales even the highest layer.
              // Discord/Meet also disable simulcast for screen shares.
              encodings.push(
                { maxBitrate: 8_000_000, priority: "high" }
              );
            }
          } else if (track.kind === "audio") {
            if (prefix === "screen") {
              // High-fidelity screen audio (stereo)
              encodings.push({
                maxBitrate: 192_000,
                priority: "high",
                networkPriority: "high"
              });
            } else {
              // High-quality speech audio (stereo)
              encodings.push({
                maxBitrate: 192_000,
                priority: "high",
                networkPriority: "high"
              });
            }
          }

          transceiver = pushPC.addTransceiver(track, {
            direction: "sendonly",
            sendEncodings: encodings.length > 0 ? encodings : undefined,
          });

          // Force Opus stereo at the codec level (before SDP creation)
          // prioritizing Opus by placing it at the front of the array.
          if (track.kind === 'audio' && typeof RTCRtpSender.getCapabilities === 'function') {
            try {
              const caps = RTCRtpSender.getCapabilities('audio');
              if (caps?.codecs) {
                const opusCodecs = caps.codecs.filter(c => c.mimeType.toLowerCase() === 'audio/opus');
                const otherCodecs = caps.codecs.filter(c => c.mimeType.toLowerCase() !== 'audio/opus');
                transceiver.setCodecPreferences([...opusCodecs, ...otherCodecs]);
                // console.log(`[VoiceGW:push] Prioritized Opus codec for ${trackName}`);
              }
            } catch (e) {
              console.warn(`[VoiceGW:push] setCodecPreferences failed for ${trackName}:`, e);
            }
          }

          // Optimization: Degradation Preference
          if (track.kind === "video") {
            const parameters = transceiver.sender.getParameters();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (parameters as any).degradationPreference = prefix === "screen" ? "maintain-resolution" : "balanced";
            transceiver.sender.setParameters(parameters).then(() => {
              console.log(`[VoiceGW:push] degradationPreference set to ${prefix === "screen" ? "maintain-resolution" : "balanced"} for ${trackName}`);
            }).catch((err) => {
              console.warn(`[VoiceGW:push] degradationPreference setParameters failed for ${trackName}:`, err);
            });

            // Log the actual encoding parameters after setup
            const params = transceiver.sender.getParameters();
            console.log(`[VoiceGW:push] ${trackName} encodings:`, JSON.stringify(params.encodings?.map(e => ({
              rid: e.rid, maxBitrate: e.maxBitrate, scaleResolutionDownBy: e.scaleResolutionDownBy, active: e.active,
            }))));
          }
          this.pushTransceivers.set(trackName, transceiver);
          this.publishedTrackNames.add(trackName);
        }

        pushTracks.push({
          track_name: trackName,
          mid: transceiver.mid ?? undefined,
          kind: track.kind as "audio" | "video",
        });
      }

      if (pushTracks.length === 0) return;

      const offer = await pushPC.createOffer();
      // Only force stereo Opus for screen-share audio; mic audio stays mono
      const mungedSDP = offer.sdp ? this.mungeStereoOpus(offer.sdp, prefix) : undefined;
      await pushPC.setLocalDescription({ type: "offer", sdp: mungedSDP });

      // Update mids after creating offer
      for (const pt of pushTracks) {
        if (!pt.mid) {
          const transceiver = pushPC.getTransceivers().find(
            (t) => t.sender.track?.label === stream.getTracks().find(
              (st) => `${prefix}-${st.kind}-${this.participantId}` === pt.track_name
            )?.label
          );
          if (transceiver?.mid) {
            pt.mid = transceiver.mid;
          }
        }
      }

      console.log(`[VoiceGW:push] Publishing ${pushTracks.length} tracks`);

      // Wait for Voice Gateway to be ready before sending
      await this.voiceReadyPromise;

      const negotiationDonePromise = this.waitForPushNegotiationDone(10000);
      const answerPromise = this.waitForPushAnswer(10000);

      // Stop unhandled rejections if one fails early
      negotiationDonePromise.catch(() => { });
      answerPromise.catch(() => { });

      this.sendVoice({
        op: VoiceOpcode.SelectProtocol,
        d: {
          sdp: pushPC.localDescription!.sdp,
          push_tracks: pushTracks,
          pull_tracks: [],
        },
      });

      await answerPromise;
      await negotiationDonePromise;

      // Ensure TracksReady is fired ONLY when ICE is connected and RTP is actually flowing.
      // Emitting it immediately after negotiationDone but before ICE completes causes
      // the SFU to return empty_track_error to viewers who try to pull before RTP arrives.
      if (this.pushPC && this.pushPC.iceConnectionState !== "connected" && this.pushPC.iceConnectionState !== "completed") {
        await new Promise<void>((resolve) => {
          const pc = this.pushPC;
          if (!pc) {
            resolve();
            return;
          }
          const checkIce = () => {
            if (!this.pushPC) {
              resolve();
              return;
            }
            if (this.pushPC.iceConnectionState === "connected" || this.pushPC.iceConnectionState === "completed") {
              this.pushPC.removeEventListener("iceconnectionstatechange", checkIce);
              resolve();
            }
          };
          pc.addEventListener("iceconnectionstatechange", checkIce);
        });
      }

      this.sendVoice({
        op: VoiceOpcode.TracksReady,
        d: { track_names: pushTracks.map((pt) => pt.track_name) },
      });
    }).catch((err) => {
      console.error("[VoiceGW:push] publishTracks error:", err);
    });
  }

  // ── Unpublish single track ──────────────────────────────────────────────

  unpublishTrack(trackName: string) {
    console.log(`[VoiceGW] Unpublishing track: ${trackName}`);
    this.publishedTrackNames.delete(trackName);

    if (this.pushPC) {
      const transceiver = this.pushTransceivers.get(trackName);
      if (transceiver) {
        transceiver.sender.replaceTrack(null).catch(() => { });
        if (typeof transceiver.stop === 'function') {
          try { transceiver.stop(); } catch (e) { console.warn("transceiver stop error:", e); }
        } else {
          transceiver.direction = "inactive";
        }
        this.pushTransceivers.delete(trackName);
      }
    }

    this.sendVoice({
      op: VoiceOpcode.StopTracks,
      d: { track_names: [trackName] },
    });
  }

  /**
   * Replace the track on an existing transceiver (seamlessly swap mic/camera)
   */
  async replaceTrack(trackName: string, newTrack: MediaStreamTrack) {
    console.log(`[VoiceGW] Replacing track on transceiver: ${trackName}`);
    if (!this.pushPC) return;

    const transceiver = this.pushTransceivers.get(trackName);
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

    for (const name of trackNames) {
      this.publishedTrackNames.delete(name);
      const transceiver = this.pushTransceivers.get(name);
      if (transceiver) {
        console.log(`[VoiceGW:push] Stopping transceiver for ${name}`);
        transceiver.sender.replaceTrack(null).catch(() => { });

        // Fully stop the transceiver so the WebRTC stack marks the `m=` line inactive.
        // This is CRITICAL because the server calls `tracks/close` on the SFU.
        // If we reuse this transceiver later, the SFU won't bind the RTP correctly
        // to the newly created track entity.
        if (typeof transceiver.stop === 'function') {
          try { transceiver.stop(); } catch (e) { console.warn("transceiver stop error:", e); }
        } else {
          transceiver.direction = "inactive";
        }

        // Remove so publishTracks creates a brand new transceiver & `m=` line
        this.pushTransceivers.delete(name);
      }
    }

    this.sendVoice({
      op: VoiceOpcode.StopTracks,
      d: { track_names: trackNames },
    });
  }

  // ── Pull remote tracks (via Voice GW) ──────────────────────────────────

  async pullTracks(tracks: TrackInfo[]) {
    this.pullQueue = this.pullQueue.then(async () => {
      if (!this.pullPC) {
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

      // Add pending tracks from queue
      const allTracks = [...this.pendingPullTracks, ...tracks];
      this.pendingPullTracks = [];

      // Filter out tracks we already have in pulledTracks
      const newTracks = allTracks.filter(
        (nt) => !this.pulledTracks.some((pt) => pt.track_name === nt.track_name)
      );

      // Add to tracked pulledTracks
      this.pulledTracks.push(...newTracks);

      if (this.pulledTracks.length === 0) {
        console.log("[VoiceGW:pull] pullTracks: no tracks to pull");
        return;
      }

      // Generate the payload — include rid for the server to forward to SFU.
      // Screen-video tracks default to "h" (high) since text/detail is unreadable
      // at lower quality. This handles the timing gap where pullTracks fires
      // before the React subscription effect calls setRemoteTrackSubscription.
      const pullTracksPayload = this.pulledTracks.map(t => {
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
      const dedupPayload = this.pulledTracks.map(t => ({
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

      console.log(`[VoiceGW:pull] Requesting SFU tracks: ${this.pulledTracks.map(t => t.track_name).join(", ")}`);

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
    console.log(`[VoiceGW] SessionDescription: session_id=${sd.session_id}, sdp_type=${sd.sdp_type}, tracks=${sd.tracks.length}`);

    if (sd.sdp_type === "offer") {
      // SFU-generated offer — for PULL (on pullPC)
      this.pullSessionId = sd.session_id;

      if (!this.pullPC) {
        console.error("[VoiceGW:pull] handleSessionDescription: no pull peer connection!");
        return;
      }

      // Synchronize track info (mids might have changed)
      if (sd.tracks) {
        for (const remote of sd.tracks) {
          // If another track was previously using this mid, clear its mid to prevent collisions
          this.pulledTracks.forEach(t => {
            if (t.mid === remote.mid && t.track_name !== remote.track_name) {
              console.log(`[VoiceGW:pull] mid ${remote.mid} reassigned from ${t.track_name} to ${remote.track_name}`);
              t.mid = undefined;
            }
          });

          const local = this.pulledTracks.find(t => t.track_name === remote.track_name);
          if (local) {
            local.mid = remote.mid;
          }
        }
        // Cleanup tracks with no mid anymore
        this.pulledTracks = this.pulledTracks.filter(t => t.mid !== undefined);
      }

      try {
        console.log("[VoiceGW:pull] Setting remote description (offer from SFU)");
        const remoteSdp = sd.sdp ? this.mungeStereoOpus(sd.sdp) : sd.sdp;
        await this.pullPC.setRemoteDescription({
          type: "offer",
          sdp: remoteSdp,
        });

        // Update directions based on subscription state before creating answer
        this.pullPC.getTransceivers().forEach(tr => {
          const track = tr.mid ? this.findTrackByMid(tr.mid) : null;
          const isUnsubscribed = (tr.mid && this.unsubscribedTrackMids.has(tr.mid)) || (track && this.unsubscribedTrackNames.has(track.track_name));

          if (tr.mid && isUnsubscribed) {
            tr.direction = 'inactive';
          } else if (tr.direction === 'inactive' && tr.receiver.track.kind) { // Only change if it was inactive and has a track
            tr.direction = 'recvonly';
          }
        });

        const answer = await this.pullPC.createAnswer();
        // Pull path: allow stereo since remote may send screen-share audio
        const mungedSDP = answer.sdp ? this.mungeStereoOpus(answer.sdp, "screen") : undefined;
        await this.pullPC.setLocalDescription({ type: "answer", sdp: mungedSDP });

        console.log(`[VoiceGW:pull] Sending answer. connectionState=${this.pullPC.connectionState}`);

        this.sendVoice({
          op: VoiceOpcode.Answer,
          d: { sdp: this.pullPC.localDescription!.sdp },
        });
      } catch (err) {
        console.error("[VoiceGW:pull] Failed to handle SFU offer:", err);
        throw err;
      }

      if (this.pullResolver) {
        const resolve = this.pullResolver;
        this.pullResolver = null;
        this.pullRetryCount = 0;
        this.pullResetCount = 0;
        resolve();
      }
    } else {
      // SFU answer to our offer — for PUSH (on pushPC)
      this.pushSessionId = sd.session_id;

      if (!this.pushPC) {
        console.error("[VoiceGW:push] handleSessionDescription: no push peer connection!");
        return;
      }

      try {
        console.log("[VoiceGW:push] Setting remote description (answer)");
        const remoteSdp = sd.sdp ? this.mungeStereoOpus(sd.sdp) : sd.sdp;
        await this.pushPC.setRemoteDescription({
          type: "answer",
          sdp: remoteSdp,
        });
        console.log(`[VoiceGW:push] Remote description set. connectionState=${this.pushPC.connectionState}`);
      } catch (err) {
        console.error("[VoiceGW:push] Failed to set remote description:", err);
        throw err;
      }

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
  private mungeStereoOpus(sdp: string, prefix?: string): string { return _mungeStereoOpus(sdp, prefix); }

  // ── Send Helpers ──────────────────────────────────────────────────────

  private sendMain(msg: ClientMessage) {
    if (this.mainWs?.readyState === WebSocket.OPEN) {
      if (this.isMainIdentified || msg.op === VoiceOpcode.Identify || msg.op === VoiceOpcode.Resume || msg.op === VoiceOpcode.Heartbeat) {
        this.mainWs.send(JSON.stringify(msg));
      } else {
        console.log("[MainGW] Not identified, queueing message op=" + msg.op);
        this.mainMsgQueue.push(msg);
      }
    }
  }

  private sendVoice(msg: ClientMessage) {
    if (this.voiceWs?.readyState === WebSocket.OPEN) {
      if (this.isVoiceIdentified || msg.op === VoiceOpcode.VoiceIdentify || msg.op === VoiceOpcode.Heartbeat) {
        this.voiceWs.send(JSON.stringify(msg));
      } else {
        console.log("[VoiceGW] Not identified, queueing message op=" + msg.op);
        this.voiceMsgQueue.push(msg);
      }
    }
  }

  getParticipantId(): string | null {
    return this.participantId;
  }

  getConnectionState(): string {
    const pushState = this.pushPC?.connectionState ?? "new";
    const pullState = this.pullPC?.connectionState ?? "new";
    if (pushState === "connected" || pullState === "connected") return "connected";
    if (pushState === "connecting" || pullState === "connecting") return "connecting";
    return pushState;
  }

  /**
   * Enables or disables a remote track's bandwidth usage.
   * If disabled, the transceiver direction is set to 'inactive'.
   */
  setRemoteTrackSubscription(participantId: string, trackName: string, active: boolean, rid?: string) {
    const activeTrack = this.pulledTracks.find(t => t.participant_id === participantId && t.track_name === trackName);

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
    const tr = this.pullPC?.getTransceivers().find(t => t.mid === activeTrack.mid);
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

  public async resumeAudioContext() { return this.audio.resumeAudioContext(); }
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

