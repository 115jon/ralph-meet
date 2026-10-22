import { clog } from "./console-logger";
import { TypedEventEmitter } from "./event-emitter";
import { wsUrl } from "./platform";
import {
  VoiceOpcode,
  type IceServer,
  type SFUEventMap,
  type TrackInfo,
  type VoiceConnectionStats,
} from "./types";
import { AudioPipeline } from "./voice/audio-pipeline";
import { AudioSentinel, OutboundAudioSentinel } from "./voice/audio-sentinel";
import { RoomGateway } from "./voice/gateways/room-gateway";
import { VoiceGateway } from "./voice/gateways/voice-gateway";
import {
  NativeScreenShareTransport,
  type NativeScreenShareOptions,
} from "./voice/native-screen-share-transport";
import {
  PartyTracksMediaManager,
  type PartyTracksMediaTransport,
} from "./voice/partytracks-media-manager";
import {
  PartyTracksTransport,
  type PartyTracksTransportCredentials,
} from "./voice/partytracks-transport";
import { ConnectionStatsMonitor } from "./voice/stats-monitor";
import { VoiceActivityDetector } from "./voice/vad";
import type { Observable, Subscription } from "rxjs";

const sfuLog = clog("SFU");
const CREDENTIAL_REFRESH_MS = 45 * 60 * 1000;

export type { SFUEventMap, VoiceConnectionStats } from "./types";

export type SFUDisconnectReason =
  | "component-unmount"
  | "forced-disconnect"
  | "user-leave"
  | "voice-gateway-kicked"
  | "unknown";

export interface PartyTracksClientTransport extends PartyTracksMediaTransport {
  readonly peerConnection$: Observable<RTCPeerConnection>;
  readonly session$?: Observable<{
    peerConnection: RTCPeerConnection;
    sessionId: string;
  }>;
  updateVoiceToken(voiceToken: string): void;
  updateIceServers(iceServers: IceServer[]): void;
  dispose(): void;
}

export interface SFUClientOptions {
  createPartyTracksTransport?: (
    credentials: PartyTracksTransportCredentials,
  ) => PartyTracksClientTransport;
}

interface ConnectArguments {
  name: string;
  avatarUrl?: string;
  channelId?: string;
  clerkUserId?: string;
  serverId?: string;
  username?: string;
  displayName?: string | null;
  avatarDisplay?: import("@/lib/avatar-display").AvatarDisplay | string | null;
}

/**
 * Coordinates Ralph's metadata gateways with its media transports.
 *
 * Browser microphone, camera, screen, and remote media have one owner:
 * PartyTracksMediaManager. Native Rust screen capture is isolated behind
 * NativeScreenShareTransport because it still exchanges SDP with VoiceGW.
 */
export class SFUClient extends TypedEventEmitter<SFUEventMap> {
  public readonly roomGW: RoomGateway;
  public readonly voiceGW: VoiceGateway;
  public readonly vad: VoiceActivityDetector;
  public readonly audio: AudioPipeline;
  public readonly stats: ConnectionStatsMonitor;
  public readonly audioSentinel: AudioSentinel;
  public readonly outboundAudioSentinel: OutboundAudioSentinel;

  private readonly createPartyTracksTransport: (
    credentials: PartyTracksTransportCredentials,
  ) => PartyTracksClientTransport;
  private readonly nativeScreenShare: NativeScreenShareTransport;
  private roomSlug: string;
  private participantId: string | null = null;
  private roomParticipantEstablished = false;
  private voiceToken: string | null = null;
  private iceServers: IceServer[] = [];
  private connectArgs: ConnectArguments | null = null;
  private partyTracksTransport: PartyTracksClientTransport | null = null;
  private partyTracksMedia: PartyTracksMediaManager | null = null;
  private partyTracksParticipantId: string | null = null;
  private partyTracksPeerConnection: RTCPeerConnection | null = null;
  private partyTracksPeerConnectionSubscription: Subscription | null = null;
  private partyTracksSessionSubscription: Subscription | null = null;
  private isLeaving = false;
  private credentialRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private voiceReadyPromise: Promise<void> = Promise.resolve();
  private voiceReadyResolve: (() => void) | null = null;
  private voiceReadyReject: ((reason?: unknown) => void) | null = null;
  private partyTracksReadyPromise: Promise<void> = Promise.resolve();
  private partyTracksReadyResolve: (() => void) | null = null;
  private partyTracksReadyReject: ((reason?: unknown) => void) | null = null;
  private nativeScreenReconnectRequired = false;
  private nativeScreenResetPromise: Promise<void> = Promise.resolve();
  private remoteSpeakingUntil = new Map<string, number>();
  private audioTrackOperation: Promise<void> = Promise.resolve();
  private latencyTimeline: {
    timelineId: string;
    joinStartedAt: number;
    firstByMilestone: Partial<Record<string, number>>;
  } = {
    timelineId: "unstarted",
    joinStartedAt: 0,
    firstByMilestone: {},
  };

