// Must run before partytracks/client (inside @ralph/voice-media) is
// evaluated: the globals PartyTracks reads.
import "./webrtc-runtime";

import { GatewayCloseCode, GatewayOp } from "@ralph/protocol";
import type { MainClientPayload, VoiceClientPayload } from "@ralph/protocol";
import type {
  PublicationMedia,
  PublicationSlot,
  PublicationValue,
  ScreenPublication,
  VoiceSessionClient,
} from "@ralph/voice";
import {
  PartyTracksMediaManager,
  PartyTracksTransport,
  readReceiverFrames,
  SplitVideoTransport,
  type IceServer,
  type TrackInfo,
  type VideoFlow,
  type VideoFrameReading,
} from "@ralph/voice-media";

import { config } from "@/lib/config";

import {
  RoomSocket,
  VoiceSocket,
  type MediaCredentials,
  type SocketGiveUp,
} from "./gateways";
import { VideoKeepalivePool } from "./keepalive";
import type { RepublishRequest, VoiceAppEvent, VoiceState } from "./protocol";
import { VIDEO_TRACK_PREFIXES } from "./remote-video";
import { beginCallAdmission, type CallTarget } from "./tickets";

// The connection of one call: the room socket (MeetingRoom), the voice
// socket (VoiceRoom) and the PartyTracks sessions, through the media
// manager the web runs too (@ralph/voice-media): one for our tracks and
// remote audio, and one for remote video while any is pulled
// (SplitVideoTransport). The mobile counterpart of
// the web's SFUClient plumbing; what the messages mean for the call (the
// roster, the phase, what to publish) is CallSession's business.
//
// Join order, as on the web: the room ticket's media bootstrap (participant
// id, voice token, TURN) creates the PartyTracks session and identifies the
// voice socket (opened in parallel) without waiting for the room's Ready.
// Publications are announced on the voice socket as soon as the SFU accepts
// them (queued until VoiceReady), and re-announced on VoiceReady before the
// room's tracks are pulled, so pulls queue behind them on the session.

const log = {
  info: (message: string, ...args: unknown[]) =>
    console.log(`[Voice] ${message}`, ...args),
  warn: (message: string, ...args: unknown[]) =>
    console.warn(`[Voice] ${message}`, ...args),
};

/** The web's credential refresh cadence (voice token and TURN). */
const CREDENTIAL_REFRESH_MS = 45 * 60 * 1000;
/** Republishes of one track on listeners' request: at most one per this. */
const REPUBLISH_REQUEST_INTERVAL_MS = 5_000;
/** What the voice room said no to (a soundboard event it did not accept). */
const APP_EVENT_REJECTED = "Soundboard event was rejected";

/**
 * publishTracks(tracks, "cam"): the microphone is `cam-audio-<participant>`,
 * the camera `cam-video-<participant>`; "screen": `screen-video-<participant>`.
 */
const MIC_PREFIX = "cam";
const SCREEN_PREFIX = "screen";

/**
 * Sender limits for our video, set once a push is answered (and again when
 * it resumes or is republished). A phone publishes one camera layer (no
 * simulcast: cameraSendEncodings null) and caps it for its uplink.
 */
const VIDEO_ENCODING = {
  cam: { maxBitrate: 1_200_000, maxFramerate: 30 },
  screen: { maxBitrate: 1_500_000, maxFramerate: 15 },
} as const;

export interface RemoteTrackEvent {
  readonly action: "add" | "remove";
  readonly track: MediaStreamTrack;
  readonly trackInfo: TrackInfo;
}

