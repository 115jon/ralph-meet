import {
  GatewayCloseCode,
  GatewayOp,
  type MainClientPayload,
  type VoiceClientPayload,
} from "@ralph/protocol";

import {
  onGatewayReady,
  sendVoiceChannelJoin,
  sendVoiceChannelLeave,
  sendVoiceStateUpdate,
} from "@/features/realtime/gateway";
import { ApiError } from "@/lib/api";

import {
  RoomSocket,
  VoiceSocket,
  type MediaCredentials,
  type SocketGiveUp,
} from "./gateways";
import {
  type CameraFacing,
  facingOf,
  stopStream,
  streamUrl,
  switchCamera,
} from "./local-media";
import { PartyTracksMediaManager } from "./media-manager";
import {
  SPEAKING_MICROPHONE,
  type RepublishRequest,
  type TrackInfo,
  type VoiceAppEvent,
  type VoiceState,
} from "./protocol";
import { isPullableVideo, RemoteVideo } from "./remote-video";
import { startSpeakingDetector } from "./speaking";
import { updateCall, type CallParticipant, type CallStatus } from "./store";
import type { CallTarget } from "./tickets";
import { PartyTracksTransport } from "./transport";

// One voice call: the mobile counterpart of the web's SFUClient plus the parts
// of useVoiceChannel a phone needs. Join, in the web's order:
//
// 1. Room socket ticket. Its media bootstrap (participant id, voice token,
//    TURN) creates the PartyTracks session and publishes the microphone at
//    once, and identifies the voice socket (opened in parallel) without
//    waiting for the room. The push is announced on the voice socket as soon
//    as the SFU accepts it (queued until VoiceReady).
// 2. Room Identify → Ready: the roster, our voice state (mute/deafen), and our
//    presence on the chat socket (VoiceChannelJoin), which puts us in every
//    member's channel tree.
// 3. VoiceReady: the room's tracks are pulled (after our publication is
//    re-announced, so pulls queue behind the push on the shared session) and
//    the speaking snapshot is applied. Speaking flags flow both ways from then.
//
// Audio is always pulled. Camera and screen video are pulled only while the
// call screen watches (setWatchingVideo); ./remote-video keeps those offers
// apart so starting and stopping video never touches an audio pull.
//
// Camera and screen are published like the web's publishTracks(stream, "cam")
// and (stream, "screen"): more pushes on the same media manager and session as
// the microphone, so they are announced the moment the SFU answers (queued
// until VoiceReady), re-announced on VoiceReady, rebuilt with the media on a
// new participant id, and republished on a listener's request like any
// publication. Voice state carries them as self_video and self_stream.
//
// Leave says goodbye on both sockets, closes them and the peer connection,
// stops the microphone, camera and screen, and leaves the channel on the
// chat socket.

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
/** useVoiceChannel re-asserts its channel presence this often. */
const PRESENCE_REASSERT_MS = 30_000;
/**
 * publishTracks(stream, "cam"): the microphone is `cam-audio-<participant>`,
 * the camera `cam-video-<participant>`.
 */
const MIC_PREFIX = "cam";
/** publishTracks(stream, "screen"): `screen-video-<participant>`. */
const SCREEN_PREFIX = "screen";

/**
 * Sender limits for our video, set once a push is answered (and again on a
 * republish, which is a new sender). The web publishes one camera encoding
 * (no simulcast) and caps screens per quality preset; these suit a phone's
 * uplink.
 */
const VIDEO_ENCODING = {
  cam: { maxBitrate: 1_200_000, maxFramerate: 30 },
  screen: { maxBitrate: 1_500_000, maxFramerate: 15 },
} as const;

const GIVE_UP_MESSAGE: Record<SocketGiveUp, string> = {
  replaced: "You joined this call somewhere else",
  "auth-failed": "Your session ended",
  "admission-rejected": "The call turned you away",
};

export interface SessionIdentity {
  readonly userId: string;
  readonly name: string;
  readonly username: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
}

/** A voice track's source: their microphone, or their shared screen's audio. */
export type AudioSource = "voice" | "stream";