  constructor(roomSlug: string, options: SFUClientOptions = {}) {
    super();
    this.roomSlug = roomSlug;
    this.createPartyTracksTransport =
      options.createPartyTracksTransport ??
      ((credentials) => new PartyTracksTransport(credentials));

    this.roomGW = new RoomGateway();
    this.voiceGW = new VoiceGateway();
    this.nativeScreenShare = new NativeScreenShareTransport({
      gateway: this.voiceGW,
      getIceServers: () => this.iceServers,
      getParticipantId: () => this.participantId,
      isVoiceReady: () => this.voiceGW.isReady,
      waitForVoiceReady: () => this.voiceReadyPromise,
    });

    this.vad = new VoiceActivityDetector({
      onSpeakingChange: (isSpeaking, flags) => {
        if (!this.participantId) return;
        this.emit("vad-speaking", {
          participantId: this.participantId,
          isSpeaking,
        });
        this.emit("speaking", {
          participantId: this.participantId,
          speaking: flags,
        });
      },
      onAudioStalled: (isStalled) => {
        this.emit("audio-stalled", isStalled);
      },
      sendSpeaking: (flags) => this.sendSpeaking(flags),
      getParticipantId: () => this.participantId,
    });

    this.audio = new AudioPipeline({
      onAudioResumed: () => this.emit("audio-resumed", {}),
      onDirectAudioAttached: ({ participantId, trackName }) => {
        this.markLatency("remoteDirectAudioAttachedAt", {
          participantId,
          trackName,
        });
      },
      onAudioGraphConnected: ({ participantId, trackName }) => {
        this.markLatency("remoteGraphConnectedAt", {
          participantId,
          trackName,
        });
      },
      onFirstAudible: ({ rms, preLimiterRms }) => {
        this.markLatency("firstAudibleAt", { rms, preLimiterRms });
      },
      onProbeSample: ({ rms, preLimiterRms, contextState, elapsedMs }) => {
        sfuLog.info("Audio probe sample", {
          timelineId: this.latencyTimeline.timelineId,
          rms,
          preLimiterRms,
          contextState,
          elapsedMs,
        });
      },
    });

    this.stats = new ConnectionStatsMonitor({
      getPushPC: () => this.partyTracksPeerConnection,
      getPullPC: () => this.partyTracksPeerConnection,
      getPulledTracks: () =>
        this.partyTracksMedia?.getRemoteTracksForDiagnostics() ?? [],
      getRoomSlug: () => this.roomSlug,
      getParticipantId: () => this.participantId,
      getConnectionState: () => this.getConnectionState(),
      getPublishConnectionState: () => this.getPublishConnectionState(),
      getSubscribeConnectionState: () => this.getSubscribeConnectionState(),
    });

    this.audioSentinel = new AudioSentinel({
      pc: () => this.partyTracksPeerConnection,
      stallThresholdTicks: 30,
      shouldTreatAsStall: () => this.hasRecentlySpeakingRemote(),
      onStall: () => {
        sfuLog.warn("Inbound PartyTracks audio RTP stalled");
        this.emit("audio-stalled", true);
      },
      onRecover: () => this.emit("audio-stalled", false),
      onFirstRtp: () => this.markLatency("inboundRtpAt"),
    });

    this.outboundAudioSentinel = new OutboundAudioSentinel({
      pc: () => this.partyTracksPeerConnection,
      track: () => {
        if (!this.participantId) return null;
        return (
          this.partyTracksMedia?.getPublishedTrack(
            `cam-audio-${this.participantId}`,
          ) ?? null
        );
      },
      onStall: (diagnostics) => {
        sfuLog.warn("Outbound microphone RTP stalled", diagnostics);
        this.emit("outbound-audio-stalled", true);
      },
      onRecover: () => this.emit("outbound-audio-stalled", false),
      onFirstRtp: () => this.markLatency("outboundRtpAt"),
    });

    this.wireRoomEvents();
    this.wireVoiceEvents();
  }

  private markLatency(
    milestone: string,
    details?: Record<string, unknown>,
  ): void {
    const at = Date.now();
    const firstAt = this.latencyTimeline.firstByMilestone[milestone];
    if (firstAt === undefined) {
      this.latencyTimeline.firstByMilestone[milestone] = at;
    }
    sfuLog.info(`Latency milestone: ${milestone}`, {
      timelineId: this.latencyTimeline.timelineId,
      at,
      first: firstAt === undefined,
      elapsedSinceJoinMs: at - this.latencyTimeline.joinStartedAt,
      elapsedSinceFirstMilestoneMs: firstAt === undefined ? 0 : at - firstAt,
      ...details,
    });
  }

  private resetLatencyTimeline(): void {
    const joinStartedAt = Date.now();
    this.latencyTimeline = {
      timelineId: `${joinStartedAt}-${crypto.randomUUID().slice(0, 8)}`,
      joinStartedAt,
      firstByMilestone: {},
    };
    sfuLog.info("Latency timeline started", {
      timelineId: this.latencyTimeline.timelineId,
      joinStartedAt,
    });
  }

