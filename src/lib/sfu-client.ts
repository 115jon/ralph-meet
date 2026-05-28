import { clog } from "./console-logger";
import { TypedEventEmitter } from "./event-emitter";
import { wsUrl } from "./platform";
import {
  VoiceOpcode,
  type IceServer,
  type SFUEventMap,
  type TrackInfo,
  type VoiceConnectionStats
} from "./types";
import { AudioPipeline } from "./voice/audio-pipeline";
import { ConnectionStatsMonitor } from "./voice/stats-monitor";
import { TrackNegotiator } from "./voice/track-negotiator";
import { VoiceActivityDetector } from "./voice/vad";

import { AudioSentinel } from "./voice/audio-sentinel";
import { RoomGateway } from "./voice/gateways/room-gateway";
import { VoiceGateway } from "./voice/gateways/voice-gateway";
import { WebRTCSessionManager } from "./voice/webrtc-session-manager";

const sfuLog = clog("SFU");
const CREDENTIAL_REFRESH_MS = 47 * 60 * 60 * 1000;

export type { SFUEventMap, VoiceConnectionStats } from "./types";

export class SFUClient extends TypedEventEmitter<SFUEventMap> {
  // --- Gateways & Managers ---
  public readonly roomGW: RoomGateway;
  public readonly voiceGW: VoiceGateway;
  public readonly negotiator: TrackNegotiator;
  public readonly rtcSessionManager: WebRTCSessionManager;

  // --- Submodules ---
  public readonly vad: VoiceActivityDetector;
  public readonly audio: AudioPipeline;
  public readonly stats: ConnectionStatsMonitor;
  public readonly audioSentinel: AudioSentinel;

  // --- State ---
  private roomSlug: string;
  private participantId: string | null = null;
  private voiceToken: string | null = null;
  private iceServers: IceServer[] = [];
  private connectArgs: { name: string; avatarUrl?: string; clerkUserId?: string } | null = null;

  private isLeaving = false;
  private credentialRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectRecoveryPromise: Promise<void> | null = null;
  private pcReadyPromise: Promise<void> = Promise.resolve();
  private pcReadyResolve: (() => void) | null = null;

  private voiceReadyPromise: Promise<void> = Promise.resolve();
  private voiceReadyResolve: (() => void) | null = null;

  // Track state
  private pendingPullTracks: TrackInfo[] = [];
  private pullQueue: Promise<void> = Promise.resolve();
  private emittedMids = new Set<string>();
  private unsubscribedTrackMids = new Set<string>();
  private unsubscribedTrackNames = new Set<string>();
  private trackRids = new Map<string, string>();
  private lastPullPushHash = "";

  private camPushResolver: (() => void) | null = null;
  private screenPushResolver: (() => void) | null = null;
  private pullResolver: (() => void) | null = null;
  private pullRejector: ((reason?: any) => void) | null = null;
  private camPushNegotiationResolve: (() => void) | null = null;
  private camPushRejector: ((reason?: any) => void) | null = null;
  private screenPushNegotiationResolve: (() => void) | null = null;
  private screenPushRejector: ((reason?: any) => void) | null = null;
  private pullNegotiationResolve: (() => void) | null = null;
  private pullNegotiationRejector: ((reason?: any) => void) | null = null;
  private pullRetryCount: number = 0;
  private pullResetCount: number = 0;
  private pullEpoch: number = 0;
  private remoteSpeakingUntil = new Map<string, number>();

  constructor(roomSlug: string) {
    super();
    this.roomSlug = roomSlug;

    this.roomGW = new RoomGateway();
    this.voiceGW = new VoiceGateway();

    this.negotiator = new TrackNegotiator({
      getParticipantId: () => this.participantId,
      sendWS: (msg: any) => this.voiceGW.send(msg),
      emit: (e, ...args) => (this as any).emit(e, ...args),
      getUnsubscribedMids: () => this.unsubscribedTrackMids,
      getUnsubscribedNames: () => this.unsubscribedTrackNames,
      pcReadyPromise: () => this.pcReadyPromise,
      waitForPushNegotiationDone: (prefix, t) => this.waitForPushNegotiationDone(prefix, t),
      waitForPushAnswer: (prefix, t) => this.waitForPushAnswer(prefix, t),
    });

    this.rtcSessionManager = new WebRTCSessionManager(
      this.negotiator,
      this.voiceGW,
      () => {
        if (!this.isLeaving && this.participantId && this.voiceToken) {
          this.voiceGW.disconnect();
          this.connectVoice();
        }
      }
    );

    // --- Submodules ---
    this.on('create-screen-pc' as any, () => {
      if (!this.negotiator.screenPushPC) this.createScreenPushPC();
    });

    this.vad = new VoiceActivityDetector({
      onSpeakingChange: (isSpeaking, flags) => {
        if (this.participantId) {
          this.emit("vad-speaking", { participantId: this.participantId, isSpeaking });
          this.emit("speaking", { participantId: this.participantId, speaking: flags });
        }
      },
      onAudioStalled: (isStalled: boolean) => {
        this.emit("audio-stalled", isStalled);
      },
      sendSpeaking: (flags) => this.sendSpeaking(flags),
      getAudioTransceiver: () => this.negotiator.getPushTransceiver(`cam-audio-${this.participantId}`),
      getParticipantId: () => this.participantId,
    });

    this.audio = new AudioPipeline({
      onAudioResumed: () => this.emit("audio-resumed", {}),
    });

    this.stats = new ConnectionStatsMonitor({
      getPushPC: () => this.negotiator.camPushPC,
      getPullPC: () => this.negotiator.pullPC,
      getPulledTracks: () => this.negotiator.pulledTracks,
      getRoomSlug: () => this.roomSlug,
      getParticipantId: () => this.participantId,
      getConnectionState: () => this.getConnectionState(),
    });

    this.audioSentinel = new AudioSentinel({
      pc: () => this.negotiator.pullPC,
      stallThresholdTicks: 30,
      shouldTreatAsStall: () => this.hasRecentlySpeakingRemote(),
      onStall: () => {
        sfuLog.warn("AudioSentinel detected inbound-rtp stall! Triggering auto-recovery...");
        this.emit("audio-stalled", true);
        if (!this.isLeaving) {
          // Instead of immediately resetting pull PC (which races with VoiceGW
          // reconnects), use the serialized recovery coordinator if VoiceGW
          // is reconnecting, otherwise do a targeted pull reset.
          if (!this.voiceGW.isReady) {
            sfuLog.info("AudioSentinel: VoiceGW not ready, deferring to reconnect recovery");
            // Recovery will happen when VoiceGW re-identifies via handleVoiceGWReconnectRecovery
          } else {
            const tracksToRestore = [...this.negotiator.pulledTracks];
            this.resetPullAndRepull(tracksToRestore);
          }
        }
      },
      onRecover: () => {
        this.emit("audio-stalled", false);
      }
    });

    this.wireRoomEvents();
    this.wireVoiceEvents();
  }

