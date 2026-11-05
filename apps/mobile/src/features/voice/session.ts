import type { GatewayOp, MainClientPayload } from "@ralph/protocol";
import {
  PublicationReconciler,
  RemoteReconnectGrace,
  ScreenShare,
  VoiceSession,
  type ScreenCapture,
  type ScreenShareEvent,
  type TeardownSteps,
  type VoiceEndReason,
  type VoiceTimers,
} from "@ralph/voice";

import {
  sendVoiceChannelJoin,
  sendVoiceChannelLeave,
} from "@/features/realtime/gateway";
import { ApiError } from "@/lib/api";

import {
  CallConnection,
  type ConnectionEvents,
  type RemoteTrackEvent,
} from "./connection";
import type { SocketGiveUp } from "./gateways";
import {
  type CameraFacing,
  facingOf,
  stopStream,
  streamUrl,
  switchCamera,
} from "./local-media";
import {
  SPEAKING_MICROPHONE,
  type TrackInfo,
  type VoiceAppEvent,
  type VoiceState,
} from "./protocol";
import { isPullableVideo, isVideoAlias, RemoteVideo } from "./remote-video";
import { startSpeakingDetector } from "./speaking";
import { updateCall, type CallParticipant, type CallStatus } from "./store";
import type { CallTarget } from "./tickets";

// One call, on the voice lifecycle every Yap client shares (@ralph/voice,
// packages/voice/STATE_MACHINE.md):
//
// - VoiceSession holds the phase (connecting, joined, reconnecting,
//   leaving) and runs the one teardown, whichever way the call ends: a
//   leave, a socket that gave up (replaced, auth failed, refused) or a
//   channel that cannot be joined.
// - PublicationReconciler is the only code that publishes, swaps or
//   withdraws the microphone, camera and screen share; mute is its
//   setEnabled. A new media session or a voice room that came back without
//   our publications republishes them (connection reset).
// - ScreenShare serializes starting and stopping a share (Android's
//   MediaProjection capture) and Android's own Stop.
// - RemoteReconnectGrace keeps a participant whose voice socket reconnects
//   for 3 s after a ClientDisconnect (VoiceRoom holds their tracks without
//   one, but sends one if the hold runs out first) instead of dropping
//   their audio; only the room socket decides who left.
//
// The sockets and the PartyTracks media session are CallConnection's.
// Audio is always pulled; remote video only while the call screen watches
// (./remote-video).

const log = {
  info: (message: string, ...args: unknown[]) =>
    console.log(`[Voice] ${message}`, ...args),
  warn: (message: string, ...args: unknown[]) =>
    console.warn(`[Voice] ${message}`, ...args),
};

const timers: VoiceTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const GIVE_UP_MESSAGE: Record<SocketGiveUp, string> = {
  replaced: "You joined this call somewhere else",
  "auth-failed": "Your session ended",
  "admission-rejected": "The call turned you away",
};

/** A phone shares the whole screen: one source, one quality. */
type ScreenSource = "screen";
interface PhoneScreenCapture extends ScreenCapture<MediaStreamTrack> {
  readonly stream: MediaStream;
}

export interface SessionIdentity {
  readonly userId: string;
  readonly name: string;
  readonly username: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
}

/** A voice track's source: their microphone, or their shared screen's audio. */
export type AudioSource = "voice" | "stream";

export interface SessionEnd {
  readonly reason: "left" | "failed";
  readonly message?: string;
}

/** How the app captures the screen (the call service owns its permission). */
export interface ScreenCaptureSource {
  /** Android's consent dialog, then the capture. Rejects when it cannot. */
  capture(): Promise<MediaStream>;
  /** Stops the capture's tracks and drops the service's mediaProjection type. */
  release(stream: MediaStream): void;
}