  private wireRoomEvents(): void {
    this.roomGW.on("media-bootstrap", (event) => {
      if (this.isLeaving) return;
      if (
        this.roomParticipantEstablished &&
        this.participantId !== event.participantId
      ) {
        return;
      }
      if (this.isNewParticipantGeneration(event.participantId)) {
        this.resetVoiceReadinessForParticipantChange();
        this.resetMediaSessionsForParticipantChange();
      }
      this.participantId = event.participantId;
      this.voiceToken = event.voiceToken;
      this.ensurePartyTracksMedia(event.participantId, event.voiceToken);
    });

    this.roomGW.on("media-ready", (event) => {
      if (this.isNewParticipantGeneration(event.participantId)) {
        this.resetVoiceReadinessForParticipantChange();
        this.resetMediaSessionsForParticipantChange();
      }
      this.participantId = event.participantId;
      this.roomParticipantEstablished = true;
      this.applyIceServers(event.iceServers);
      this.voiceToken = event.voiceToken;
      this.ensurePartyTracksMedia(
        event.participantId,
        event.voiceToken,
        event.iceServers,
      );
      this.connectVoice();
      sfuLog.info("Media-ready credentials received", {
        participantId: event.participantId,
        iceServerCount: event.iceServers.length,
      });
    });

    this.roomGW.on("ready", (event) => {
      if (this.isNewParticipantGeneration(event.participantId)) {
        this.resetVoiceReadinessForParticipantChange();
        sfuLog.warn(
          `RoomGW created a new participant generation (${this.participantId} -> ${event.participantId}); rebuilding media`,
        );
        this.resetMediaSessionsForParticipantChange();
      }

      this.participantId = event.participantId;
      this.roomParticipantEstablished = true;
      this.applyIceServers(event.iceServers);
      this.voiceToken = event.voiceToken;
      this.ensurePartyTracksMedia(
        event.participantId,
        event.voiceToken,
        event.iceServers,
      );
      this.scheduleCredentialRefresh();
      this.markLatency("roomGatewayReadyAt", {
        source: "RoomGW ready",
        participantId: event.participantId,
      });
      this.emit("joined", {
        participantId: event.participantId,
        iceServers: event.iceServers,
        participants: event.participants,
        spatialAudioState: event.spatialAudioState,
      });
      this.vad.refreshSpeakingState(true);
      this.connectVoice();
    });

    this.roomGW.on("resumed", (event) => {
      if (event.iceServers?.length) this.applyIceServers(event.iceServers);
      if (event.voiceToken) {
        this.voiceToken = event.voiceToken;
        this.voiceGW.updateVoiceToken(event.voiceToken);
        this.partyTracksTransport?.updateVoiceToken(event.voiceToken);
      }
      if (event.participants) {
        this.emit("participants-sync", {
          participants: event.participants,
          spatialAudioState: event.spatialAudioState,
        });
      }
      this.scheduleCredentialRefresh();
      if (!this.voiceGW.isReady) this.connectVoice();
    });

    this.roomGW.on("disconnected", () => {
      if (!this.isLeaving) this.emit("disconnected", undefined as never);
    });
    this.roomGW.on("error", (event) => {
      this.emit("error", { message: event.message });
    });
    this.roomGW.on("participant-joined", (event) => {
      this.emit("participant-joined", event);
    });
    this.roomGW.on("participant-left", (event) => {
      this.audio.removeParticipantVolume(event.participantId);
      this.partyTracksMedia?.removeParticipant(event.participantId);
      this.remoteSpeakingUntil.delete(event.participantId);
      this.emit("participant-left", event);
    });
    this.roomGW.on("voice-state-update", (event) => {
      this.emit("voice-state-update", event);
    });
    this.roomGW.on("profile-update", (event) => {
      this.emit("profile-update", event);
    });
  }