  private wireRoomEvents() {
    this.roomGW.on("ready", (e) => {
      this.participantId = e.participantId;
      this.applyIceServers(e.iceServers);
      this.voiceToken = e.voiceToken;
      this.createPeerConnections();
      this.scheduleCredentialRefresh();

      if (this.pcReadyResolve) {
        this.pcReadyResolve();
        this.pcReadyResolve = null;
      }

      const othersTracks = e.tracksToQueue.filter(t => t.participant_id !== this.participantId);
      this.pendingPullTracks.push(...othersTracks);

      this.emit("joined", {
        participantId: e.participantId,
        iceServers: e.iceServers,
        participants: e.participants,
        spatialAudioState: (e as any).spatialAudioState,
      });

      this.voiceGW.disconnect();
      this.connectVoice();
    });

    this.roomGW.on("resumed", (e) => {
      if (e.iceServers?.length) this.applyIceServers(e.iceServers);
      if (e.voiceToken) {
        this.voiceToken = e.voiceToken;
        this.voiceGW.updateVoiceToken(e.voiceToken);
      }
      if (e.participants) {
        this.emit("participants-sync", { participants: e.participants, spatialAudioState: (e as any).spatialAudioState });
      }
      this.scheduleCredentialRefresh();
      if (!this.negotiator.pullPC) this.createPeerConnections();

      if (this.pcReadyResolve) {
        this.pcReadyResolve();
        this.pcReadyResolve = null;
      }

      if (!this.voiceGW.isReady) {
        this.voiceGW.disconnect();
        this.connectVoice();
      }
    });

    // Pass-through generic events
    this.roomGW.on("disconnected", () => {
      if (!this.isLeaving) this.emit("disconnected", undefined as never);
    });
    this.roomGW.on("error", (e) => this.emit("error", { message: e.message }));
    this.roomGW.on("participant-joined", (e) => this.emit("participant-joined", e));
    this.roomGW.on("participant-left", (e) => {
      this.audio.removeParticipantVolume(e.participantId);
      this.negotiator.pulledTracks = this.negotiator.pulledTracks.filter(t => t.participant_id !== e.participantId);
      this.emit("participant-left", e);
    });
    this.roomGW.on("voice-state-update", (e) => this.emit("voice-state-update", e as any));
    this.voiceGW.on("speaking", (e) => {
      if (e.participantId !== this.participantId) {
        if (e.speaking) {
          this.remoteSpeakingUntil.set(e.participantId, Date.now() + 10_000);
        } else {
          this.remoteSpeakingUntil.delete(e.participantId);
        }
      }
      this.emit("speaking", e);
    });
    this.roomGW.on("profile-update", (e) => this.emit("profile-update", e));
  }