/** What the connection reports to its call. */
export interface ConnectionEvents {
  roomReady(participantId: string, participants: readonly VoiceState[]): void;
  roomResumed(participants?: readonly VoiceState[]): void;
  voiceStateUpdate(
    participant: VoiceState,
    action: "join" | "leave" | "update",
  ): void;
  profileUpdate(update: {
    participantId: string;
    name: string;
    username?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
  }): void;
  /** The room socket dropped and is reconnecting on its own. */
  roomLost(): void;
  roomTicketFailed(error: unknown): void;
  /** The voice socket is identified again (VoiceReady), its tracks applied. */
  voiceReady(
    tracks: readonly TrackInfo[],
    speaking: Readonly<Record<string, number>>,
  ): void;
  voiceLost(): void;
  trackOffered(track: TrackInfo): void;
  stopTracks(trackNames: readonly string[]): void;
  speaking(participantId: string, flags: number): void;
  clientDisconnect(participantId: string): void;
  appEvent(event: VoiceAppEvent): void;
  appEventRejected(): void;
  /**
   * A media session with nothing published: a new one (the first, or one
   * for a new participant id), or the voice room came back without our
   * publications. The call republishes everything (connection reset).
   */
  mediaReset(): void;
  peerState(state: RTCPeerConnectionState): void;
  remoteTrack(event: RemoteTrackEvent): void;
  /** A shown remote camera started or stopped playing (videoFlowOf). */
  videoFlow(): void;
  /** A socket gave up for good (no retry): the call ends. */
  giveUp(reason: SocketGiveUp): void;
}

/** Our earlier participant ids this call: never pulled (their tracks linger). */
function isOwnTrack(
  track: TrackInfo,
  participantId: string | null,
  previous: ReadonlySet<string>,
): boolean {
  return (
    track.participant_id === participantId ||
    track.session_id === participantId ||
    previous.has(track.participant_id)
  );
}

export class CallConnection implements VoiceSessionClient {
  private readonly room: RoomSocket;
  private readonly voice: VoiceSocket;
  /** The main PartyTracks session (pushes, audio pulls): the call's peer connection. */
  private transport: PartyTracksTransport | null = null;
  /** It and the video pulls' own sessions, as the media manager sees them. */
  private mediaTransport: SplitVideoTransport | null = null;
  private manager: PartyTracksMediaManager | null = null;
  private managerParticipantId: string | null = null;
  private participant: string | null = null;
  /** The room socket admitted `participant` (MediaReady or Ready). */
  private roomEstablished = false;
  private readonly previousParticipantIds = new Set<string>();
  /** Offers that arrived before the media session existed. */
  private readonly deferredRemoteTracks = new Map<string, TrackInfo>();
  /** The call's latest subscription choice per alias, replayed on a new manager. */
  private readonly subscriptions = new Map<string, boolean>();
  private readonly lastRepublishRequestAt = new Map<string, number>();
  /** One ready per video slot that can be withdrawn: camera and screen. */
  private readonly keepalives = new VideoKeepalivePool(2, (error) =>
    log.warn("Could not open a video keepalive", error),
  );
  /** What a new PartyTracks session (a video one, see SplitVideoTransport) uses. */
  private latestVoiceToken = "";
  private latestIceServers: IceServer[] | undefined;
  private credentialTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnected = false;
  private stopVideoHealth: (() => void) | null = null;