  private wireVoiceEvents(): void {
    this.voiceGW.on("error", (event) => {
      if (event.message === "Voice token expired" || event.code === 4004) {
        sfuLog.warn(
          "Voice token expired; requesting fresh RoomGateway credentials",
        );
        this.emit("voice-token-expired", undefined as never);
        return;
      }
      this.emit("error", { message: event.message });
    });

    this.voiceGW.on("voice-ready", (event) => {
      this.resolveVoiceReadiness();
      this.vad.refreshSpeakingState();

      const remoteTracks = this.uniqueTrackList(event.tracks ?? []);
      const partyTracks = remoteTracks.filter((track) =>
        Boolean(track.sfu_track_name),
      );
      this.warnDroppedLegacyTracks(remoteTracks, "VoiceReady");

      this.emit("voice-ready", { speaking: event.speaking ?? {} });
      // Register local senders before replay pulls enqueue negotiation on the
      // shared PartyTracks session.
      if (this.partyTracksMedia) {
        if (this.partyTracksMedia.hasPublications) {
          this.partyTracksMedia.reannouncePublications();
        } else {
          this.emit("voice-reconnected", undefined as never);
        }
      }

      if (this.partyTracksMedia) {
        this.partyTracksMedia.syncRemoteTracks(partyTracks);
      } else if (partyTracks.length > 0) {
        sfuLog.warn(
          "Ignoring PartyTracks descriptors because media credentials are unavailable",
          { trackCount: partyTracks.length },
        );
      }

      if (this.nativeScreenReconnectRequired) {
        this.nativeScreenReconnectRequired = false;
        void this.nativeScreenResetPromise
          .then(() => this.nativeScreenShare.reconnect())
          .catch((error) => {
            sfuLog.warn("Native screen share reconnect failed", error);
          });
      }
    });

    this.voiceGW.on("app-event", (event) => {
      this.emit("app-event", event);
    });
    this.voiceGW.on("speaking", (event) => {
      if (event.participantId !== this.participantId) {
        if (event.speaking) {
          this.remoteSpeakingUntil.set(
            event.participantId,
            Date.now() + 10_000,
          );
        } else {
          this.remoteSpeakingUntil.delete(event.participantId);
        }
      }
      this.emit("speaking", event);
    });
    this.voiceGW.on("track-offered", (track) => {
      if (
        track.session_id === this.participantId ||
        track.participant_id === this.participantId
      ) {
        return;
      }
      this.offerPartyTracksOrDropLegacy([track], "TrackOffered");
    });
    this.voiceGW.on("stop-tracks", (event) => {
      const partyTrackNames = event.track_names.filter(
        (trackName) =>
          event.tracks?.some(
            (track) =>
              track.track_name === trackName && Boolean(track.sfu_track_name),
          ) || this.partyTracksMedia?.hasRemoteOffer(trackName),
      );
      if (partyTrackNames.length > 0) {
        this.partyTracksMedia?.stopRemoteTracks(partyTrackNames);
      }
      const legacyTrackCount =
        event.track_names.length - partyTrackNames.length;
      if (legacyTrackCount > 0) {
        sfuLog.warn(
          "Ignoring legacy browser StopTracks; PartyTracks metadata is required",
          { trackCount: legacyTrackCount },
        );
      }
    });
    this.voiceGW.on("client-disconnect", ({ participant_id }) => {
      this.remoteSpeakingUntil.delete(participant_id);
      this.emit("speaking", {
        participantId: participant_id,
        speaking: 0,
      });
    });
    this.voiceGW.on("kicked", () => {
      sfuLog.warn("Kicked from VoiceGateway by a replacement connection");
      this.disconnect("voice-gateway-kicked");
      this.emit("kicked", undefined as never);
    });
    this.voiceGW.on("disconnected", () => {
      this.rejectVoiceReadiness(new Error("WS_CLOSED"));
      this.createVoiceReadinessBarrier();
      this.resetNativeScreenForReconnect();
    });
  }

  private isNewParticipantGeneration(participantId: string): boolean {
    return this.participantId !== null && this.participantId !== participantId;
  }

  private createVoiceReadinessBarrier(): void {
    this.voiceReadyPromise = new Promise<void>((resolve, reject) => {
      this.voiceReadyResolve = resolve;
      this.voiceReadyReject = reject;
    });
    void this.voiceReadyPromise.catch(() => undefined);
  }

  private resolveVoiceReadiness(): void {
    this.voiceReadyResolve?.();
    this.voiceReadyResolve = null;
    this.voiceReadyReject = null;
  }

  private rejectVoiceReadiness(reason: Error): void {
    this.voiceReadyReject?.(reason);
    this.voiceReadyResolve = null;
    this.voiceReadyReject = null;
  }

  private resetVoiceReadinessForParticipantChange(): void {
    this.rejectVoiceReadiness(new Error("PARTICIPANT_CHANGED"));
    this.createVoiceReadinessBarrier();
  }

  private createPartyTracksReadinessBarrier(): void {
    this.partyTracksReadyPromise = new Promise<void>((resolve, reject) => {
      this.partyTracksReadyResolve = resolve;
      this.partyTracksReadyReject = reject;
    });
    void this.partyTracksReadyPromise.catch(() => undefined);
  }

  private resolvePartyTracksReadiness(): void {
    this.partyTracksReadyResolve?.();
    this.partyTracksReadyResolve = null;
    this.partyTracksReadyReject = null;
  }

  private rejectPartyTracksReadiness(reason: Error): void {
    this.partyTracksReadyReject?.(reason);
    this.partyTracksReadyResolve = null;
    this.partyTracksReadyReject = null;
  }

  private resetNativeScreenForReconnect(): void {
    if (this.isLeaving || !this.nativeScreenShare.active) return;
    this.nativeScreenReconnectRequired = true;
    this.nativeScreenResetPromise = this.nativeScreenShare
      .reset()
      .catch((error) => {
        sfuLog.warn("Native screen share reset failed", error);
      });
  }