  private wireVoiceEvents() {
    this.voiceGW.on("error", (e) => {
      if (e.message.startsWith("pull-retry:")) {
        try {
          const trackNames = JSON.parse(e.message.split("pull-retry:")[1]);
          const err = new Error(`pull-retry:${JSON.stringify(trackNames)}`);
          if (this.pullRejector) {
            this.pullRejector(err);
            this.pullRejector = null;
          }
          if (this.pullNegotiationRejector) {
            this.pullNegotiationRejector(err);
            this.pullNegotiationRejector = null;
          }
        } catch (err) {
          sfuLog.error("Failed to parse pull-retry", err);
        }
      } else if (e.message === "Voice token expired" || e.code === 4004) {
        sfuLog.warn("Voice token is expired, emitting event to force RoomGW reconnect...");
        this.emit("voice-token-expired", undefined as never);
      } else if (e.message === "pull-session-expired") {
        sfuLog.warn("Server reported expired pull SFU session; rebuilding pull PC and re-pulling tracks");
        this.resetPullAndRepull([...this.negotiator.pulledTracks, ...this.pendingPullTracks]);
      } else if (e.message === "session-dead-reconnect") {
        sfuLog.warn("Server reported dead SFU session; rebuilding pull side from remembered tracks");
        this.resetPullAndRepull([...this.negotiator.pulledTracks, ...this.pendingPullTracks]);
      } else {
        this.rejectPendingSignalWaiters(new Error(e.message));
        this.emit("error", { message: e.message });
      }
    });

    this.voiceGW.on("voice-ready", (e) => {
      this.rtcSessionManager.clearAllDisconnectTimers();

      if (this.voiceReadyResolve) {
        this.voiceReadyResolve();
        this.voiceReadyResolve = null;
      }

      // Reset circuit breakers on successful reconnect
      this.rtcSessionManager.resetCircuitBreakers();

      // Cleanup orphaned tracks from server state sync and enqueue existing tracks.
      // VoiceReady can be empty during reconnect races, so only a non-empty
      // server list is authoritative enough to purge local pull state.
      const serverTracks = this.uniqueTrackList(e.tracks || []);
      const serverNames = new Set(serverTracks.map(t => t.track_name));

      // Queue server tracks that are not already represented by local pull state.
      const existingNames = new Set(this.pendingPullTracks.map(t => t.track_name));
      for (const track of serverTracks) {
        if (this.shouldPullServerTrack(track) && !existingNames.has(track.track_name)) {
          this.pendingPullTracks.push(track);
          existingNames.add(track.track_name);
        }
      }

      // Only purge pending tracks if server returned a non-empty track list.
      // Empty list means the other participant hasn't re-published yet — keep queued state.
      if (serverNames.size > 0) {
        this.pendingPullTracks = this.pendingPullTracks.filter(t => serverNames.has(t.track_name));
      }
      if (serverNames.size > 0) {
        const orphaned = this.negotiator.pulledTracks
          .map(t => t.track_name)
          .filter(n => !serverNames.has(n));

        if (orphaned.length > 0) {
          sfuLog.warn(`Evicting ${orphaned.length} orphaned tracks`);
          this.handleStopTracks(orphaned);
        }
      }

      // Fix 2 (P0): Re-pull existing tracks that are still valid on the server
      // BUT only if the pull PeerConnection is dead — if it's alive, audio is
      // already flowing over UDP and re-pulling would disrupt it.
      const pullPCActive = this.negotiator.pullPC?.iceConnectionState === "connected" ||
        this.negotiator.pullPC?.iceConnectionState === "completed";
      const tracksToRepull = this.uniqueTrackList([
        ...serverTracks,
        ...this.pendingPullTracks,
        ...this.negotiator.pulledTracks,
      ]);

      if (pullPCActive && serverTracks.length > 0) {
        const desyncedTracks = serverTracks.filter((track) => {
          const existing = this.negotiator.pulledTracks.find((pt) => pt.track_name === track.track_name);
          if (!existing) return false;
          if (track.session_id && existing.session_id && track.session_id !== existing.session_id) return false;
          return !this.hasLivePullReceiver(existing);
        });

        if (desyncedTracks.length > 0) {
          sfuLog.warn(`Pull PC is connected but ${desyncedTracks.length} receiver(s) are missing/stale; rebuilding pull session: ${desyncedTracks.map(t => t.track_name).join(", ")}`);
          this.resetPullAndRepull(tracksToRepull);
          return;
        }
      }

      if (pullPCActive) {
        sfuLog.info("Pull PC is alive — skipping re-pull, audio continues uninterrupted ✓");
      } else {
        // Pull PC is dead or was never connected — create a fresh one
        // CRITICAL: This MUST happen here in the voice-ready handler, not in the
        // recovery coordinator, because we need the fresh PC BEFORE calling pullTracks().
        if (this.negotiator.pullPC) {
          sfuLog.warn(`Pull PC is dead (state=${this.negotiator.pullPC.iceConnectionState}) — closing stale PC and creating fresh one`);
        } else {
          sfuLog.warn("Pull PC is null — creating fresh one");
        }
        this.resetServerPullSession();
        this.pullEpoch++;
        this.rtcSessionManager.resetPullSession(this.isLeaving, () => this.connectVoice());
        this.createPeerConnections();

        if (tracksToRepull.length > 0) {
          sfuLog.info(`Re-queuing ${tracksToRepull.length} tracks for fresh pull PC`);
          this.pendingPullTracks = this.uniqueTrackList(tracksToRepull);
        }
      }

      // Automatically pull all queued tracks after voice connects
      if (this.pendingPullTracks.length > 0) {
        const toPull = [...this.pendingPullTracks];
        this.pendingPullTracks = [];
        sfuLog.info(`Pulling ${toPull.length} tracks: ${toPull.map(t => t.track_name).join(', ')}`);
        this.pullTracks(toPull);
      }
    });

    this.voiceGW.on("tracks-ready", (e) => {
      const isPush = e.tracks.some(t => t.participant_id === this.participantId);
      if (!isPush) {
        sfuLog.info(`Remote tracks ready: ${e.tracks.map(t => t.track_name).join(', ')}`);
        this.rtcSessionManager.clearDisconnectTimer("pull");
      }
    });

    this.voiceGW.on("app-event", (event) => {
      this.emit("app-event", event);
    });

    this.voiceGW.on("session-description", (sd) => {
      // ICE restart answers are no longer supported
      if (sd.ice_restart) return;

      const isPush = sd.sdp_type === 'answer';
      const prefix = isPush ? (sd.push_prefix || this.negotiator.getPrefixBySessionId(sd.session_id) || 'cam') : undefined;

      if (!isPush) {
        this.negotiator.handleSessionDescription(sd, 'pull').then(() => {
          if (this.pullResolver) {
            const resolve = this.pullResolver;
            this.pullResolver = null;
            this.pullRetryCount = 0;
            this.pullResetCount = 0;
            resolve();
          }
        }).catch(err => {
          sfuLog.error("handleSessionDescription error:", err);
          if (err instanceof DOMException && (err.message.includes("media type") || err.message.includes("m-lines"))) {
            const tracksToRestore = [...this.negotiator.pulledTracks];
            this.resetPullAndRepull(tracksToRestore);
          } else {
            this.emit("error", { message: `SDP handling error: ${err}` });
          }
        });
      } else {
        this.negotiator.handleSessionDescription(sd, 'push', prefix).then(() => {
          if (prefix === 'screen' && this.screenPushResolver) {
            const resolve = this.screenPushResolver;
            this.screenPushResolver = null;
            this.screenPushRejector = null;
            resolve();
          } else if (this.camPushResolver) {
            const resolve = this.camPushResolver;
            this.camPushResolver = null;
            this.camPushRejector = null;
            resolve();
          }
        }).catch(err => {
          sfuLog.error("Push SDP error:", err);
          if (prefix === 'screen' && this.screenPushRejector) {
            const reject = this.screenPushRejector;
            this.screenPushRejector = null;
            reject(err);
          } else if (this.camPushRejector) {
            const reject = this.camPushRejector;
            this.camPushRejector = null;
            reject(err);
          }
        });
      }
    });

    this.voiceGW.on("negotiation-done", () => {
      sfuLog.info(`NegotiationDone received`);
      const camPCStable = this.negotiator.camPushPC?.signalingState === 'stable';
      const preferScreen = this.screenPushNegotiationResolve && (!this.camPushNegotiationResolve || camPCStable);

      if (!preferScreen && this.camPushNegotiationResolve) {
        const resolve = this.camPushNegotiationResolve;
        this.camPushNegotiationResolve = null;
        resolve();
        this.vad.onTransceiverReady();
      } else if (this.screenPushNegotiationResolve) {
        const resolve = this.screenPushNegotiationResolve;
        this.screenPushNegotiationResolve = null;
        resolve();
      } else if (this.pullNegotiationResolve) {
        const resolve = this.pullNegotiationResolve;
        this.pullNegotiationResolve = null;
        resolve();
      }
    });

    this.voiceGW.on("track-offered", (v) => {
      // Ignore our own tracks so we don't pull them back from the server (echo)
      if (v.session_id === this.participantId || v.participant_id === this.participantId) {
        return;
      }

      // Server informs us about a new track available
      if (this.unsubscribedTrackNames.has(v.track_name)) {
        sfuLog.info(`Ignoring track-offered for unsubscribed track: ${v.track_name}`);
        return;
      }
      const isNew = !this.negotiator.pulledTracks.some(t => t.track_name === v.track_name);
      if (isNew) {
        const offeredTrack = { session_id: v.session_id, track_name: v.track_name, kind: v.kind, participant_id: v.participant_id };
        // Ensure pull PC is alive — if dead (e.g. after sentinel reset), recreate
        const pullState = this.negotiator.pullPC?.iceConnectionState;
        const pullUsable = pullState === "connected" || pullState === "completed" || pullState === "new" || pullState === "checking";
        if (!pullUsable || !this.negotiator.pullPC) {
          sfuLog.warn(`track-offered: Pull PC unusable (state=${pullState ?? 'null'}) — recreating before pull`);
          this.resetPullAndRepull([...this.negotiator.pulledTracks, offeredTrack]);
          return;
        }
        this.pullTracks([offeredTrack]);
      }
    });

    this.voiceGW.on("stop-tracks", (st) => this.handleStopTracks(st.track_names));

    this.voiceGW.on("kicked", () => {
      sfuLog.warn("Kicked from VoiceGateway (replaced by new connection). Leaving room.");
      this.disconnect();
      this.emit("kicked", undefined as never);
    });

    this.voiceGW.on("disconnected", () => {
      this.cancelPendingSignalWaiters();
      this.pcReadyPromise = new Promise(r => this.pcReadyResolve = r);
      this.voiceReadyPromise = new Promise(r => this.voiceReadyResolve = r);

      // Fix 1 (P0): Serialized reconnect — wait for VoiceGW to re-identify
      // before resetting any sessions. This prevents the triple-reset storm
      // that killed audio in v5/v6 overnight calls.
      if (!this.isLeaving) {
        this.handleVoiceGWReconnectRecovery();
      }
    });
  }