/** What the voice room said no to (a soundboard event it did not accept). */
const APP_EVENT_REJECTED = "Soundboard event was rejected";

export interface SessionEnd {
  readonly reason: "left" | "failed";
  readonly message?: string;
}

export interface SessionOptions {
  readonly target: CallTarget;
  readonly identity: SessionIdentity;
  /** The microphone, already captured. The session owns it from here. */
  readonly microphone: MediaStream;
  readonly muted: boolean;
  readonly deafened: boolean;
  /** The microphone level (0..1) that counts as speaking, read live. */
  readonly speakingLevel: () => number;
  /**
   * The gain (0..2, 0 silences) one participant's voice or share audio plays
   * at, read whenever a track arrives and on refreshAudioGains().
   */
  readonly audioGain: (participantId: string, source: AudioSource) => number;
  /** A voice-session app event (the soundboard), ours echoed back too. */
  readonly onAppEvent: (event: VoiceAppEvent) => void;
  /** The voice room refused an app event we sent. */
  readonly onAppEventRejected: () => void;
  readonly onEnd: (end: SessionEnd) => void;
}

function participantName(state: VoiceState, previous?: CallParticipant) {
  return (
    state.display_name ??
    state.name ??
    state.username ??
    previous?.name ??
    "Someone"
  ).trim();
}

/** Merges a full state or a delta (no profile fields) into what we have. */
function mergeParticipant(
  state: VoiceState,
  previous?: CallParticipant,
): CallParticipant {
  return {
    id: state.id,
    userId: state.user_id ?? previous?.userId ?? null,
    name: participantName(state, previous),
    avatarUrl:
      state.avatar_url !== undefined
        ? state.avatar_url
        : (previous?.avatarUrl ?? null),
    username: state.username ?? previous?.username ?? null,
    muted: state.self_mute ?? previous?.muted ?? false,
    deafened: state.self_deaf ?? previous?.deafened ?? false,
    camera: state.self_video ?? previous?.camera ?? false,
    sharing: state.self_stream ?? previous?.sharing ?? false,
  };
}

/** react-native-webrtc's per-track gain (0..10; libwebrtc saturates above 1). */
function setTrackGain(track: MediaStreamTrack, gain: number): void {
  const native = track as MediaStreamTrack & {
    _setVolume?: (volume: number) => void;
  };
  native._setVolume?.(gain);
}

interface RemoteAudio {
  readonly track: MediaStreamTrack;
  readonly participantId: string;
  readonly source: AudioSource;
}

/** Audio publications, always pulled (video goes through RemoteVideo). */
function pullable(tracks: readonly TrackInfo[]): TrackInfo[] {
  return tracks.filter(
    (track) => track.kind === "audio" && Boolean(track.sfu_track_name),
  );
}

export class VoiceSession {
  private readonly target: CallTarget;
  private readonly identity: SessionIdentity;
  private readonly microphone: MediaStream;
  /** Our camera and screen captures while on; the session owns them. */
  private camera: MediaStream | null = null;
  private cameraFacing: CameraFacing = "front";
  private screen: MediaStream | null = null;
  private readonly onEnd: (end: SessionEnd) => void;
  private readonly audioGain: SessionOptions["audioGain"];
  private readonly room: RoomSocket;
  private readonly voice: VoiceSocket;

  private transport: PartyTracksTransport | null = null;
  private media: PartyTracksMediaManager | null = null;
  private mediaParticipantId: string | null = null;
  private participantId: string | null = null;
  /** The room socket admitted `participantId` (MediaReady or Ready). */
  private roomEstablished = false;
  /** Our earlier participant ids this call: never pulled (their tracks linger). */
  private readonly previousParticipantIds = new Set<string>();
  private readonly deferredRemoteTracks = new Map<string, TrackInfo>();
  /** Pulled audio by alias: deafen and each person's gain apply here. */
  private readonly remoteAudio = new Map<string, RemoteAudio>();
  private readonly lastRepublishRequestAt = new Map<string, number>();
  private readonly video = new RemoteVideo(() => this.media);

  private peerState: RTCPeerConnectionState = "new";
  private roomReady = false;
  private voiceReady = false;
  private everConnected = false;
  private joinedChannel = false;
  private ended = false;