  private resetMediaSessionsForParticipantChange(): void {
    this.rejectPartyTracksReadiness(new Error("PARTICIPANT_CHANGED"));
    this.createPartyTracksReadinessBarrier();
    this.resetNativeScreenForReconnect();
    this.disposePartyTracksMedia();
  }

  private warnDroppedLegacyTracks(tracks: TrackInfo[], source: string): void {
    const trackCount = tracks.filter((track) => !track.sfu_track_name).length;
    if (trackCount === 0) return;
    sfuLog.warn(
      "Ignoring legacy browser track descriptors; PartyTracks metadata is required",
      { source, trackCount },
    );
  }

  private offerPartyTracksOrDropLegacy(
    tracks: TrackInfo[],
    source: string,
  ): void {
    this.warnDroppedLegacyTracks(tracks, source);
    this.partyTracksMedia?.offerTracks(
      tracks.filter((track) => Boolean(track.sfu_track_name)),
    );
  }

  private ensurePartyTracksMedia(
    participantId: string,
    voiceToken: string,
    iceServers?: IceServer[],
  ): void {
    if (
      this.partyTracksMedia &&
      this.partyTracksTransport &&
      this.partyTracksParticipantId === participantId
    ) {
      this.partyTracksTransport.updateVoiceToken(voiceToken);
      if (iceServers) this.partyTracksTransport.updateIceServers(iceServers);
      return;
    }

    this.disposePartyTracksMedia();
    const transport = this.createPartyTracksTransport({
      roomSlug: this.roomSlug,
      participantId,
      voiceToken,
      iceServers,
    });
    this.partyTracksTransport = transport;
    this.partyTracksParticipantId = participantId;
    this.partyTracksPeerConnectionSubscription =
      transport.peerConnection$.subscribe((peerConnection) => {
        this.partyTracksPeerConnection = peerConnection;
        this.markLatency("partyTracksPeerConnectionAvailableAt");
        this.stats.startStatsMonitoring();
        this.stats.startConnectionStatsMonitoring();
        this.audioSentinel.start();
        this.outboundAudioSentinel.start();
      });
    this.partyTracksSessionSubscription =
      transport.session$?.subscribe(({ sessionId }) => {
        this.markLatency("partyTracksSessionCreatedAt", { sessionId });
      }) ?? null;
    this.partyTracksMedia = new PartyTracksMediaManager(
      transport,
      participantId,
      {
        onPublicationMetadata: (track) => {
          this.markLatency("tracksReadySentAt", {
            source: "PartyTracks",
            trackName: track.track_name,
          });
          this.voiceGW.send({
            op: VoiceOpcode.Video,
            d: { tracks: [track] },
          });
        },
        onPublicationStopped: (trackName) => {
          this.voiceGW.send({
            op: VoiceOpcode.StopTracks,
            d: { track_names: [trackName] },
          });
        },
        onRemoteTrack: ({ action, track, trackInfo }) => {
          this.markLatency("remoteTrackReceivedAt", {
            source: "PartyTracks",
            trackName: trackInfo.track_name,
            kind: track.kind,
          });
          this.emit("remote-track", {
            participantId: trackInfo.participant_id,
            track,
            trackInfo,
            action,
          });
        },
        onConnectionState: (state) => {
          this.emit("connection-state", { state });
        },
        onError: (error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          sfuLog.error("PartyTracks media error", error);
          this.emit("error", { message });
        },
        onPushStarted: (trackName, kind) => {
          this.markLatency("pushOfferAt", { trackName, kind });
        },
        onPullStarted: (trackName) => {
          this.markLatency("pullRequestedAt", { trackName });
        },
      },
    );
    this.resolvePartyTracksReadiness();
  }

  private disposePartyTracksMedia(): void {
    this.partyTracksPeerConnectionSubscription?.unsubscribe();
    this.partyTracksPeerConnectionSubscription = null;
    this.partyTracksSessionSubscription?.unsubscribe();
    this.partyTracksSessionSubscription = null;
    this.partyTracksPeerConnection = null;
    this.partyTracksMedia?.dispose();
    this.partyTracksTransport?.dispose();
    this.partyTracksMedia = null;
    this.partyTracksTransport = null;
    this.partyTracksParticipantId = null;
    this.audioSentinel.stop();
    this.outboundAudioSentinel.stop();
    this.stats.stopStatsMonitoring();
    this.stats.stopConnectionStatsMonitoring();
  }

  private applyIceServers(iceServers: IceServer[]): void {
    this.iceServers = iceServers;
    this.partyTracksTransport?.updateIceServers(iceServers);
  }

  private scheduleCredentialRefresh(): void {
    this.clearCredentialRefreshTimer();
    if (this.isLeaving) return;
    this.credentialRefreshTimer = setTimeout(() => {
      this.credentialRefreshTimer = null;
      if (this.isLeaving) return;
      if (this.roomGW.isReady) {
        this.roomGW.requestCredentialRefresh();
      } else {
        this.roomGW.forceReconnect();
      }
      this.scheduleCredentialRefresh();
    }, CREDENTIAL_REFRESH_MS);
  }