  private handleStopTracks(trackNames: string[]) {
    // Capture track info before removing
    const toRemove = this.negotiator.pulledTracks.filter(t => trackNames.includes(t.track_name));

    // 1. Remove from local list
    this.negotiator.pulledTracks = this.negotiator.pulledTracks.filter(t => !trackNames.includes(t.track_name));

    // 2. Tear down WebRTC receiver mappings
    for (const trackInfo of toRemove) {
      const mid = trackInfo.mid;
      if (mid) {
        const transceiver = this.negotiator.pullPC?.getTransceivers().find(t => t.mid === mid);
        if (transceiver?.receiver?.track) {
          transceiver.receiver.track.stop();
          // Emit removal
          this.emit("remote-track", {
            participantId: trackInfo.participant_id,
            track: transceiver.receiver.track,
            trackInfo,
            action: "remove"
          });
        }
        this.emittedMids.delete(mid);
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────

  public connect(name: string, avatarUrl?: string, clerkUserId?: string) {
    this.isLeaving = false;
    this.connectArgs = { name, avatarUrl, clerkUserId };
    this.pcReadyPromise = new Promise(r => this.pcReadyResolve = r);
    this.voiceReadyPromise = new Promise(r => this.voiceReadyResolve = r);

    this.roomGW.connectRoom({
      name,
      avatarUrl,
      clerkUserId,
      roomSlug: this.roomSlug,
      wsUrlGenerator: wsUrl
    });
  }

  private applyIceServers(iceServers: IceServer[]) {
    this.iceServers = iceServers;
    const config = { iceServers: this.iceServers };

    for (const pc of [this.negotiator.camPushPC, this.negotiator.screenPushPC, this.negotiator.pullPC]) {
      if (!pc || pc.signalingState === "closed") continue;
      try {
        pc.setConfiguration(config);
      } catch (err) {
        sfuLog.warn("Failed to apply refreshed ICE servers to PeerConnection", err);
      }
    }
  }

  private scheduleCredentialRefresh() {
    this.clearCredentialRefreshTimer();
    if (this.isLeaving) return;

    this.credentialRefreshTimer = setTimeout(() => {
      this.credentialRefreshTimer = null;
      if (this.isLeaving) return;

      sfuLog.info("Refreshing voice token and TURN credentials without reconnecting RoomGW");
      if (this.roomGW.isReady) {
        this.roomGW.requestCredentialRefresh();
      } else {
        this.roomGW.forceReconnect();
      }
      this.scheduleCredentialRefresh();
    }, CREDENTIAL_REFRESH_MS);
  }

  public refreshVoiceCredentials() {
    if (this.isLeaving) return;
    if (this.roomGW.isReady) {
      sfuLog.info("Requesting fresh voice token and TURN credentials over existing RoomGW");
      this.roomGW.requestCredentialRefresh();
    } else {
      sfuLog.warn("RoomGW is not ready; reconnecting to refresh voice credentials");
      this.roomGW.forceReconnect();
    }
  }

  private clearCredentialRefreshTimer() {
    if (this.credentialRefreshTimer) {
      clearTimeout(this.credentialRefreshTimer);
      this.credentialRefreshTimer = null;
    }
  }

  private connectVoice() {
    if (!this.participantId || !this.voiceToken) return;
    this.voiceGW.connectVoice(this.participantId, this.voiceToken, this.roomSlug, wsUrl);
  }

  private uniqueTrackList(tracks: TrackInfo[]) {
    const seen = new Set<string>();
    const unique: TrackInfo[] = [];
    for (const track of tracks) {
      if (track.participant_id === this.participantId) continue;
      if (this.unsubscribedTrackNames.has(track.track_name)) continue;
      if (seen.has(track.track_name)) continue;
      seen.add(track.track_name);
      unique.push(track);
    }
    return unique;
  }

  private hasRecentlySpeakingRemote() {
    const now = Date.now();
    for (const [participantId, until] of this.remoteSpeakingUntil) {
      if (until > now) return true;
      this.remoteSpeakingUntil.delete(participantId);
    }
    return false;
  }

  private shouldPullServerTrack(track: TrackInfo) {
    const existing = this.negotiator.pulledTracks.find((pt) => pt.track_name === track.track_name);
    if (!existing) return true;
    return !!(track.session_id && existing.session_id && track.session_id !== existing.session_id);
  }

  private hasLivePullReceiver(track: TrackInfo) {
    if (!this.negotiator.pullPC || !track.mid) return false;
    const transceiver = this.negotiator.pullPC.getTransceivers().find((t) => t.mid === track.mid);
    const receiverTrack = transceiver?.receiver?.track;
    return !!receiverTrack && receiverTrack.readyState !== "ended";
  }

  private resetServerPullSession() {
    if (!this.voiceGW.isReady || this.isLeaving) return;
    this.voiceGW.send({ op: VoiceOpcode.ResetPullSession, d: {} });
  }

  private resetPullAndRepull(tracksToRestore: TrackInfo[]) {
    const tracks = this.uniqueTrackList(tracksToRestore);
    this.resetServerPullSession();
    this.pullEpoch++;
    this.rtcSessionManager.resetPullSession(this.isLeaving, () => this.connectVoice());
    this.createPeerConnections();
    if (tracks.length > 0) this.pullTracks(tracks);
  }

  public disconnect() {
    this.isLeaving = true;
    this.clearCredentialRefreshTimer();
    this.rtcSessionManager.clearAllDisconnectTimers();

    this.roomGW.send({ op: VoiceOpcode.ClientDisconnect, d: {} });
    this.voiceGW.send({ op: VoiceOpcode.ClientDisconnect, d: {} });

    this.roomGW.disconnect();
    this.voiceGW.disconnect();

    this.rtcSessionManager.safelyClosePC(this.negotiator.camPushPC);
    this.negotiator.camPushPC = null;
    this.rtcSessionManager.safelyClosePC(this.negotiator.screenPushPC);
    this.negotiator.screenPushPC = null;
    this.rtcSessionManager.safelyClosePC(this.negotiator.pullPC);
    this.negotiator.pullPC = null;

    this.vad.stop();
    this.audioSentinel.stop();
    this.stats.stopStatsMonitoring();
    this.stats.stopConnectionStatsMonitoring();

    this.negotiator.resetPushSession('cam');
    this.negotiator.resetPushSession('screen');
    this.negotiator.resetPullSession();
  }

  public getConnectionState() {
    if (this.isLeaving) return "disconnected";

    if (!this.roomGW.isReady && !this.voiceGW.isReady) return "connecting";

    const pushState = this.negotiator.camPushPC?.connectionState || "disconnected";
    const pullState = this.negotiator.pullPC?.connectionState || "disconnected";

    if (pushState === "failed" || pullState === "failed") return "failed";
    if (pushState === "disconnected" || pullState === "disconnected") return "disconnected";
    if (pushState === "connected" && pullState === "connected" && this.roomGW.isReady && this.voiceGW.isReady) return "connected";

    return "connecting";
  }

  public sendChatMessage(content: string) {
    this.roomGW.send({
      op: VoiceOpcode.MessageCreate,
      d: { channel_id: this.roomSlug, content, nonce: String(Math.random()) }
    });
  }

  public sendVoiceState(state: any) {
    this.roomGW.sendVoiceState(state);
  }

  public sendMuteUpdate(isMicOn: boolean, isCameraOn: boolean) {
    this.roomGW.sendMuteUpdate(isMicOn, isCameraOn);
  }

  public sendSpeaking(speaking: number) {
    this.voiceGW.send({ op: VoiceOpcode.Speaking, d: { speaking } });
  }

  public setParticipantVolume(participantId: string, volume: number) {
    this.audio.setParticipantVolume(participantId, volume);
  }

  public setTrackVolume(participantId: string, trackName: string, volume: number) {
    this.audio.setTrackVolume(participantId, trackName, volume);
  }

  public setParticipantPan(participantId: string, pan: number) {
    this.audio.setParticipantPan(participantId, pan);
  }

  public setTrackPan(participantId: string, trackName: string, pan: number) {
    this.audio.setTrackPan(participantId, trackName, pan);
  }

  public applyVolumeToTrack(pId: string, track: MediaStreamTrack, name: string) {
    return this.audio.applyVolumeToTrack(pId, track, name);
  }

  public resumeAudioContext() {
    this.audio.resumeAudioContext();
  }

  public setRemoteTrackSubscription(participantId: string, trackName: string, subscribe: boolean, rid?: string) {
    if (subscribe) {
      this.unsubscribedTrackNames.delete(trackName);
      if (rid) this.trackRids.set(trackName, rid);
    } else {
      this.unsubscribedTrackNames.add(trackName);
      // Wait for 1 second before doing full stop tracks to allow for double-renders
      setTimeout(() => {
        if (this.unsubscribedTrackNames.has(trackName)) { // Still unsubscribed?
          const track = this.negotiator.pulledTracks.find(t => t.track_name === trackName);
          if (track) {
            this.voiceGW.send({ op: VoiceOpcode.StopTracks, d: { track_names: [trackName] } });
            this.handleStopTracks([trackName]);
          }
        }
      }, 1000);
    }
  }

  public unpublishTrack(trackName: string) {
    this.negotiator.unpublishTrack(trackName);
  }

  public async publishTracks(stream: MediaStream, prefix: string) {
    if (!this.voiceGW.isReady) {
      sfuLog.warn(`VoiceGW not ready, waiting to publish ${prefix} tracks...`);
      await this.voiceReadyPromise;
    }
    await this.negotiator.publishTracks(stream, prefix);
    if (prefix === 'cam') {
      this.vad.start(stream);
      this.stats.startStatsMonitoring();
      this.stats.startConnectionStatsMonitoring();
    }
  }

  public async pullTracks(tracks: TrackInfo[]) {
    // Deduplicate
    const unique = [];
    const seen = new Set();
    for (const t of tracks) {
      if (!seen.has(t.track_name)) {
        unique.push(t);
        seen.add(t.track_name);
      }
    }

    // Filter unsubscribed etc
    const toPull = unique.filter(t => !this.unsubscribedTrackNames.has(t.track_name));
    if (toPull.length === 0) return;

    if (!this.voiceGW.isReady) {
      sfuLog.warn(`VoiceGW not ready, queueing ${toPull.length} tracks to pull...`);
      this.pendingPullTracks.push(...toPull);
      return;
    }

    this.pullQueue = this.pullQueue.then(async () => {
      const epoch = this.pullEpoch;
      if (this.negotiator.pullPC && this.negotiator.pullPC.signalingState !== "stable") {
        sfuLog.warn(`pullTracks: signaling state is '${this.negotiator.pullPC.signalingState}', deferring ${toPull.length} tracks`);
        this.pendingPullTracks.push(...toPull);
        return;
      }

      const allTracks = [...this.pendingPullTracks, ...toPull];
      this.pendingPullTracks = [];

      const newTracks = allTracks.filter((nt) => {
        const existing = this.negotiator.pulledTracks.find((pt) => pt.track_name === nt.track_name);
        if (!existing) return true;
        if (nt.session_id && existing.session_id && nt.session_id !== existing.session_id) {
          this.negotiator.pulledTracks = this.negotiator.pulledTracks.filter(t => t !== existing);
          if (existing.mid) this.emittedMids.delete(existing.mid);
          return true;
        }
        return false;
      });

      this.negotiator.pulledTracks.push(...newTracks);

      if (newTracks.length === 0) return;

      const pullTracksPayload = newTracks.map(t => {
        const explicitRid = t.rid || this.trackRids.get(t.track_name);
        const defaultRid = t.track_name.startsWith("cam-video-") ? "h" : undefined;
        return {
          participant_id: t.participant_id,
          track_name: t.track_name,
          session_id: t.session_id,
          kind: t.kind,
          rid: explicitRid || defaultRid,
        };
      });

      this.stats.startStatsMonitoring();
      sfuLog.info(`Requesting SFU tracks (new only): ${newTracks.map(t => t.track_name).join(", ")}`);

      try {
        const negotiationDonePromise = this.waitForPullNegotiationDone(10000);
        const offerPromise = this.waitForPullOffer(10000);

        negotiationDonePromise.catch(() => { });
        offerPromise.catch(() => { });

        this.voiceGW.send({
          op: VoiceOpcode.SelectProtocol,
          d: {
            push_tracks: [],
            pull_tracks: pullTracksPayload,
          },
        });

        await offerPromise;
        await negotiationDonePromise;
      } catch (err: any) {
        if (err.message && err.message.startsWith("pull-retry:")) {
          try {
            const trackNames: string[] = JSON.parse(err.message.split("pull-retry:")[1]);
            sfuLog.warn(`SFU returned empty_track_error. Retrying pull in 1s for: ${trackNames.join(", ")}`);
            setTimeout(() => {
              if (!this.isLeaving) {
                const tracksToRetry = this.negotiator.pulledTracks.filter(t => trackNames.includes(t.track_name));
                if (tracksToRetry.length > 0) {
                  this.negotiator.pulledTracks = this.negotiator.pulledTracks.filter(t => !trackNames.includes(t.track_name));
                  this.pullTracks(tracksToRetry);
                }
              }
            }, 1000);
          } catch (e) {
            sfuLog.error("Error parsing pull-retry in catch block", e);
          }
        } else {
          sfuLog.error("pullTracks error:", err);
          if (this.pullEpoch === epoch) {
            const tracksToRestore = [...this.negotiator.pulledTracks];
            this.resetPullAndRepull(tracksToRestore);
          }
        }
      }
    });
  }

  // --- PC wiring methods ---
  private createPeerConnections() {
    const config = { iceServers: this.iceServers };

    // Cam Push
    if (!this.negotiator.camPushPC) {
      this.negotiator.camPushPC = new RTCPeerConnection(config);
      this.wireCamPushHandlers();
    }

    // Screen Push (Lazy)
    // Left empty here purposefully; triggered by 'create-screen-pc' event

    // Pull
    if (!this.negotiator.pullPC) {
      this.negotiator.pullPC = new RTCPeerConnection(config);
      this.audioSentinel.start();

      this.negotiator.pullPC.oniceconnectionstatechange = () => {
        const state = this.negotiator.pullPC?.iceConnectionState;
        if (state === "connected" || state === "completed") {
          this.rtcSessionManager.clearDisconnectTimer("pull");
        } else if (state === "disconnected") {
          this.rtcSessionManager.handleDisconnectGraceTimer("pull", this.isLeaving, () => {
            const tracksToRestore = [...this.negotiator.pulledTracks];
            this.resetPullAndRepull(tracksToRestore);
          });
        } else if (state === "failed") {
          const tracksToRestore = [...this.negotiator.pulledTracks];
          this.resetPullAndRepull(tracksToRestore);
        }
      };

      this.negotiator.pullPC.onconnectionstatechange = () => {
        const state = this.negotiator.pullPC?.connectionState;
        if (state === "connected") {
          this.rtcSessionManager.clearDisconnectTimer("pull");
        } else if (state === "disconnected") {
          this.rtcSessionManager.handleDisconnectGraceTimer("pull", this.isLeaving, () => {
            const tracksToRestore = [...this.negotiator.pulledTracks];
            this.resetPullAndRepull(tracksToRestore);
          });
        } else if (state === "failed") {
          const tracksToRestore = [...this.negotiator.pulledTracks];
          this.resetPullAndRepull(tracksToRestore);
        }
      };

      this.negotiator.pullPC.ontrack = (event) => {
        const t = event.track;
        const mid = event.transceiver.mid;

        // Use a timeout to wait for SDP metadata propagation if not immediately available
        const attemptFire = (attempts = 0) => {
          const info = mid ? this.negotiator.pulledTracks.find(t => t.mid === mid) : undefined;
          if (info) {
            this.emittedMids.add(mid!);
            this.emit("remote-track", { participantId: info.participant_id, track: t, trackInfo: info, action: "add" } as any);
          } else if (attempts < 10) {
            setTimeout(() => attemptFire(attempts + 1), 100);
          }
        };
        attemptFire();
      };
    }
  }

  private createScreenPushPC() {
    this.negotiator.screenPushPC = new RTCPeerConnection({ iceServers: this.iceServers });
    this.negotiator.screenPushPC.oniceconnectionstatechange = () => {
      const state = this.negotiator.screenPushPC?.iceConnectionState;
      if (state === "connected" || state === "completed") {
        this.rtcSessionManager.clearDisconnectTimer("screenPush");
      } else if (state === "disconnected") {
        this.rtcSessionManager.handleDisconnectGraceTimer("screenPush", this.isLeaving, () => this.resetScreenPush());
      } else if (state === "failed") {
        this.resetScreenPush();
      }
    };
    this.negotiator.screenPushPC.onconnectionstatechange = () => {
      const state = this.negotiator.screenPushPC?.connectionState;
      if (state === "connected") {
        this.rtcSessionManager.clearDisconnectTimer("screenPush");
      } else if (state === "disconnected") {
        this.rtcSessionManager.handleDisconnectGraceTimer("screenPush", this.isLeaving, () => this.resetScreenPush());
      } else if (state === "failed") {
        this.resetScreenPush();
      }
    };
  }

  // ── Orchestration Methods ───────────────────────────────────────────────

  public async replaceTrack(trackName: string, newTrack: MediaStreamTrack | null) {
    const pc = trackName.startsWith('screen-') ? this.negotiator.screenPushPC : this.negotiator.camPushPC;
    if (!pc) return;

    const transceiver = this.negotiator.getPushTransceiver(trackName);
    if (transceiver) {
      await transceiver.sender.replaceTrack(newTrack);
    }
  }

  public async updateSenderEncoding(trackName: string, encoding: Partial<RTCRtpEncodingParameters>) {
    const transceiver = this.negotiator.getPushTransceiver(trackName);
    if (!transceiver) return;

    const parameters = transceiver.sender.getParameters();
    parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
    parameters.encodings = parameters.encodings.map((current) => ({
      ...current,
      ...encoding,
    }));
    (parameters as any).degradationPreference = trackName.startsWith("screen-")
      ? "maintain-resolution"
      : (parameters as any).degradationPreference;

    await transceiver.sender.setParameters(parameters);
  }

  public stopTracks(trackNames: string[]) {
    for (const name of trackNames) {
      this.negotiator.teardownTransceiver(name);
    }

    this.voiceGW.send({
      op: VoiceOpcode.StopTracks,
      d: { track_names: trackNames },
    });

    const allScreen = trackNames.every(n => n.startsWith('screen-'));
    if (allScreen) {
      const pcToClose = this.negotiator.screenPushPC;
      setTimeout(() => {
        if (this.negotiator.screenPushPC === pcToClose) {
          this.negotiator.closeScreenPushPC();
        }
      }, 500);
    }

    this.emit("tracks-stopped", { participantId: this.participantId ?? "", trackNames });
  }

  public createTrueStereoStream(stream: MediaStream): MediaStream {
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return stream;
    return this.audio.createTrueStereoStream(audioTrack);
  }

  private wireCamPushHandlers() {
    if (!this.negotiator.camPushPC) return;
    this.negotiator.camPushPC.oniceconnectionstatechange = () => {
      const state = this.negotiator.camPushPC?.iceConnectionState;
      if (state === "connected" || state === "completed") {
        this.rtcSessionManager.clearDisconnectTimer("camPush");
      } else if (state === "disconnected") {
        this.rtcSessionManager.handleDisconnectGraceTimer("camPush", this.isLeaving, () => this.resetCamPush());
      } else if (state === "failed") {
        this.resetCamPush();
      }
    };
    this.negotiator.camPushPC.onconnectionstatechange = () => {
      const state = this.negotiator.camPushPC?.connectionState;
      if (state === "connected") {
        this.rtcSessionManager.clearDisconnectTimer("camPush");
      } else if (state === "disconnected") {
        this.rtcSessionManager.handleDisconnectGraceTimer("camPush", this.isLeaving, () => this.resetCamPush());
      } else if (state === "failed") {
        this.resetCamPush();
      }
    };
  }

  // ── Zero-Interruption Recovery Coordinator ────────────────────────────
  // CRITICAL PRINCIPLE: WebRTC media (UDP/DTLS/SRTP) is completely
  // independent from the signaling WebSocket. A signaling WS disconnect
  // should NEVER trigger PeerConnection teardown. The audio keeps flowing
  // over UDP while we silently re-establish the signaling channel.
  //
  // Only touch PeerConnections when:
  // 1. The PeerConnection itself reports ICE failure (checked via iceConnectionState)
  // 2. The SFU garbage-collects tracks after 30s of inactivity (won't happen for active audio)
  // 3. We need to add/remove tracks (new participant events)
  private handleVoiceGWReconnectRecovery() {
    if (this.reconnectRecoveryPromise) {
      sfuLog.info("VoiceGW recovery already in progress, joining existing recovery");
      return this.reconnectRecoveryPromise;
    }

    this.reconnectRecoveryPromise = this.runVoiceGWReconnectRecovery()
      .finally(() => {
        this.reconnectRecoveryPromise = null;
      });

    return this.reconnectRecoveryPromise;
  }

  private async runVoiceGWReconnectRecovery() {
    const RECOVERY_TIMEOUT_MS = 30_000; // give backoff more time since audio is still flowing

    sfuLog.info("VoiceGW signaling lost — audio continues on UDP, waiting for WS re-identify...");

    // Check if PeerConnections are actually alive
    const camPCAlive = this.negotiator.camPushPC?.iceConnectionState === "connected" ||
      this.negotiator.camPushPC?.iceConnectionState === "completed";
    const pullPCAlive = this.negotiator.pullPC?.iceConnectionState === "connected" ||
      this.negotiator.pullPC?.iceConnectionState === "completed";

    if (camPCAlive || pullPCAlive) {
      sfuLog.info(`PeerConnections still alive (push=${camPCAlive}, pull=${pullPCAlive}) — zero-interruption recovery`);
    }

    try {
      await Promise.race([
        this.voiceReadyPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("VoiceGW re-identify timeout")), RECOVERY_TIMEOUT_MS)
        ),
      ]);
    } catch {
      if (this.isLeaving) return;

      sfuLog.warn("VoiceGW failed to re-identify within 30s — forcing fresh token via RoomGW cycle");

      // Force RoomGW cycle to get fresh token — but DO NOT tear down PeerConnections!
      // The PCs may still be alive and flowing audio.
      this.voiceGW.forceReconnect();
      this.roomGW.forceReconnect();
      return;
    }

    // VoiceGW re-identified successfully!
    if (this.isLeaving) return;
    sfuLog.info("VoiceGW signaling restored — checking if PCs need recovery...");

    // Check both push AND pull PeerConnections independently
    const camPCStillAlive = this.negotiator.camPushPC?.iceConnectionState === "connected" ||
      this.negotiator.camPushPC?.iceConnectionState === "completed";
    const pullPCStillAlive = this.negotiator.pullPC?.iceConnectionState === "connected" ||
      this.negotiator.pullPC?.iceConnectionState === "completed";

    if (!camPCStillAlive && this.negotiator.camPushPC) {
      sfuLog.warn("Cam PeerConnection died during WS outage — closing stale PC and creating fresh one");
      try { this.negotiator.camPushPC.close(); } catch { }
      // CRITICAL: Clear old transceivers/publishedTrackNames/sessionId so publishTracks()
      // creates fresh transceivers on the new PC instead of reusing dead ones.
      this.negotiator.resetPushSession('cam');
      this.negotiator.camPushPC = null;
      this.createPeerConnections();
      this.emit("voice-reconnected", undefined as never);
    } else if (!this.negotiator.camPushPC) {
      sfuLog.warn("Cam PeerConnection is null — creating fresh PC and triggering re-publish");
      this.negotiator.resetPushSession('cam');
      this.createPeerConnections();
      this.emit("voice-reconnected", undefined as never);
    } else {
      sfuLog.info("Push PC survived WS outage — outbound audio uninterrupted ✓");
    }

    if (!pullPCStillAlive) {
      sfuLog.info(`Pull PC is dead (state=${this.negotiator.pullPC?.iceConnectionState ?? 'null'}) — voice-ready handler will recreate and re-pull`);
      // NOTE: Pull PC recreation is handled by the voice-ready handler (which runs
      // BEFORE this code since it resolves the voiceReadyPromise we just awaited).
      // Do NOT recreate here — voice-ready already did it and called pullTracks().
    } else {
      sfuLog.info("Pull PC survived WS outage — inbound audio uninterrupted ✓");
    }
  }