  constructor(
    private readonly target: CallTarget,
    identify: MainClientPayload<GatewayOp.Identify>,
    private readonly events: ConnectionEvents,
  ) {
    this.room = new RoomSocket(target, identify, {
      mediaBootstrap: (credentials) => this.onMediaBootstrap(credentials),
      mediaReady: (credentials) => this.onMediaReady(credentials),
      ready: (credentials, participants) => {
        if (this.disconnected) return;
        this.roomEstablished = true;
        const held = this.heldCredentials(credentials.participantId);
        const current: MediaCredentials | null = credentials.voiceToken
          ? {
              participantId: credentials.participantId,
              voiceToken: credentials.voiceToken,
              ...(credentials.iceServers
                ? { iceServers: credentials.iceServers }
                : {}),
            }
          : held;
        if (current) {
          this.adoptCredentials(current);
        } else {
          // Neither Ready nor the admission gave us credentials: ask (op 40).
          log.warn("Ready without voice credentials; requesting them");
          this.room.requestCredentialRefresh();
        }
        this.scheduleCredentialRefresh();
        events.roomReady(credentials.participantId, participants);
      },
      resumed: (credentials, participants) => {
        if (this.disconnected) return;
        if (credentials.voiceToken) {
          this.updateMediaVoiceToken(credentials.voiceToken);
          this.voice.updateVoiceToken(credentials.voiceToken);
          if (!this.voice.isReady && this.participant) {
            this.voice.connectVoice(this.participant, credentials.voiceToken);
          }
        }
        // Still the same participant: a held identify can go now.
        this.voice.releaseIdentify();
        if (credentials.iceServers?.length) {
          this.latestIceServers = [...credentials.iceServers];
          this.mediaTransport?.updateIceServers([...credentials.iceServers]);
        }
        events.roomResumed(participants);
      },
      voiceStateUpdate: (participant, action) => {
        if (!this.disconnected) events.voiceStateUpdate(participant, action);
      },
      profileUpdate: (update) => {
        if (!this.disconnected) events.profileUpdate(update);
      },
      error: (code, message) => log.warn(`Room error ${code}: ${message}`),
      ticketFailed: (error) => {
        if (!this.disconnected) events.roomTicketFailed(error);
      },
      disconnected: (giveUp) => {
        if (this.disconnected) return;
        if (giveUp) events.giveUp(giveUp);
        else events.roomLost();
      },
    });
    this.voice = new VoiceSocket(target, {
      voiceReady: (tracks, speaking) => this.onVoiceReady(tracks, speaking),
      trackOffered: (track) => this.onTrackOffered(track),
      speaking: (participantId, flags) => {
        if (!this.disconnected) events.speaking(participantId, flags);
      },
      clientDisconnect: (participantId) => {
        if (!this.disconnected) events.clientDisconnect(participantId);
      },
      stopTracks: (trackNames, tracks) => this.onStopTracks(trackNames, tracks),
      republishRequest: (request) => this.onRepublishRequest(request),
      appEvent: (event) => {
        if (!this.disconnected) events.appEvent(event);
      },
      error: (code, message) => {
        if (message === APP_EVENT_REJECTED) events.appEventRejected();
        else this.onVoiceError(code, message);
      },
      disconnected: (giveUp) => {
        if (this.disconnected) return;
        if (giveUp) events.giveUp(giveUp);
        else events.voiceLost();
      },
    });
  }

  /** Opens both sockets; the voice socket identifies once credentials land. */
  start(): void {
    // One admission request for both sockets' first tickets.
    beginCallAdmission(this.target);
    this.room.connect();
    this.voice.connect();
  }

  /**
   * The app is in front again: retry now, or probe the open sockets. After a
   * network change both sockets reconnect at once and resume.
   */
  wake(options: { readonly networkChanged?: boolean } = {}): void {
    if (this.disconnected) return;
    // The voice socket identifies once the room says who we are now.
    if (options.networkChanged && this.participant) this.voice.holdIdentify();
    this.room.wake(options);
    this.voice.wake(options);
  }

  get participantId(): string | null {
    return this.participant;
  }

  /** The media session, once the first credentials arrived. */
  get media(): PartyTracksMediaManager | null {
    return this.manager;
  }

  get peerConnection(): RTCPeerConnection | null {
    return this.transport?.peerConnection ?? null;
  }

  /** One of our own earlier participant ids in this call. */
  isPreviousParticipant(participantId: string): boolean {
    return this.previousParticipantIds.has(participantId);
  }

  get voiceReady(): boolean {
    return this.voice.isReady;
  }

  get roomReady(): boolean {
    return this.room.isReady;
  }

  sendRoomVoiceState(d: MainClientPayload<GatewayOp.VoiceStateUpdate>): void {
    if (!this.disconnected) this.room.sendVoiceState(d);
  }

  /** Queued until the voice socket is ready; the room echoes it to everyone. */
  sendAppEvent(d: Readonly<Record<string, unknown>>): void {
    if (!this.disconnected) {
      this.voice.send({ op: GatewayOp.VoiceAppEvent, d });
    }
  }

  sendSpeaking(flags: number): void {
    if (!this.disconnected) this.voice.sendSpeaking(flags);
  }

  /**
   * A camera or screen share is about to be published: have its keepalive
   * ready for when it is turned off (see ./keepalive). Calls without video
   * open none.
   */
  prepareVideoKeepalives(): void {
    if (!this.disconnected) this.keepalives.fill();
  }