  private muted: boolean;
  private deafened: boolean;
  private mutedBeforeDeafen: boolean;
  private localSpeaking = false;

  private readonly stopSpeakingDetector: () => void;
  private stopPresence: (() => void) | null = null;
  private credentialTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SessionOptions) {
    this.target = options.target;
    this.identity = options.identity;
    this.microphone = options.microphone;
    this.onEnd = options.onEnd;
    this.audioGain = options.audioGain;
    this.muted = options.muted || options.deafened;
    this.deafened = options.deafened;
    this.mutedBeforeDeafen = options.muted;
    this.applyMicrophoneGate();

    const identify: MainClientPayload<GatewayOp.Identify> = {
      name: this.identity.name,
      username: this.identity.username,
      display_name: this.identity.displayName,
      avatar_url: this.identity.avatarUrl,
      platform: "mobile",
      supports_voice_state_deltas: true,
    };
    this.room = new RoomSocket(this.target, identify, {
      mediaBootstrap: (credentials) => this.onMediaBootstrap(credentials),
      mediaReady: (credentials) => this.onMediaReady(credentials),
      ready: (credentials, participants) =>
        this.onRoomReady(credentials, participants),
      resumed: (credentials, participants) =>
        this.onRoomResumed(credentials, participants),
      voiceStateUpdate: (participant, action) =>
        this.onVoiceStateUpdate(participant, action),
      profileUpdate: (update) =>
        this.updateParticipant(update.participantId, (previous) =>
          previous
            ? mergeParticipant(
                {
                  id: update.participantId,
                  name: update.name,
                  username: update.username,
                  display_name: update.displayName,
                  avatar_url: update.avatarUrl,
                },
                previous,
              )
            : null,
        ),
      error: (code, message) => log.warn(`Room error ${code}: ${message}`),
      ticketFailed: (error) => this.onRoomTicketFailed(error),
      disconnected: (giveUp) => {
        this.roomReady = false;
        this.refreshStatus();
        if (giveUp) this.failForGiveUp(giveUp);
      },
    });
    this.voice = new VoiceSocket(this.target, {
      voiceReady: (tracks, speaking) => this.onVoiceReady(tracks, speaking),
      trackOffered: (track) => this.onTrackOffered(track),
      speaking: (participantId, flags) =>
        this.setSpeaking(participantId, flags !== 0),
      clientDisconnect: (participantId) =>
        this.onClientDisconnect(participantId),
      stopTracks: (trackNames, tracks) => this.onStopTracks(trackNames, tracks),
      republishRequest: (request) => this.onRepublishRequest(request),
      appEvent: (event) => {
        if (!this.ended) options.onAppEvent(event);
      },
      error: (code, message) => {
        if (message === APP_EVENT_REJECTED) options.onAppEventRejected();
        else this.onVoiceError(code, message);
      },
      disconnected: (giveUp) => {
        this.voiceReady = false;
        this.refreshStatus();
        if (giveUp) this.failForGiveUp(giveUp);
      },
    });
    this.stopSpeakingDetector = startSpeakingDetector({
      sender: () => this.microphoneSender(),
      level: options.speakingLevel,
      onChange: (speaking) => this.onLocalSpeaking(speaking),
    });
  }

  /** Opens both sockets; the voice socket identifies once credentials land. */
  start(): void {
    this.room.connect();
    this.voice.connect();
  }

  /** The app is in front again: retry now, or probe the open sockets. */
  wake(): void {
    if (this.ended) return;
    this.room.wake();
    this.voice.wake();
  }

  leave(): void {
    this.end({ reason: "left" });
  }

  /**
   * Pull remote camera and screen video while true. The call screen sets it
   * while visible with the app in front; audio is unaffected either way.
   */
  setWatchingVideo(watching: boolean): void {
    if (this.ended) return;
    this.video.setWatching(watching);
  }

  /** Re-reads every pulled track's gain (a person's volume or mute changed). */
  refreshAudioGains(): void {
    for (const audio of this.remoteAudio.values()) this.applyGain(audio);
  }

  /**
   * Sends a voice-session app event (VoiceAppEvent), e.g. soundboard.play.
   * Queued until the voice socket is ready; the room echoes it to everyone,
   * us included.
   */
  sendAppEvent(d: Readonly<Record<string, unknown>>): void {
    if (this.ended) return;
    this.voice.send({ op: GatewayOp.VoiceAppEvent, d });
  }

  /** As the web's setIsMuted: unmuting while deafened undeafens too. */
  toggleMute(): void {
    const muted = !this.muted;
    const deafened = !muted && this.deafened ? false : this.deafened;
    if (!deafened) this.mutedBeforeDeafen = muted;
    this.setLocalState(muted, deafened);
  }

  /** As the web's setIsDeafened: deafen mutes; undeafen restores the mute. */
  toggleDeafen(): void {
    if (this.deafened) {
      this.setLocalState(this.mutedBeforeDeafen, false);
    } else {
      this.mutedBeforeDeafen = this.muted;
      this.setLocalState(true, true);
    }
  }

  /**
   * Publishes `stream` (one video track) as our camera, replacing the one on
   * air, or stops the camera with null. The session owns the stream from
   * here and stops it when it is replaced, turned off or the call ends.
   */
  setCamera(stream: MediaStream | null): void {
    if (this.ended) {
      if (stream) stopStream(stream);
      return;
    }
    const previous = this.camera;
    if (previous === stream) return;
    this.camera = stream;
    if (stream) this.cameraFacing = facingOf(stream);
    if (stream) {
      // An existing publication swaps its source track: no new SFU track.
      this.media?.publishStream(stream, MIC_PREFIX);
    } else {
      this.unpublishOwn(MIC_PREFIX);
    }
    if (previous) stopStream(previous);
    this.syncLocalMedia();
  }

  /**
   * Front to back camera and back, on the published track (no new SFU
   * track). Rejects when the phone has no other camera.
   */
  async flipCamera(): Promise<void> {
    const camera = this.camera;
    if (this.ended || !camera) return;
    const facing = await switchCamera(camera);
    if (this.camera !== camera) return;
    this.cameraFacing = facing;
    this.syncLocalMedia();
  }

  get cameraOn(): boolean {
    return this.camera !== null;
  }

  get facing(): CameraFacing {
    return this.cameraFacing;
  }

  /** Publishes a screen capture, or stops sharing with null. Owned as above. */
  setScreen(stream: MediaStream | null): void {
    if (this.ended) {
      if (stream) stopStream(stream);
      return;
    }
    const previous = this.screen;
    if (previous === stream) return;
    this.screen = stream;
    if (stream) this.media?.publishStream(stream, SCREEN_PREFIX);
    else this.unpublishOwn(SCREEN_PREFIX);
    if (previous) stopStream(previous);
    this.syncLocalMedia();
  }

  get sharingScreen(): boolean {
    return this.screen !== null;
  }

  isScreen(stream: MediaStream): boolean {
    return this.screen === stream;
  }

  // ── Credentials and media ────────────────────────────────────────────────

  private onMediaBootstrap(credentials: MediaCredentials): void {
    if (this.ended) return;
    // A reconnect's ticket names a new participant; the room resumes the old
    // one, so a bootstrap for anyone else is stale once the room admitted us.
    if (
      this.roomEstablished &&
      this.participantId !== credentials.participantId
    ) {
      return;
    }
    this.adoptCredentials(credentials);
  }

  private onMediaReady(credentials: MediaCredentials): void {
    if (this.ended) return;
    this.roomEstablished = true;
    this.adoptCredentials(credentials);
  }

  private adoptCredentials(credentials: MediaCredentials): void {
    if (
      this.participantId !== null &&
      this.participantId !== credentials.participantId
    ) {
      log.warn("The room gave us a new participant id; rebuilding media");
      this.previousParticipantIds.add(this.participantId);
      this.disposeMedia();
    }
    this.participantId = credentials.participantId;
    this.ensureMedia(credentials);
    this.voice.updateVoiceToken(credentials.voiceToken);
    this.voice.connectVoice(credentials.participantId, credentials.voiceToken);
  }

  private ensureMedia(credentials: MediaCredentials): void {
    if (
      this.media &&
      this.transport &&
      this.mediaParticipantId === credentials.participantId
    ) {
      this.transport.updateVoiceToken(credentials.voiceToken);
      return;
    }
    this.disposeMedia();
    const participantId = credentials.participantId;
    const transport = new PartyTracksTransport({
      roomSlug: this.target.roomSlug,
      participantId,
      voiceToken: credentials.voiceToken,
      iceServers: credentials.iceServers,
    });
    const media = new PartyTracksMediaManager(transport, participantId, {
      onPublicationMetadata: (track) => {
        if (track.kind === "video") void this.limitVideoSender(track);
        const d: VoiceClientPayload<GatewayOp.Video> = {
          tracks: [
            {
              participant_id: track.participant_id,
              track_name: track.track_name,
              sfu_track_name: track.sfu_track_name,
              session_id: track.session_id,
              kind: track.kind === "video" ? "video" : "audio",
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
      onRemoteTrack: ({ action, track, trackInfo }) => {
        if (track.kind === "video") {
          this.video.onTrack(action, track, trackInfo);
          return;
        }
        if (track.kind !== "audio") return;
        if (action === "add") {
          // Remote audio plays through WebRTC's own audio device; deafen
          // silences it by disabling the track, a person's volume by gain.
          const audio: RemoteAudio = {
            track,
            participantId: trackInfo.participant_id,
            source: trackInfo.track_name.startsWith(`${SCREEN_PREFIX}-`)
              ? "stream"
              : "voice",
          };
          this.remoteAudio.set(trackInfo.track_name, audio);
          this.applyGain(audio);
          log.info("Remote audio", trackInfo.track_name);
        } else if (
          this.remoteAudio.get(trackInfo.track_name)?.track === track
        ) {
          this.remoteAudio.delete(trackInfo.track_name);
        }
      },
      onConnectionState: (state) => {
        log.info(`Peer connection ${state}`);
        this.peerState = state;
        this.refreshStatus();
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
    });
    this.transport = transport;
    this.media = media;
    this.mediaParticipantId = participantId;
    this.peerState = "new";
    media.publishStream(this.microphone, MIC_PREFIX);
    if (this.camera) media.publishStream(this.camera, MIC_PREFIX);
    if (this.screen) media.publishStream(this.screen, SCREEN_PREFIX);
    if (this.deferredRemoteTracks.size > 0) {
      const deferred = [...this.deferredRemoteTracks.values()];
      this.deferredRemoteTracks.clear();
      media.offerTracks(deferred);
    }
    const video = this.video.pullable();
    if (video.length > 0) media.offerTracks(video);
    this.refreshStatus();
  }

  private disposeMedia(): void {
    this.media?.dispose();
    this.transport?.dispose();
    this.media = null;
    this.transport = null;
    this.mediaParticipantId = null;
    this.remoteAudio.clear();
    this.video.clearStreams();
  }

  /** Stops our `<prefix>-video-<participant>` publication, if any. */
  private unpublishOwn(prefix: string): void {
    if (!this.media || !this.mediaParticipantId) return;
    this.media.unpublishTrack(`${prefix}-video-${this.mediaParticipantId}`);
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
    const source = this.media?.getPublishedTrack(track.track_name);
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

  private microphoneSender(): RTCRtpSender | null {
    const track = this.microphone.getAudioTracks()[0];
    const peerConnection = this.transport?.peerConnection;
    if (!track || !peerConnection || this.muted) return null;
    return (
      peerConnection
        .getSenders()
        .find((sender) => sender.track?.id === track.id) ?? null
    );
  }

  // ── Room socket ──────────────────────────────────────────────────────────

  private onRoomReady(
    credentials: MediaCredentials,
    participants: readonly VoiceState[],
  ): void {
    if (this.ended) return;
    this.roomEstablished = true;
    this.adoptCredentials(credentials);
    this.roomReady = true;
    // The roster leaves us out: Ready is built before our session is stored.
    const self: CallParticipant = {
      id: credentials.participantId,
      userId: this.identity.userId,
      name: (this.identity.displayName ?? this.identity.name).trim(),
      avatarUrl: this.identity.avatarUrl,
      muted: this.muted,
      deafened: this.deafened,
      camera: this.camera !== null,
      sharing: this.screen !== null,
      username: this.identity.username,
    };
    this.replaceParticipants(participants, self);
    // The room starts us muted; tell it (and the channel) where we are.
    this.sendVoiceState();
    this.joinChannelPresence();
    this.scheduleCredentialRefresh();
    this.refreshStatus();
  }

  private onRoomResumed(
    credentials: Partial<MediaCredentials>,
    participants?: readonly VoiceState[],
  ): void {
    if (this.ended) return;
    if (credentials.voiceToken) {
      this.transport?.updateVoiceToken(credentials.voiceToken);
      this.voice.updateVoiceToken(credentials.voiceToken);
    }
    this.roomReady = true;
    if (participants && this.participantId) {
      this.replaceParticipants(participants, null);
    }
    if (!this.voice.isReady && this.participantId && credentials.voiceToken) {
      this.voice.connectVoice(this.participantId, credentials.voiceToken);
    }
    this.refreshStatus();
  }

  private onRoomTicketFailed(error: unknown): void {
    // Before the room ever admitted us, a refusal other than "signed out"
    // (no permission, not a voice channel) will not change by retrying.
    if (
      !this.everConnected &&
      !this.roomReady &&
      error instanceof ApiError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 401 &&
      error.status !== 429
    ) {
      this.end({
        reason: "failed",
        message:
          error.status === 403
            ? "You can't connect to this channel"
            : "This channel can't be joined",
      });
    }
  }

  private onVoiceStateUpdate(
    participant: VoiceState,
    action: "join" | "leave" | "update",
  ): void {
    if (action === "leave") {
      this.video.forgetParticipant(participant.id);
      this.media?.removeParticipant(participant.id);
      updateCall((call) => {
        if (!call.participants[participant.id]) return call;
        const participants = { ...call.participants };
        delete participants[participant.id];
        const speaking = { ...call.speaking };
        delete speaking[participant.id];
        return { ...call, participants, speaking };
      });
      return;
    }
    this.updateParticipant(participant.id, (previous) =>
      mergeParticipant(participant, previous ?? undefined),
    );
  }

  private replaceParticipants(
    states: readonly VoiceState[],
    self: CallParticipant | null,
  ): void {
    updateCall((call) => {
      const participants: Record<string, CallParticipant> = {};
      for (const state of states) {
        if (this.previousParticipantIds.has(state.id)) continue;
        participants[state.id] = mergeParticipant(
          state,
          call.participants[state.id],
        );
      }
      const selfEntry =
        self ?? (call.selfId ? (call.participants[call.selfId] ?? null) : null);
      if (selfEntry) participants[selfEntry.id] = selfEntry;
      return { ...call, selfId: selfEntry?.id ?? call.selfId, participants };
    });
  }

  private updateParticipant(
    id: string,
    update: (previous: CallParticipant | null) => CallParticipant | null,
  ): void {
    updateCall((call) => {
      const next = update(call.participants[id] ?? null);
      if (!next) return call;
      return { ...call, participants: { ...call.participants, [id]: next } };
    });
  }

  private scheduleCredentialRefresh(): void {
    if (this.credentialTimer) clearTimeout(this.credentialTimer);
    this.credentialTimer = setTimeout(() => {
      this.credentialTimer = null;
      if (this.ended) return;
      this.room.requestCredentialRefresh();
      this.scheduleCredentialRefresh();
    }, CREDENTIAL_REFRESH_MS);
  }

  // ── Voice socket ─────────────────────────────────────────────────────────

  private isOwnTrack(track: TrackInfo): boolean {
    return (
      track.participant_id === this.participantId ||
      track.session_id === this.participantId ||
      this.previousParticipantIds.has(track.participant_id)
    );
  }

  private onVoiceReady(
    tracks: readonly TrackInfo[],
    speaking: Readonly<Record<string, number>>,
  ): void {
    if (this.ended) return;
    this.voiceReady = true;
    const seen = new Set<string>();
    const remote = tracks.filter((track) => {
      if (this.isOwnTrack(track) || seen.has(track.track_name)) return false;
      seen.add(track.track_name);
      return true;
    });
    updateCall((call) => {
      const next: Record<string, true> = {};
      for (const [id, flags] of Object.entries(speaking)) {
        if (flags !== 0 && id !== call.selfId) next[id] = true;
      }
      if (call.selfId && this.localSpeaking) next[call.selfId] = true;
      return { ...call, speaking: next };
    });
    this.video.replaceOffers(remote.filter(isPullableVideo));
    if (this.media) {
      // Announce our publication before the replayed pulls queue their
      // negotiation behind it on the shared session.
      this.media.reannouncePublications();
      this.media.syncRemoteTracks([
        ...pullable(remote),
        ...this.video.pullable(),
      ]);
    } else {
      for (const track of pullable(remote)) {
        this.deferredRemoteTracks.set(track.track_name, track);
      }
    }
    if (this.localSpeaking) this.voice.sendSpeaking(SPEAKING_MICROPHONE);
    this.refreshStatus();
  }

  private onTrackOffered(track: TrackInfo): void {
    if (this.isOwnTrack(track)) return;
    if (isPullableVideo(track)) {
      this.video.offer(track);
      return;
    }
    const tracks = pullable([track]);
    if (tracks.length === 0) return;
    if (this.media) this.media.offerTracks(tracks);
    else this.deferredRemoteTracks.set(track.track_name, track);
  }

  private onStopTracks(
    trackNames: readonly string[],
    tracks?: readonly TrackInfo[],
  ): void {
    for (const trackName of trackNames) {
      this.deferredRemoteTracks.delete(trackName);
    }
    this.video.forget(trackNames);
    const stopped = trackNames.filter(
      (trackName) =>
        tracks?.some(
          (track) =>
            track.track_name === trackName && Boolean(track.sfu_track_name),
        ) || this.media?.hasRemoteOffer(trackName),
    );
    if (stopped.length > 0) this.media?.stopRemoteTracks(stopped);
  }

  private onClientDisconnect(participantId: string): void {
    for (const [trackName, track] of this.deferredRemoteTracks) {
      if (track.participant_id === participantId) {
        this.deferredRemoteTracks.delete(trackName);
      }
    }
    this.video.forgetParticipant(participantId);
    this.media?.removeParticipant(participantId);
    this.setSpeaking(participantId, false);
  }

  /**
   * A listener could not pull one of our publications and the voice room
   * checked it is our current one: push it again under a new SFU track. Only
   * for the SFU track we still announce, at most once per 5 s per track
   * (sfu-client.ts handleRepublishRequest).
   */
  private onRepublishRequest(request: RepublishRequest): void {
    if (this.ended || !this.media) return;
    const current = this.media.getPublicationMetadata(request.track_name);
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
    this.media.republishTrack(request.track_name);
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

  private failForGiveUp(giveUp: SocketGiveUp): void {
    this.end({ reason: "failed", message: GIVE_UP_MESSAGE[giveUp] });
  }

  // ── Speaking ─────────────────────────────────────────────────────────────

  private setSpeaking(participantId: string, speaking: boolean): void {
    updateCall((call) => {
      // Our own LED follows the local detector, not the relayed echo.
      if (participantId === call.selfId) return call;
      if ((call.speaking[participantId] === true) === speaking) return call;
      const next = { ...call.speaking };
      if (speaking) next[participantId] = true;
      else delete next[participantId];
      return { ...call, speaking: next };
    });
  }

  private onLocalSpeaking(speaking: boolean): void {
    if (this.ended) return;
    this.localSpeaking = speaking;
    this.voice.sendSpeaking(speaking ? SPEAKING_MICROPHONE : 0);
    updateCall((call) => {
      if (!call.selfId) return call;
      const next = { ...call.speaking };
      if (speaking) next[call.selfId] = true;
      else delete next[call.selfId];
      return { ...call, speaking: next };
    });
  }

  // ── Local state ──────────────────────────────────────────────────────────

  /** Deafen silences everyone; otherwise their gain, where 0 also disables. */
  private applyGain(audio: RemoteAudio): void {
    const gain = this.audioGain(audio.participantId, audio.source);
    audio.track.enabled = !this.deafened && gain > 0;
    if (gain > 0) setTrackGain(audio.track, gain);
  }

  private applyMicrophoneGate(): void {
    for (const track of this.microphone.getAudioTracks()) {
      track.enabled = !this.muted;
    }
  }

  private setLocalState(muted: boolean, deafened: boolean): void {
    if (this.ended) return;
    this.muted = muted;
    this.deafened = deafened;
    this.applyMicrophoneGate();
    for (const audio of this.remoteAudio.values()) this.applyGain(audio);
    updateCall((call) => {
      const self = call.selfId ? call.participants[call.selfId] : undefined;
      return {
        ...call,
        muted,
        deafened,
        participants: self
          ? { ...call.participants, [self.id]: { ...self, muted, deafened } }
          : call.participants,
      };
    });
    if (this.roomReady || this.everConnected) this.sendVoiceState();
  }

  private voiceStatePayload(): MainClientPayload<GatewayOp.VoiceStateUpdate> {
    return {
      self_mute: this.muted,
      self_deaf: this.deafened,
      self_video: this.camera !== null,
      self_stream: this.screen !== null,
      self_stream_audio: false,
    };
  }

  /** Our camera and share into the store and voice state. */
  private syncLocalMedia(): void {
    const camera = this.camera ? streamUrl(this.camera) : null;
    const sharing = this.screen !== null;
    const mirror = this.cameraFacing === "front";
    updateCall((call) => {
      const self = call.selfId ? call.participants[call.selfId] : undefined;
      return {
        ...call,
        local: { camera, mirror, sharing },
        participants: self
          ? {
              ...call.participants,
              [self.id]: { ...self, camera: camera !== null, sharing },
            }
          : call.participants,
      };
    });
    if (this.roomReady || this.everConnected) this.sendVoiceState();
  }

  /** The room roster and the channel tree both carry mute and deafen. */
  private sendVoiceState(): void {
    const d = this.voiceStatePayload();
    this.room.sendVoiceState(d);
    if (this.joinedChannel) sendVoiceStateUpdate(d);
  }

  private joinChannelPresence(): void {
    if (this.joinedChannel) return;
    this.joinedChannel = true;
    const assert = () => {
      if (this.ended) return;
      sendVoiceChannelJoin({
        channel_id: this.target.channelId,
        self_mute: this.muted,
      });
      sendVoiceStateUpdate(this.voiceStatePayload());
    };
    assert();
    const offReady = onGatewayReady(assert);
    const timer = setInterval(assert, PRESENCE_REASSERT_MS);
    this.stopPresence = () => {
      offReady();
      clearInterval(timer);
    };
  }

  private refreshStatus(): void {
    if (this.ended) return;
    const mediaConnected =
      this.media !== null &&
      (this.peerState === "connected" || !this.media.hasPublications);
    let status: CallStatus;
    if (this.roomReady && this.voiceReady && mediaConnected) {
      status = "connected";
      this.everConnected = true;
    } else {
      status = this.everConnected ? "reconnecting" : "joining";
    }
    updateCall((call) => (call.status === status ? call : { ...call, status }));
  }

  private end(end: SessionEnd): void {
    if (this.ended) return;
    this.ended = true;
    log.info(`Leaving (${end.reason})`, end.message ?? "");
    this.stopSpeakingDetector();
    this.stopPresence?.();
    this.stopPresence = null;
    if (this.credentialTimer) clearTimeout(this.credentialTimer);
    this.credentialTimer = null;
    this.room.stop();
    this.voice.stop();
    this.disposeMedia();
    this.deferredRemoteTracks.clear();
    this.video.clear();
    stopStream(this.microphone);
    if (this.camera) stopStream(this.camera);
    if (this.screen) stopStream(this.screen);
    this.camera = null;
    this.screen = null;
    if (this.joinedChannel) sendVoiceChannelLeave(this.target.channelId);
    this.onEnd(end);
  }
}