export interface SessionOptions {
  readonly target: CallTarget;
  readonly identity: SessionIdentity;
  /** The microphone, already captured. The session owns it from here. */
  readonly microphone: MediaStream;
  readonly muted: boolean;
  readonly deafened: boolean;
  /** A DM call: no channel presence of its own beyond the DM channel. */
  readonly isCall: boolean;
  /** The microphone level (0..1) that counts as speaking, read live. */
  readonly speakingLevel: () => number;
  /**
   * The gain (0..2, 0 silences) one participant's voice or share audio plays
   * at, read whenever a track arrives and on refreshAudioGains().
   */
  readonly audioGain: (participantId: string, source: AudioSource) => number;
  readonly screenCapture: ScreenCaptureSource;
  /** A screen share could not start (declined, or the capture failed). */
  readonly onScreenShareFailed: (error: unknown) => void;
  /** A voice-session app event (the soundboard), ours echoed back too. */
  readonly onAppEvent: (event: VoiceAppEvent) => void;
  /** The voice room refused an app event we sent. */
  readonly onAppEventRejected: () => void;
  /** The call is over (the teardown ran); once. */
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

export class CallSession {
  private readonly target: CallTarget;
  private readonly identity: SessionIdentity;
  private readonly options: SessionOptions;
  private readonly microphone: MediaStream;
  /** Our camera capture while on; the session owns it. */
  private camera: MediaStream | null = null;
  private cameraFacing: CameraFacing = "front";
  /** Whether our share is on for peers (ScreenShare started → ended). */
  private sharing = false;

  private readonly voice = new VoiceSession<CallConnection>({
    timers,
    onStepError: (step, error) => log.warn(`Teardown step ${step}`, error),
  });
  private readonly connection: CallConnection;
  private readonly publication: PublicationReconciler<MediaStreamTrack>;
  private readonly screenShare: ScreenShare<
    MediaStreamTrack,
    ScreenSource,
    PhoneScreenCapture
  >;
  private readonly grace = new RemoteReconnectGrace({
    timers,
    expire: (participantId, reoffered) =>
      this.dropDisconnected(participantId, reoffered),
  });
  private readonly video = new RemoteVideo(() => this.connection);
  /** Pulled audio by alias: deafen and each person's gain apply here. */
  private readonly remoteAudio = new Map<string, RemoteAudio>();

  private peerState: RTCPeerConnectionState = "new";
  /** The call's handlers on the connection are live (see start). */
  private listening = false;
  private everConnected = false;
  private joinedChannel = false;
  private endMessage: SessionEnd | null = null;

  private muted: boolean;
  private deafened: boolean;
  private mutedBeforeDeafen: boolean;
  private localSpeaking = false;
  private readonly stopSpeakingDetector: () => void;