  private resetCamPush() {
    this.rtcSessionManager.resetPushSession(
      false,
      this.isLeaving,
      () => this.connectVoice(),
      () => {
        this.createPeerConnections();
        this.emit("voice-reconnected", undefined as never);
      }
    );
  }

  private resetScreenPush() {
    this.rtcSessionManager.resetPushSession(
      true,
      this.isLeaving,
      () => this.connectVoice(),
      () => {
        this.createScreenPushPC();
        this.emit("voice-reconnected", undefined as never);
      }
    );
  }

  private get RTCWaiters(): Set<{ resolve: (d?: any) => void; reject: (e: any) => void }> {
    return (this.negotiator as any).waiters || new Set();
  }

  private cancelPendingSignalWaiters() {
    const closedErr = new Error("WS_CLOSED");
    this.rejectPendingSignalWaiters(closedErr);
    for (const w of this.RTCWaiters) {
      w.reject(closedErr);
    }
    this.RTCWaiters.clear();
  }

  private rejectPendingSignalWaiters(reason: any) {
    if (this.camPushRejector) {
      const reject = this.camPushRejector;
      this.camPushRejector = null;
      this.camPushResolver = null;
      reject(reason);
    }
    if (this.screenPushRejector) {
      const reject = this.screenPushRejector;
      this.screenPushRejector = null;
      this.screenPushResolver = null;
      reject(reason);
    }
    if (this.pullRejector) {
      const reject = this.pullRejector;
      this.pullRejector = null;
      this.pullResolver = null;
      reject(reason);
    }
    if (this.pullNegotiationRejector) {
      const reject = this.pullNegotiationRejector;
      this.pullNegotiationRejector = null;
      this.pullNegotiationResolve = null;
      reject(reason);
    }
  }