  /**
   * Whether remote `trackName` (an opt-in video alias) is pulled. Kept for
   * the next media session too.
   */
  setRemoteTrackSubscription(trackName: string, subscribe: boolean): void {
    this.subscriptions.set(trackName, subscribe);
    this.manager?.setRemoteTrackSubscription(trackName, subscribe);
  }

  /**
   * The app went to the background: close the video pulls the media
   * manager keeps (opt-in aliases nobody subscribes to now), so nothing
   * streams video to a phone that shows none. Their video session drains
   * and goes; watching again pulls on a new one (SplitVideoTransport).
   */
  releaseUnwatchedVideo(): void {
    this.manager?.releaseUnsubscribedPulls();
  }

  /**
   * A remote participant's voice socket went and their grace ran out:
   * their tracks go, except the ones they offered again meanwhile.
   */
  dropParticipant(participantId: string, keep?: ReadonlySet<string>): void {
    for (const [trackName, track] of this.deferredRemoteTracks) {
      if (track.participant_id === participantId && !keep?.has(trackName)) {
        this.deferredRemoteTracks.delete(trackName);
      }
    }
    this.manager?.removeParticipant(participantId, keep);
  }

  /**
   * Our publications as the @ralph/voice reconciler sees them (STATE_MACHINE
   * "Publication"). Track names use the media session's participant id,
   * read at each operation.
   */
  readonly publications: PublicationMedia<MediaStreamTrack> = {
    publish: (slot, value) => {
      const manager = this.requireMedia();
      if (slot === "screen") {
        const tracks = screenTracks(value);
        if (tracks.length > 0) manager.publishTracks(tracks, SCREEN_PREFIX);
        return;
      }
      // Publishing a slot that is published (or withdrawn and kept alive)
      // swaps its source.
      manager.publishTracks([value as MediaStreamTrack], MIC_PREFIX);
    },
    replace: (slot, value) => {
      const manager = this.requireMedia();
      if (slot === "screen") {
        const tracks = screenTracks(value);
        if (tracks.length > 0) manager.publishTracks(tracks, SCREEN_PREFIX);
        return true;
      }
      return manager.replaceTrack(
        this.trackName(slot),
        value as MediaStreamTrack,
      );
    },
    unpublish: (slot) => {
      const manager = this.requireMedia();
      if (slot === "screen") {
        manager.unpublishTrack(this.trackName("screen"));
        manager.unpublishTrack(this.screenAudioName());
        return;
      }
      manager.unpublishTrack(this.trackName(slot));
    },
    setEnabled: (slot, enabled) => {
      const name =
        slot === "screen" ? this.screenAudioName() : this.trackName(slot);
      const track = this.manager?.getPublishedTrack(name);
      if (track) track.enabled = enabled;
    },
    isPublished: (slot) =>
      (this.manager?.getPublishedTrack(this.trackName(slot)) ?? null) !== null,
  };