  constructor(options: SessionOptions) {
    this.options = options;
    this.target = options.target;
    this.identity = options.identity;
    this.microphone = options.microphone;
    this.muted = options.muted || options.deafened;
    this.deafened = options.deafened;
    this.mutedBeforeDeafen = options.muted;

    const identify: MainClientPayload<GatewayOp.Identify> = {
      name: this.identity.name,
      username: this.identity.username,
      display_name: this.identity.displayName,
      avatar_url: this.identity.avatarUrl,
      platform: "mobile",
      supports_voice_state_deltas: true,
    };
    this.connection = new CallConnection(
      this.target,
      identify,
      this.whileListening({
        roomReady: (participantId, participants) =>
          this.onRoomReady(participantId, participants),
        roomResumed: (participants) => this.onRoomResumed(participants),
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
        roomLost: () => {
          this.voice.connectionLost();
          this.refreshStatus();
        },
        roomTicketFailed: (error) => this.onRoomTicketFailed(error),
        voiceReady: (tracks, speaking) => this.onVoiceReady(tracks, speaking),
        voiceLost: () => this.refreshStatus(),
        trackOffered: (track) => this.onTrackOffered(track),
        stopTracks: (trackNames) => {
          for (const trackName of trackNames) this.video.forget(trackName);
        },
        speaking: (participantId, flags) =>
          this.setSpeaking(participantId, flags !== 0),
        clientDisconnect: (participantId) => {
          // Their voice socket may only be reconnecting: keep them (and
          // their audio) through the grace. Speaking stops now.
          this.grace.disconnected(participantId);
          this.setSpeaking(participantId, false);
        },
        appEvent: (event) => {
          if (this.voice.isLive) options.onAppEvent(event);
        },
        appEventRejected: () => options.onAppEventRejected(),
        mediaReset: () => {
          this.publication.connectionReset();
          this.refreshStatus();
        },
        peerState: (state) => this.onPeerState(state),
        remoteTrack: (event) => this.onRemoteTrack(event),
        videoFlow: () =>
          this.video.refreshFlows((track) =>
            this.connection.videoFlowOf(track),
          ),
        giveUp: (reason) => this.fail(GIVE_UP_MESSAGE[reason]),
      }),
    );

    this.publication = new PublicationReconciler<MediaStreamTrack>({
      media: this.connection.publications,
      timers,
      onOpError: (op, error, failures) =>
        log.warn("Publication operation failed", {
          op: op.kind,
          slot: op.slot,
          failures,
          error,
        }),
    });
    const micTrack = this.microphone.getAudioTracks()[0] ?? null;
    if (micTrack) micTrack.enabled = !this.muted;
    this.publication.setTrack("microphone", micTrack);
    this.publication.setEnabled("microphone", !this.muted);

    this.screenShare = new ScreenShare({
      publication: this.publication,
      sources: {
        native: null,
        browser: {
          capture: async () => {
            this.connection.prepareVideoKeepalives();
            const stream = await options.screenCapture.capture();
            const video = stream.getVideoTracks()[0] ?? null;
            const capture: PhoneScreenCapture = {
              path: "browser",
              video,
              audio: null,
              stream,
            };
            // Android's own Stop (the status bar chip, the cast tile) ends it.
            video?.addEventListener("ended", () =>
              this.screenShare.captureEnded(capture),
            );
            return capture;
          },
          applyQuality: () => {},
        },
        releaseBeforeRestart: () => true,
        isLive: (capture) => capture.video?.readyState === "live",
        release: (capture) => options.screenCapture.release(capture.stream),
      },
      onError: (step, error) => log.warn(`Screen share ${step}`, error),
    });
    this.screenShare.subscribe((event) => this.onScreenShareEvent(event));

    this.stopSpeakingDetector = startSpeakingDetector({
      sender: () => this.microphoneSender(),
      level: options.speakingLevel,
      onChange: (speaking) => this.onLocalSpeaking(speaking),
    });
  }

  /** Opens both sockets; the voice socket identifies once credentials land. */
  start(): void {
    const lease = this.voice.start(this.connection);
    if (!lease) return;
    // Teardown step 3: nothing the connection says during the leave's send
    // window (a late Ready, a remote track) touches the torn-down call.
    lease.addCleanup(() => {
      this.listening = false;
    });
    this.listening = true;
    this.connection.start();
  }

  /** The connection's events, dropped once the teardown unsubscribed. */
  private whileListening(events: ConnectionEvents): ConnectionEvents {
    const guarded = {} as Record<string, (...args: never[]) => void>;
    for (const [name, handler] of Object.entries(events) as Array<
      [string, (...args: never[]) => void]
    >) {
      guarded[name] = (...args) => {
        if (this.listening) handler(...args);
      };
    }
    return guarded as unknown as ConnectionEvents;
  }

  /** The app is in front again (or the network is back): see CallConnection.wake. */
  wake(options: { readonly networkChanged?: boolean } = {}): void {
    if (this.voice.isLive) this.connection.wake(options);
  }

  leave(): void {
    this.end("user-leave", { reason: "left" });
  }

  /**
   * Pull remote camera and screen video while true. The call screen sets it
   * while visible with the app in front; audio is unaffected either way.
   */
  setWatchingVideo(watching: boolean): void {
    if (this.voice.isLive) this.video.setWatching(watching);
  }