  private clearCredentialRefreshTimer(): void {
    if (!this.credentialRefreshTimer) return;
    clearTimeout(this.credentialRefreshTimer);
    this.credentialRefreshTimer = null;
  }

  private connectVoice(): void {
    if (!this.participantId || !this.voiceToken) return;
    this.voiceGW.connectVoice(
      this.participantId,
      this.voiceToken,
      this.roomSlug,
      wsUrl,
      {
        channelId: this.connectArgs?.channelId,
        serverId: this.connectArgs?.serverId,
      },
    );
  }

  private uniqueTrackList(tracks: TrackInfo[]): TrackInfo[] {
    const seen = new Set<string>();
    return tracks.filter((track) => {
      if (track.participant_id === this.participantId) return false;
      if (seen.has(track.track_name)) return false;
      seen.add(track.track_name);
      return true;
    });
  }

  private hasRecentlySpeakingRemote(): boolean {
    const now = Date.now();
    for (const [participantId, until] of this.remoteSpeakingUntil) {
      if (until > now) return true;
      this.remoteSpeakingUntil.delete(participantId);
    }
    return false;
  }

  private enqueueAudioTrackOperation<T>(
    operation: () => Promise<T> | T,
  ): Promise<T> {
    const result = this.audioTrackOperation.then(operation, operation);
    this.audioTrackOperation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  public connect(
    name: string,
    avatarUrl?: string,
    clerkUserId?: string,
    username?: string,
    displayName?: string | null,
    avatarDisplay?:
      | import("@/lib/avatar-display").AvatarDisplay
      | string
      | null,
    options?: { channelId?: string; serverId?: string },
  ): void {
    if (this.isLeaving) {
      this.participantId = null;
      this.roomParticipantEstablished = false;
    }
    this.isLeaving = false;
    this.resetLatencyTimeline();
    this.connectArgs = {
      name,
      avatarUrl,
      clerkUserId,
      username,
      displayName,
      avatarDisplay,
      ...options,
    };
    this.createVoiceReadinessBarrier();
    this.createPartyTracksReadinessBarrier();
    this.roomGW.connectRoom({
      name,
      username,
      displayName,
      avatarUrl,
      avatarDisplay,
      channelId: options?.channelId,
      clerkUserId,
      serverId: options?.serverId,
      roomSlug: this.roomSlug,
      wsUrlGenerator: wsUrl,
    });
    this.voiceGW.prepareVoice(this.roomSlug, wsUrl, {
      channelId: options?.channelId,
      serverId: options?.serverId,
    });
  }

  public waitForVoiceGatewayReady(): Promise<void> {
    return this.voiceReadyPromise;
  }

  public refreshVoiceCredentials(): void {
    if (this.isLeaving) return;
    if (this.roomGW.isReady) {
      this.roomGW.requestCredentialRefresh();
      return;
    }
    this.roomGW.forceReconnect();
  }

  public getParticipantId(): string | null {
    return this.participantId;
  }

  public disconnect(reason: SFUDisconnectReason = "unknown"): void {
    if (this.isLeaving) return;
    sfuLog.info("Disconnecting SFU client", {
      reason,
      roomSlug: this.roomSlug,
      participantId: this.participantId,
      connectionState: this.getConnectionState(),
      roomGateway: this.roomGW.getDebugState(),
      voiceGateway: this.voiceGW.getDebugState(),
    });
    this.isLeaving = true;
    this.clearCredentialRefreshTimer();
    this.rejectVoiceReadiness(new Error("SFU client disconnected"));
    this.rejectPartyTracksReadiness(new Error("SFU client disconnected"));
    this.roomGW.send({ op: VoiceOpcode.ClientDisconnect, d: {} });
    this.voiceGW.send({ op: VoiceOpcode.ClientDisconnect, d: {} });
    this.roomGW.disconnect();
    this.voiceGW.disconnect();
    this.disposePartyTracksMedia();
    void this.nativeScreenShare.dispose().catch((error) => {
      sfuLog.warn("Native screen share disposal failed", error);
    });
    this.vad.stop();
    this.audio.dispose();
    this.remoteSpeakingUntil.clear();
    this.nativeScreenReconnectRequired = false;
    this.nativeScreenResetPromise = Promise.resolve();
    this.participantId = null;
    this.voiceToken = null;
    this.iceServers = [];
    this.connectArgs = null;
  }

  public getConnectionState(): string {
    if (this.isLeaving) return "disconnected";
    if (!this.roomGW.isReady || !this.voiceGW.isReady) return "connecting";
    if (!this.partyTracksMedia) return "failed";
    const state = this.partyTracksMedia.connectionState;
    if (state === "failed") return "failed";
    if (state === "disconnected" || state === "closed") {
      return "disconnected";
    }
    if (state === "idle" || state === "connected") return "connected";
    return "connecting";
  }

  public getPublishConnectionState(): string {
    if (!this.partyTracksMedia?.hasPublications) return "idle";
    return this.partyTracksMedia.connectionState;
  }

  public getSubscribeConnectionState(): string {
    if (!this.partyTracksMedia?.hasRemotePulls) return "idle";
    return this.partyTracksMedia.connectionState;
  }

  public sendChatMessage(content: string): void {
    this.roomGW.send({
      op: VoiceOpcode.MessageCreate,
      d: { channel_id: this.roomSlug, content, nonce: String(Math.random()) },
    });
  }

  public sendDemoChatMessage(payload: Record<string, unknown>): void {
    this.voiceGW.sendAppEvent({ type: "demo.chat.send", ...payload });
  }

  public requestDemoChatHistory(): void {
    this.voiceGW.sendAppEvent({ type: "demo.chat.history.request" });
  }

  public sendVoiceState(state: Record<string, unknown>): void {
    this.roomGW.sendVoiceState(state);
  }

  public sendMuteUpdate(isMicOn: boolean, isCameraOn: boolean): void {
    this.roomGW.sendMuteUpdate(isMicOn, isCameraOn);
  }

  public sendSpeaking(speaking: number): void {
    this.voiceGW.send({ op: VoiceOpcode.Speaking, d: { speaking } });
  }

  public setParticipantVolume(participantId: string, volume: number): void {
    this.audio.setParticipantVolume(participantId, volume);
  }

  public setTrackVolume(
    participantId: string,
    trackName: string,
    volume: number,
  ): void {
    this.audio.setTrackVolume(participantId, trackName, volume);
  }

  public setParticipantPan(participantId: string, pan: number): void {
    this.audio.setParticipantPan(participantId, pan);
  }

  public setTrackPan(
    participantId: string,
    trackName: string,
    pan: number,
  ): void {
    this.audio.setTrackPan(participantId, trackName, pan);
  }

  public applyVolumeToTrack(
    participantId: string,
    track: MediaStreamTrack,
    trackName: string,
  ): MediaStream {
    return this.audio.applyVolumeToTrack(participantId, track, trackName);
  }

  public attachRemoteAudioTrack(
    participantId: string,
    track: MediaStreamTrack,
    trackName: string,
  ): MediaStream {
    return this.audio.attachRemoteAudioTrack(participantId, track, trackName);
  }

  public removeTrackVolume(participantId: string, trackName: string): void {
    this.audio.removeTrackVolume(participantId, trackName);
  }

  public resumeAudioContext(): Promise<void> {
    return this.audio.resumeAudioContext();
  }

  public setRemoteTrackSubscription(
    participantId: string,
    trackName: string,
    subscribe: boolean,
    rid?: string,
  ): void {
    void participantId;
    void rid;
    this.partyTracksMedia?.setRemoteTrackSubscription(trackName, subscribe);
  }

  public unpublishTrack(trackName: string): void {
    this.partyTracksMedia?.unpublishTrack(trackName);
  }

  public unpublishTrackIfCurrent(
    trackName: string,
    expectedTrack: MediaStreamTrack,
  ): Promise<boolean> {
    return this.enqueueAudioTrackOperation(() => {
      if (
        this.partyTracksMedia?.getPublishedTrack(trackName) !== expectedTrack
      ) {
        return false;
      }
      return this.partyTracksMedia.unpublishTrack(trackName);
    });
  }

  public getPublishedTrack(trackName: string): MediaStreamTrack | null {
    return this.partyTracksMedia?.getPublishedTrack(trackName) ?? null;
  }

  public getMicrophoneTrackName(): string | null {
    return this.participantId ? `cam-audio-${this.participantId}` : null;
  }

  public async publishTracks(
    stream: MediaStream,
    prefix: string,
  ): Promise<void> {
    this.markLatency("publishRequestedAt", {
      prefix,
      trackCount: stream.getTracks().length,
      kinds: stream.getTracks().map((track) => track.kind),
    });
    if (!this.partyTracksMedia) await this.partyTracksReadyPromise;
    if (!this.partyTracksMedia) {
      throw new Error("PartyTracks media is unavailable");
    }
    this.markLatency("publishStartedAt", {
      prefix,
      source: "PartyTracks",
    });
    this.partyTracksMedia.publishStream(stream, prefix);
    this.markLatency("publishCompletedAt", {
      prefix,
      source: "PartyTracks",
    });
  }

  public pullTracks(tracks: TrackInfo[]): void {
    if (!this.partyTracksMedia) {
      this.warnDroppedLegacyTracks(tracks, "PullTracksWithoutPartyTracks");
      return;
    }
    this.offerPartyTracksOrDropLegacy(tracks, "PullTracks");
  }

  public replaceTrack(
    trackName: string,
    newTrack: MediaStreamTrack | null,
  ): Promise<boolean> {
    const replace = (): boolean => {
      const replaced =
        this.partyTracksMedia?.replaceTrack(trackName, newTrack) ?? false;
      if (replaced && trackName.startsWith("cam-audio-")) {
        this.outboundAudioSentinel.resetMonitoring();
        this.vad.reapplyGate();
      }
      return replaced;
    };
    return trackName.startsWith("cam-audio-")
      ? this.enqueueAudioTrackOperation(replace)
      : Promise.resolve(replace());
  }

  public replaceTrackIfCurrent(
    trackName: string,
    expectedTrack: MediaStreamTrack,
    newTrack: MediaStreamTrack | null,
  ): Promise<boolean> {
    return this.enqueueAudioTrackOperation(() => {
      const replaced =
        this.partyTracksMedia?.replaceTrackIfCurrent(
          trackName,
          expectedTrack,
          newTrack,
        ) ?? false;
      if (replaced && trackName.startsWith("cam-audio-")) {
        this.outboundAudioSentinel.resetMonitoring();
        this.vad.reapplyGate();
      }
      return replaced;
    });
  }

  public setPublishedTrackEnabled(
    trackName: string,
    enabled: boolean,
  ): boolean {
    const track = this.partyTracksMedia?.getPublishedTrack(trackName);
    if (!track) return false;
    track.enabled = enabled;
    if (trackName.startsWith("cam-audio-")) {
      this.outboundAudioSentinel.resetMonitoring();
      this.vad.setMicrophoneEnabled(enabled);
    }
    return true;
  }

  public publishNativeScreenShare(
    options: NativeScreenShareOptions,
  ): Promise<void> {
    return this.nativeScreenShare.start(options);
  }

  public stopNativeScreenShare(): Promise<void> {
    return this.nativeScreenShare.stop();
  }

  public get isNativeScreenShareActive(): boolean {
    return this.nativeScreenShare.active;
  }

  public updateNativeScreenQuality(quality: string): Promise<boolean> {
    return this.nativeScreenShare.updateQuality(quality);
  }

  public startPreviewLoopback(): Promise<MediaStream | null> {
    return this.nativeScreenShare.startPreview();
  }

  public stopPreviewLoopback(): Promise<void> {
    return this.nativeScreenShare.stopPreview();
  }

  public get previewLoopbackMediaStream(): MediaStream | null {
    return this.nativeScreenShare.previewStream;
  }

  public async updateSenderEncoding(
    trackName: string,
    encoding: Partial<RTCRtpEncodingParameters>,
  ): Promise<void> {
    const track = this.partyTracksMedia?.getPublishedTrack(trackName);
    if (!track || !this.partyTracksPeerConnection) return;
    const sender = this.partyTracksPeerConnection
      .getSenders()
      .find(
        (candidate) =>
          candidate.track === track || candidate.track?.id === track.id,
      );
    if (!sender) return;
    const parameters = sender.getParameters();
    parameters.encodings = parameters.encodings?.length
      ? parameters.encodings
      : [{}];
    parameters.encodings = parameters.encodings.map((current) => ({
      ...current,
      ...encoding,
    }));
    await sender.setParameters(parameters);
  }

  public stopTracks(trackNames: string[]): void {
    if (trackNames.length === 0) return;
    const remainingTrackNames = trackNames.filter(
      (trackName) => !this.partyTracksMedia?.unpublishTrack(trackName),
    );
    if (remainingTrackNames.length > 0) {
      this.voiceGW.send({
        op: VoiceOpcode.StopTracks,
        d: { track_names: remainingTrackNames },
      });
    }
    this.emit("tracks-stopped", {
      participantId: this.participantId ?? "",
      trackNames,
    });
  }

  public createTrueStereoStream(stream: MediaStream): MediaStream {
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return stream;
    return this.audio.createTrueStereoStream(audioTrack);
  }

  public getDebugData(): ReturnType<ConnectionStatsMonitor["getDebugData"]> {
    return this.stats.getDebugData();
  }

  public getDetailedStats(): ReturnType<
    ConnectionStatsMonitor["getDetailedStats"]
  > {
    return this.stats.getDetailedStats();
  }

  public getStatsByClerkId(
    clerkId: string,
    trackPrefix: "cam" | "screen",
  ): ReturnType<ConnectionStatsMonitor["getStatsByClerkId"]> {
    return this.stats.getStatsByClerkId(clerkId, trackPrefix);
  }

  public setClerkMapping(participantId: string, clerkId: string): void {
    this.stats.setClerkMapping(participantId, clerkId);
  }

  public deleteClerkMapping(participantId: string): void {
    this.stats.deleteClerkMapping(participantId);
  }

  public subscribeConnectionStats(
    callback: (stats: VoiceConnectionStats) => void,
  ): ReturnType<ConnectionStatsMonitor["subscribeConnectionStats"]> {
    return this.stats.subscribeConnectionStats(callback);
  }
}