  private waitForSignal(
    setter: (resolve: () => void, reject?: (reason?: any) => void) => void,
    timeoutMs: number,
    label: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let isDone = false;

      const timeoutId = setTimeout(() => {
        if (!isDone) {
          sfuLog.warn(`${label} timed out after ${timeoutMs}ms`);
          this.emit("error", { message: `${label} timed out` });
          wrappedReject(new Error(`${label} timed out`));
        }
      }, timeoutMs);

      const wrappedResolve = () => {
        if (!isDone) { isDone = true; clearTimeout(timeoutId); resolve(); }
      };
      const wrappedReject = (reason: any) => {
        if (!isDone) { isDone = true; clearTimeout(timeoutId); reject(reason); }
      };

      setter(wrappedResolve, wrappedReject);
    });
  }

  private waitForPushAnswer(prefix: 'cam' | 'screen' = 'cam', timeoutMs = 10000) {
    if (prefix === 'screen') {
      return this.waitForSignal((res, rej) => {
        this.screenPushResolver = res;
        this.screenPushRejector = rej || null;
      }, timeoutMs, "Screen Push SDP Answer");
    }
    return this.waitForSignal((res, rej) => {
      this.camPushResolver = res;
      this.camPushRejector = rej || null;
    }, timeoutMs, "Cam Push SDP Answer");
  }

  private waitForPullOffer(timeoutMs = 10000) {
    return this.waitForSignal((res, rej) => {
      this.pullResolver = res;
      this.pullRejector = rej || null;
    }, timeoutMs, "Pull SDP Offer");
  }

  private async waitForPushNegotiationDone(prefix: 'cam' | 'screen' = 'cam', timeoutMs = 10000) {
    if (prefix === 'screen') {
      return this.waitForSignal((res) => { this.screenPushNegotiationResolve = res; }, timeoutMs, "Screen Push Negotiation Done");
    }
    return this.waitForSignal((res) => { this.camPushNegotiationResolve = res; }, timeoutMs, "Cam Push Negotiation Done");
  }

  private async waitForPullNegotiationDone(timeoutMs = 10000) {
    return this.waitForSignal((res, rej) => {
      this.pullNegotiationResolve = res;
      this.pullNegotiationRejector = rej || null;
    }, timeoutMs, "Pull Negotiation Done");
  }

  public getDebugData() {
    return this.stats.getDebugData();
  }

  public getDetailedStats() {
    return this.stats.getDetailedStats();
  }

  public getStatsByClerkId(clerkId: string, trackPrefix: 'cam' | 'screen') {
    return this.stats.getStatsByClerkId(clerkId, trackPrefix);
  }

  public setClerkMapping(participantId: string, clerkId: string) {
    this.stats.setClerkMapping(participantId, clerkId);
  }

  public deleteClerkMapping(participantId: string) {
    this.stats.deleteClerkMapping(participantId);
  }

  public subscribeConnectionStats(cb: (stats: VoiceConnectionStats) => void) {
    return this.stats.subscribeConnectionStats(cb);
  }
}