  /**
   * The app went to the background (outside PiP), or came back: in the
   * background no remote video is pulled at all (see RemoteVideo).
   */
  setInBackground(background: boolean): void {
    if (this.voice.isLive) this.video.setBackground(background);
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
    if (this.voice.isLive) this.connection.sendAppEvent(d);
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
   * Publishes `stream` (one video track) as our camera, swapping the one on
   * air, or withdraws the camera with null (its SFU track stays alive on a
   * keepalive, so turning it back on reaches viewers at once). The session
   * owns the stream from here and stops it when it is replaced, turned off
   * or the call ends.
   */
  setCamera(stream: MediaStream | null): void {
    if (!this.voice.isLive) {
      if (stream) stopStream(stream);
      return;
    }
    const previous = this.camera;
    if (previous === stream) return;
    this.camera = stream;
    if (stream) {
      this.cameraFacing = facingOf(stream);
      this.connection.prepareVideoKeepalives();
    }
    this.publication.setTrack("camera", stream?.getVideoTracks()[0] ?? null);
    this.syncLocalMedia();
    if (!previous) {
      void this.reconcile();
      return;
    }
    // The old capture is stopped once the sender no longer holds it.
    void this.reconcile().finally(() => {
      if (this.camera !== previous) stopStream(previous);
    });
  }

  /**
   * Front to back camera and back, on the published track (no new SFU
   * track). Rejects when the phone has no other camera.
   */
  async flipCamera(): Promise<void> {
    const camera = this.camera;
    if (!this.voice.isLive || !camera) return;
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

  /** Starts sharing the screen, or stops a share that is on or starting. */
  toggleScreenShare(): void {
    if (!this.voice.isLive) return;
    if (this.screenShare.wanted) {
      this.screenShare.stop();
      return;
    }
    this.screenShare.start({
      source: "screen",
      sourceKey: null,
      quality: "phone",
      audio: false,
      preferNative: false,
    });
  }

  stopScreenShare(): void {
    this.screenShare.stop();
  }

  /** On for peers, or on its way. */
  get sharingScreen(): boolean {
    return this.screenShare.wanted !== null;
  }

  // ── Publication ──────────────────────────────────────────────────────────

  /** Runs the reconciler once the media session exists (it publishes then). */
  private async reconcile(): Promise<void> {
    if (!this.connection.media) return;
    const result = await this.publication.reconcile();
    if (result.status === "failed") {
      log.warn("Publication did not converge", result.failedSlots);
    }
  }

  private microphoneSender(): RTCRtpSender | null {
    const track = this.microphone.getAudioTracks()[0];
    const peerConnection = this.connection.peerConnection;
    if (!track || !peerConnection || this.muted) return null;
    return (
      peerConnection
        .getSenders()
        .find((sender) => sender.track?.id === track.id) ?? null
    );
  }

  private onScreenShareEvent(
    event: ScreenShareEvent<ScreenSource, PhoneScreenCapture>,
  ): void {
    if (event.type === "started") {
      this.sharing = true;
      this.syncLocalMedia();
    } else if (event.type === "ended") {
      this.sharing = false;
      this.syncLocalMedia();
      if (event.reason === "failed") {
        this.options.onScreenShareFailed(event.error);
      }
    }
  }

  // ── Room socket ──────────────────────────────────────────────────────────

  private onRoomReady(
    participantId: string,
    participants: readonly VoiceState[],
  ): void {
    const joined = this.voice.markJoined();
    if (!joined) return;
    // The roster leaves us out: Ready is built before our session is stored.
    const self: CallParticipant = {
      id: participantId,
      userId: this.identity.userId,
      name: (this.identity.displayName ?? this.identity.name).trim(),
      avatarUrl: this.identity.avatarUrl,
      muted: this.muted,
      deafened: this.deafened,
      camera: this.camera !== null,
      sharing: this.sharing,
      username: this.identity.username,
    };
    this.replaceParticipants(participants, self);
    // The room starts us muted; tell it where we are.
    this.sendVoiceState();
    // Our channel presence, on the first Ready and again on a re-Ready (the
    // room session was new: STATE_MACHINE "Transitions", note 1). The room
    // is the roster's authority (realtime/VOICE_ROSTER.md); this names the
    // channel for the chat socket, once, with no 30 s re-send.
    this.joinedChannel = true;
    sendVoiceChannelJoin({
      channel_id: this.target.channelId,
      self_mute: this.muted,
    });
    this.refreshStatus();
  }

  private onRoomResumed(participants?: readonly VoiceState[]): void {
    this.voice.connectionRestored();
    if (participants && this.connection.participantId) {
      this.replaceParticipants(participants, null);
    }
    this.refreshStatus();
  }

  private onRoomTicketFailed(error: unknown): void {
    // Before the room ever admitted us, a refusal other than "signed out"
    // (no permission, not a voice channel) will not change by retrying.
    if (
      !this.everConnected &&
      !this.voice.isJoined &&
      error instanceof ApiError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 401 &&
      error.status !== 429
    ) {
      this.fail(
        error.status === 403
          ? "You can't connect to this channel"
          : "This channel can't be joined",
      );
    }
  }

  private onVoiceStateUpdate(
    participant: VoiceState,
    action: "join" | "leave" | "update",
  ): void {
    if (action === "leave") {
      // The room decides who left: no grace for a real leave.
      this.grace.left(participant.id);
      this.connection.dropParticipant(participant.id);
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
      // A delta for someone we have no row for cannot be shown (no name):
      // the next full state creates the row.
      previous || participant.name !== undefined
        ? mergeParticipant(participant, previous ?? undefined)
        : null,
    );
  }

  private replaceParticipants(
    states: readonly VoiceState[],
    self: CallParticipant | null,
  ): void {
    updateCall((call) => {
      const participants: Record<string, CallParticipant> = {};
      for (const state of states) {
        // Our earlier participant ids linger in a roster after a rebuild.
        if (this.connection.isPreviousParticipant(state.id)) continue;
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

  // ── Voice socket and media ───────────────────────────────────────────────

  private noteOffer(track: TrackInfo): void {
    this.grace.offered(track.participant_id, track.track_name);
    if (isPullableVideo(track) && isVideoAlias(track.track_name)) {
      this.video.noteOffer(track.track_name);
    }
  }

  private onVoiceReady(
    tracks: readonly TrackInfo[],
    speaking: Readonly<Record<string, number>>,
  ): void {
    for (const track of tracks) this.noteOffer(track);
    updateCall((call) => {
      const next: Record<string, true> = {};
      for (const [id, flags] of Object.entries(speaking)) {
        if (flags !== 0 && id !== call.selfId) next[id] = true;
      }
      if (call.selfId && this.localSpeaking) next[call.selfId] = true;
      return { ...call, speaking: next };
    });
    if (this.localSpeaking) this.connection.sendSpeaking(SPEAKING_MICROPHONE);
    this.voice.connectionRestored();
    this.refreshStatus();
  }

  private onTrackOffered(track: TrackInfo): void {
    this.noteOffer(track);
  }

  /** Their grace ran out: drop what they did not offer again. */
  private dropDisconnected(
    participantId: string,
    reoffered: ReadonlySet<string>,
  ): void {
    if (!this.voice.isLive) return;
    this.connection.dropParticipant(participantId, reoffered);
  }

  private onPeerState(state: RTCPeerConnectionState): void {
    this.peerState = state;
    if (state === "connected") this.voice.connectionRestored();
    else if (state === "disconnected" || state === "failed") {
      this.voice.connectionLost();
    }
    this.refreshStatus();
  }

  private onRemoteTrack({ action, track, trackInfo }: RemoteTrackEvent): void {
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
        source: trackInfo.track_name.startsWith("screen-") ? "stream" : "voice",
      };
      this.remoteAudio.set(trackInfo.track_name, audio);
      this.applyGain(audio);
      log.info("Remote audio", trackInfo.track_name);
    } else if (this.remoteAudio.get(trackInfo.track_name)?.track === track) {
      this.remoteAudio.delete(trackInfo.track_name);
    }
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
    if (!this.voice.isLive) return;
    this.localSpeaking = speaking;
    this.connection.sendSpeaking(speaking ? SPEAKING_MICROPHONE : 0);
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
    const gain = this.options.audioGain(audio.participantId, audio.source);
    audio.track.enabled = !this.deafened && gain > 0;
    if (gain > 0) setTrackGain(audio.track, gain);
  }

  private setLocalState(muted: boolean, deafened: boolean): void {
    if (!this.voice.isLive) return;
    this.muted = muted;
    this.deafened = deafened;
    // Mute moves no publication: the reconciler applies it to the
    // published microphone at once, or after a publish in flight lands.
    this.publication.setEnabled("microphone", !muted);
    const micTrack = this.microphone.getAudioTracks()[0];
    if (micTrack && !this.connection.media) micTrack.enabled = !muted;
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
    if (this.voice.isJoined) this.sendVoiceState();
  }

  private voiceStatePayload(): MainClientPayload<GatewayOp.VoiceStateUpdate> {
    return {
      self_mute: this.muted,
      self_deaf: this.deafened,
      self_video: this.camera !== null,
      self_stream: this.sharing,
      self_stream_audio: false,
    };
  }

  /** Our camera and share into the store and voice state. */
  private syncLocalMedia(): void {
    const camera = this.camera ? streamUrl(this.camera) : null;
    const sharing = this.sharing;
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
    if (this.voice.isJoined) this.sendVoiceState();
  }

  /**
   * The room roster carries mute, deafen, camera and share (room op 15).
   * The chat socket's copy is gone: the room pushes the roster to it
   * (realtime/VOICE_ROSTER.md).
   */
  private sendVoiceState(): void {
    this.connection.sendRoomVoiceState(this.voiceStatePayload());
  }

  /**
   * The phase says whether we are in the call; the label also waits for the
   * voice socket and the peer connection, as before.
   */
  private refreshStatus(): void {
    if (!this.voice.isLive) return;
    const media = this.connection.media;
    const mediaConnected =
      media !== null &&
      (this.peerState === "connected" || !media.hasPublications);
    let status: CallStatus;
    if (
      this.voice.phase === "joined" &&
      this.connection.voiceReady &&
      mediaConnected
    ) {
      status = "connected";
      this.everConnected = true;
    } else {
      status =
        this.everConnected || this.voice.phase === "reconnecting"
          ? "reconnecting"
          : "joining";
    }
    updateCall((call) => (call.status === status ? call : { ...call, status }));
  }

  // ── Teardown ─────────────────────────────────────────────────────────────

  private fail(message: string): void {
    this.end("forced-disconnect", { reason: "failed", message });
  }

  /** The one teardown (STATE_MACHINE "Teardown"); a second call does nothing. */
  private end(reason: VoiceEndReason, end: SessionEnd): void {
    if (!this.voice.isLive) return;
    this.endMessage = end;
    log.info(`Leaving (${end.reason})`, end.message ?? "");
    const steps: TeardownSteps<CallConnection> = {
      // No local leave sound or automatic soundboard trigger on a phone.
      releaseLocalMedia: () => {
        this.screenShare.dispose();
        this.publication.dispose();
        this.stopSpeakingDetector();
        stopStream(this.microphone);
        if (this.camera) stopStream(this.camera);
        this.camera = null;
        this.sharing = false;
      },
      clearSessionState: ({ plan }) => {
        this.grace.dispose();
        this.remoteAudio.clear();
        this.video.clear();
        if (plan.clearPresence && this.joinedChannel) {
          sendVoiceChannelLeave(this.target.channelId);
        }
        this.joinedChannel = false;
        // The app's own reset (store, call service, toasts): every end,
        // whatever the plan says about `left`, so nothing of the call stays.
        this.options.onEnd(this.endMessage ?? end);
      },
    };
    // No leave trigger on a phone, so no send window either: ClientDisconnect
    // and the sockets' close go out within this teardown, in the same turn
    // as onEnd's release of the call service and audio (see TeardownOptions).
    this.voice.end(reason, steps, {
      isCall: this.options.isCall,
      leaveTrigger: false,
    });
  }
}