  /**
   * Leave: ClientDisconnect on both sockets (when open), close them, end
   * the media session and its keepalives. Idempotent.
   */
  disconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    if (this.credentialTimer) clearTimeout(this.credentialTimer);
    this.credentialTimer = null;
    this.room.stop();
    this.voice.stop();
    this.disposeMedia();
    this.keepalives.dispose();
    this.deferredRemoteTracks.clear();
  }

  // ── Credentials and media ────────────────────────────────────────────────

  private onMediaBootstrap(credentials: MediaCredentials): void {
    if (this.disconnected) return;
    // A reconnect's ticket names a new participant; the room resumes the old
    // one, so a bootstrap for anyone else is stale once the room admitted us.
    if (
      this.roomEstablished &&
      this.participant !== credentials.participantId
    ) {
      return;
    }
    this.adoptCredentials(credentials);
  }

  /** The credentials the admission's bootstrap gave `participantId`, if any. */
  private heldCredentials(participantId: string): MediaCredentials | null {
    if (this.participant !== participantId || !this.latestVoiceToken) {
      return null;
    }
    return {
      participantId,
      voiceToken: this.latestVoiceToken,
      ...(this.latestIceServers ? { iceServers: this.latestIceServers } : {}),
    };
  }

  private onMediaReady(credentials: MediaCredentials): void {
    if (this.disconnected) return;
    this.roomEstablished = true;
    this.adoptCredentials(credentials);
  }

  private adoptCredentials(credentials: MediaCredentials): void {
    if (
      this.participant !== null &&
      this.participant !== credentials.participantId
    ) {
      log.warn("The room gave us a new participant id; rebuilding media");
      this.previousParticipantIds.add(this.participant);
      this.disposeMedia();
    }
    this.participant = credentials.participantId;
    this.ensureMedia(credentials);
    this.voice.updateVoiceToken(credentials.voiceToken);
    this.voice.connectVoice(credentials.participantId, credentials.voiceToken);
  }

  private ensureMedia(credentials: MediaCredentials): void {
    if (
      this.manager &&
      this.mediaTransport &&
      this.managerParticipantId === credentials.participantId
    ) {
      this.updateMediaVoiceToken(credentials.voiceToken);
      return;
    }
    this.disposeMedia();
    const participantId = credentials.participantId;
    this.latestVoiceToken = credentials.voiceToken;
    this.latestIceServers = credentials.iceServers
      ? [...credentials.iceServers]
      : undefined;
    const createSession = () =>
      new PartyTracksTransport(
        {
          roomSlug: this.target.roomSlug,
          participantId,
          voiceToken: this.latestVoiceToken,
          iceServers: this.latestIceServers
            ? [...this.latestIceServers]
            : undefined,
        },
        { resolveApiUrl: (path) => `${config.apiBaseUrl}${path}` },
      );
    const transport = createSession();
    const mediaTransport = new SplitVideoTransport(transport, {
      createVideoSession: createSession,
      onVideoSession: (event) =>
        console.log(
          event === "opened"
            ? "[Voice] Video session opened"
            : "[Voice] Video session closed (nothing pulled)",
        ),
    });
    const manager = new PartyTracksMediaManager(
      mediaTransport,
      participantId,
      {
        onPublicationMetadata: (track) => {
          if (track.kind === "video") void this.limitVideoSender(track);
          const d: VoiceClientPayload<GatewayOp.Video> = {
            tracks: [
              {
                participant_id: track.participant_id,
                track_name: track.track_name,
                sfu_track_name: track.sfu_track_name,
                session_id: track.session_id,
                kind: track.kind,
              },
            ],
          };
          log.info("Announcing publication", track.track_name);
          this.voice.send({ op: GatewayOp.Video, d });
        },
        onPublicationStopped: (trackName) =>
          this.voice.send({
            op: GatewayOp.StopTracks,
            d: { track_names: [trackName] },
          }),
        onRemoteTrack: (event) => {
          if (!this.disconnected) this.events.remoteTrack(event);
        },
        onConnectionState: (state) => {
          log.info(`Peer connection ${state}`);
          if (!this.disconnected) this.events.peerState(state);
        },
        onError: (error) => log.warn("PartyTracks media error", error),
        onTrackUnavailable: (event) => {
          log.warn(
            "SFU keeps not finding a pulled track; asking for a republish",
            {
              trackName: event.track_name,
              notFoundCount: event.notFoundCount,
              report: event.report,
            },
          );
          this.voice.send({
            op: GatewayOp.TrackUnavailable,
            d: {
              participant_id: event.participant_id,
              track_name: event.track_name,
              sfu_track_name: event.sfu_track_name,
              session_id: event.session_id,
            },
          });
        },
      },
      {
        createVideoKeepalive: this.keepalives.create,
        // One camera layer from a phone; web cameras are pulled by layer.
        cameraSendEncodings: null,
        // Video is pulled only while the call screen watches, and kept
        // until the app goes to the background (releaseUnwatchedVideo).
        optInTrackPrefixes: VIDEO_TRACK_PREFIXES,
        // A camera that decodes nothing is pulled again on a new video
        // session, then shown as unavailable (RemoteVideoHealth).
        readVideoFrames: (track) => this.readVideoFrames(track),
      },
    );
    this.stopVideoHealth = manager.videoHealth.subscribe(() => {
      if (!this.disconnected) this.events.videoFlow();
    });
    this.transport = transport;
    this.mediaTransport = mediaTransport;
    this.manager = manager;
    this.managerParticipantId = participantId;
    for (const [trackName, subscribe] of this.subscriptions) {
      manager.setRemoteTrackSubscription(trackName, subscribe);
    }
    this.events.mediaReset();
    if (this.deferredRemoteTracks.size > 0) {
      const deferred = [...this.deferredRemoteTracks.values()];
      this.deferredRemoteTracks.clear();
      manager.offerTracks(deferred);
    }
  }

  private updateMediaVoiceToken(voiceToken: string): void {
    this.latestVoiceToken = voiceToken;
    this.mediaTransport?.updateVoiceToken(voiceToken);
  }

  /** A shown remote camera's flow (see RemoteVideoHealth). */
  videoFlowOf(track: MediaStreamTrack): VideoFlow | undefined {
    return this.manager?.videoHealth.flowOf(track);
  }

  /** A pulled track's decoded frames, from its receiver's stats. */
  private readVideoFrames(
    track: MediaStreamTrack,
  ): Promise<VideoFrameReading> | null {
    const receiver = this.mediaTransport?.receiverFor(track);
    return receiver ? readReceiverFrames(receiver) : null;
  }

  private disposeMedia(): void {
    this.stopVideoHealth?.();
    this.stopVideoHealth = null;
    this.manager?.dispose();
    this.mediaTransport?.dispose();
    this.manager = null;
    this.transport = null;
    this.mediaTransport = null;
    this.managerParticipantId = null;
  }

  private requireMedia(): PartyTracksMediaManager {
    if (!this.manager) throw new Error("No media session yet");
    return this.manager;
  }

  private trackName(slot: PublicationSlot): string {
    const id = this.managerParticipantId ?? this.participant ?? "";
    if (slot === "microphone") return `${MIC_PREFIX}-audio-${id}`;
    if (slot === "camera") return `${MIC_PREFIX}-video-${id}`;
    return `${SCREEN_PREFIX}-video-${id}`;
  }

  private screenAudioName(): string {
    const id = this.managerParticipantId ?? this.participant ?? "";
    return `${SCREEN_PREFIX}-audio-${id}`;
  }

  /**
   * Caps a video sender's bitrate and frame rate (see VIDEO_ENCODING). Runs
   * when the push is answered, so the sender exists; a failure only leaves
   * WebRTC's own rate control in charge.
   */
  private async limitVideoSender(track: TrackInfo): Promise<void> {
    const limits = track.track_name.startsWith(`${SCREEN_PREFIX}-`)
      ? VIDEO_ENCODING.screen
      : VIDEO_ENCODING.cam;
    const source = this.manager?.getPublishedTrack(track.track_name);
    const sender = source
      ? this.transport?.peerConnection
          ?.getSenders()
          .find((candidate) => candidate.track?.id === source.id)
      : undefined;
    if (!sender) return;
    try {
      const parameters = sender.getParameters();
      // react-native-webrtc's encodings are classes with setters (and toJSON
      // over private fields), so set them in place rather than spreading.
      if (!parameters.encodings?.length) {
        parameters.encodings = [{ active: true }];
      }
      for (const encoding of parameters.encodings) {
        encoding.maxBitrate = limits.maxBitrate;
        encoding.maxFramerate = limits.maxFramerate;
      }
      await sender.setParameters(parameters);
    } catch (error) {
      log.warn("Could not limit the video sender", track.track_name, error);
    }
  }

  private scheduleCredentialRefresh(): void {
    if (this.credentialTimer) clearTimeout(this.credentialTimer);
    this.credentialTimer = setTimeout(() => {
      this.credentialTimer = null;
      if (this.disconnected) return;
      this.room.requestCredentialRefresh();
      this.scheduleCredentialRefresh();
    }, CREDENTIAL_REFRESH_MS);
  }

  // ── Voice socket ─────────────────────────────────────────────────────────

  private remoteOnly(tracks: readonly TrackInfo[]): TrackInfo[] {
    const seen = new Set<string>();
    return tracks.filter((track) => {
      if (
        isOwnTrack(track, this.participant, this.previousParticipantIds) ||
        seen.has(track.track_name)
      ) {
        return false;
      }
      seen.add(track.track_name);
      return true;
    });
  }

  private onVoiceReady(
    tracks: readonly TrackInfo[],
    speaking: Readonly<Record<string, number>>,
  ): void {
    if (this.disconnected) return;
    const remote = this.remoteOnly(tracks);
    // The call learns of every offer first (grace, video subscriptions).
    this.events.voiceReady(remote, speaking);
    const pullable = remote.filter((track) => Boolean(track.sfu_track_name));
    const manager = this.manager;
    if (manager) {
      // Announce our publications before the replayed pulls queue their
      // negotiation behind them on the shared session. A voice room that
      // came back without them gets them published afresh.
      if (manager.hasPublications) manager.reannouncePublications();
      else this.events.mediaReset();
      manager.syncRemoteTracks(pullable);
    } else {
      for (const track of pullable) {
        this.deferredRemoteTracks.set(track.track_name, track);
      }
    }
  }

  private onTrackOffered(track: TrackInfo): void {
    if (this.disconnected) return;
    if (isOwnTrack(track, this.participant, this.previousParticipantIds)) {
      return;
    }
    this.events.trackOffered(track);
    if (!track.sfu_track_name) return;
    if (this.manager) this.manager.offerTracks([track]);
    else this.deferredRemoteTracks.set(track.track_name, track);
  }

  private onStopTracks(
    trackNames: readonly string[],
    tracks?: readonly TrackInfo[],
  ): void {
    if (this.disconnected) return;
    for (const trackName of trackNames) {
      this.deferredRemoteTracks.delete(trackName);
    }
    this.events.stopTracks(trackNames);
    const withdrawn = trackNames.filter(
      (trackName) =>
        tracks?.some(
          (track) =>
            track.track_name === trackName && Boolean(track.sfu_track_name),
        ) || this.manager?.hasRemoteOffer(trackName),
    );
    // Withdrawn, not closed: the alias's next publication reuses the pull.
    if (withdrawn.length > 0) this.manager?.withdrawRemoteTracks(withdrawn);
  }

  /**
   * A listener could not pull one of our publications and the voice room
   * checked it is our current one: push it again under a new SFU track. Only
   * for the SFU track we still announce, at most once per 5 s per track
   * (as the web's SFUClient).
   */
  private onRepublishRequest(request: RepublishRequest): void {
    if (this.disconnected || !this.manager) return;
    const current = this.manager.getPublicationMetadata(request.track_name);
    if (!current) return;
    if (
      (request.sfu_track_name !== undefined &&
        request.sfu_track_name !== current.sfu_track_name) ||
      (request.session_id !== undefined &&
        request.session_id !== current.session_id)
    ) {
      return;
    }
    const now = Date.now();
    const lastAt = this.lastRepublishRequestAt.get(request.track_name);
    if (lastAt !== undefined && now - lastAt < REPUBLISH_REQUEST_INTERVAL_MS) {
      return;
    }
    this.lastRepublishRequestAt.set(request.track_name, now);
    log.info("Republishing on a listener's request", request.track_name);
    this.manager.republishTrack(request.track_name);
  }

  private onVoiceError(code: number, message: string): void {
    if (
      code === GatewayCloseCode.UnknownOpcode &&
      message.endsWith(`opcode: ${GatewayOp.TrackUnavailable}`)
    ) {
      return; // A voice room older than the track-unavailable report.
    }
    if (
      code === GatewayCloseCode.AuthenticationFailed ||
      message === "Voice token expired"
    ) {
      log.warn("Voice token refused; asking the room for fresh credentials");
      this.room.requestCredentialRefresh();
      return;
    }
    log.warn(`Voice error ${code}: ${message}`);
  }
}

function screenTracks(
  value: PublicationValue<MediaStreamTrack>,
): MediaStreamTrack[] {
  const share = value as ScreenPublication<MediaStreamTrack>;
  // A phone has no native share pipeline; nothing to publish for one.
  if (share.kind !== "tracks") return [];
  return [share.audio, share.video].filter(
    (track): track is MediaStreamTrack =>
      track !== null && track.readyState !== "ended",
  );
}
