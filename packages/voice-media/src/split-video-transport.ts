import {
  BehaviorSubject,
  defer,
  EMPTY,
  finalize,
  merge,
  type Observable,
  Subject,
  type Subscription,
  switchMap,
  take,
} from "rxjs";
import type { PartyTracksMediaTransport } from "./partytracks-media-manager";
import type { PartyTracksPullError } from "./partytracks-pull-errors";
import type {
  RalphPublishedTrack,
  RalphPullOptions,
  RalphPushOptions,
} from "./partytracks-transport";
import type { IceServer, TrackInfo } from "./track-info";

// Video pulls on PartyTracks sessions of their own, beside the main one that
// pushes our tracks and pulls the rest.
//
// A video session lasts while it pulls something. Once its last pull
// closes it drains for a moment, so PartyTracks can close those pulls at
// the SFU (tracks/close) and the SFU stops sending, and is then dropped.
// The next video pull starts a new session on a new peer connection. That
// is what makes pulling again after a close safe: on the same connection
// the SFU recycles the closed m-line under its old MID with other RTP header
// extension IDs, which libwebrtc rejects (packages/voice/SCREEN_SHARE.md,
// "Watching"), while a new connection has no closed m-lines.
//
// Two ways to use it:
// - "all" (the Expo app): every video pull runs on the video session, so
//   closing them all when the app goes behind drops that connection.
// - "fresh" (the web): pulls stay on the main session, except the ones the
//   media manager asks to make fresh (RalphPullOptions.fresh: a camera
//   pulled again after its pull closed or stalled).
// Either way a fresh pull starts a new video session: the current one takes
// no new pulls and goes once its own have closed.

/** The part of PartyTracksTransport this transport drives. */
export interface SplitTransportSession extends PartyTracksMediaTransport {
  readonly peerConnection$?: Observable<RTCPeerConnection>;
  readonly session$?: Observable<{
    peerConnection: RTCPeerConnection;
    sessionId: string;
  }>;
  /** The session's current peer connection, if it has one yet. */
  readonly peerConnection?: RTCPeerConnection | null;
  updateVoiceToken(voiceToken: string): void;
  updateIceServers(iceServers: IceServer[]): void;
  dispose(): void;
}

export interface SplitTransportOptions {
  /** Makes a video session with the latest credentials. */
  readonly createVideoSession: () => SplitTransportSession;
  /** Which video pulls run on video sessions; defaults to "all". */
  readonly videoPulls?: "all" | "fresh";
  /** How long a video session with nothing pulled is kept before it goes. */
  readonly drainMs?: number;
  readonly schedule?: (run: () => void, delayMs: number) => () => void;
  /** Told when a video session opens or closes (logs). */
  readonly onVideoSession?: (event: "opened" | "closed") => void;
}

/**
 * Long enough for PartyTracks to batch the closes (one tick), renegotiate
 * and send tracks/close; a phone on cellular answers that in well under 2 s.
 */
export const VIDEO_SESSION_DRAIN_MS = 3_000;

function scheduleWithTimers(run: () => void, delayMs: number): () => void {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
}

interface VideoSession {
  readonly transport: SplitTransportSession;
  readonly errors: Subscription;
  pulls: number;
  /** Takes no new pull: retired for a fresh one, or drained. */
  closed: boolean;
  cancelDrain?: () => void;
}

export class SplitVideoTransport implements PartyTracksMediaTransport {
  readonly peerConnectionState$: Observable<RTCPeerConnectionState>;
  readonly peerConnection$: Observable<RTCPeerConnection>;
  readonly session$: Observable<{
    peerConnection: RTCPeerConnection;
    sessionId: string;
  }>;
  readonly pullErrors$: Observable<PartyTracksPullError>;

  private readonly createVideoSession: () => SplitTransportSession;
  private readonly videoPulls: "all" | "fresh";
  private readonly drainMs: number;
  private readonly schedule: (run: () => void, delayMs: number) => () => void;
  private readonly onVideoSession?: (event: "opened" | "closed") => void;
  private readonly current$ = new BehaviorSubject<VideoSession | null>(null);
  /** Every open video session but the current one. */
  private readonly others = new Set<VideoSession>();
  private readonly videoPullErrors$ = new Subject<PartyTracksPullError>();
  private disposed = false;

  constructor(
    private readonly main: SplitTransportSession,
    options: SplitTransportOptions,
  ) {
    this.createVideoSession = options.createVideoSession;
    this.videoPulls = options.videoPulls ?? "all";
    this.drainMs = options.drainMs ?? VIDEO_SESSION_DRAIN_MS;
    this.schedule = options.schedule ?? scheduleWithTimers;
    this.onVideoSession = options.onVideoSession;
    // The call's connection is the main session's: video comes and goes.
    this.peerConnectionState$ = main.peerConnectionState$;
    this.peerConnection$ = main.peerConnection$ ?? EMPTY;
    this.session$ = main.session$ ?? EMPTY;
    this.pullErrors$ = merge(main.pullErrors$ ?? EMPTY, this.videoPullErrors$);
  }

  /** Video sessions open now, draining ones included (diagnostics, tests). */
  get videoSessionCount(): number {
    return this.others.size + (this.current$.value ? 1 : 0);
  }

  /** The main session's peer connection. */
  get peerConnection(): RTCPeerConnection | null {
    return this.main.peerConnection ?? null;
  }

  /** The receiver of a pulled `track`, on whichever session pulls it. */
  receiverFor(track: MediaStreamTrack): RTCRtpReceiver | null {
    const sessions = [this.main, ...this.videoSessions()];
    for (const session of sessions) {
      const receiver = session.peerConnection
        ?.getReceivers()
        .find((candidate) => candidate.track === track);
      if (receiver) return receiver;
    }
    return null;
  }

  /** Whether `track` is pulled on the main session. */
  isOnMainSession(track: MediaStreamTrack): boolean {
    return (
      this.main.peerConnection
        ?.getReceivers()
        .some((receiver) => receiver.track === track) ?? false
    );
  }

  push(
    sourceTrack$: Observable<MediaStreamTrack>,
    identity: RalphPublishedTrack,
    options?: RalphPushOptions,
  ): Observable<TrackInfo> {
    return this.main.push(sourceTrack$, identity, options);
  }

  pull(
    track$: Observable<TrackInfo>,
    options?: RalphPullOptions,
  ): Observable<MediaStreamTrack> {
    const fresh = options?.fresh === true;
    // An alias's kind never changes, so its first metadata routes it.
    return track$.pipe(
      take(1),
      switchMap((first) =>
        first.kind === "video" && (fresh || this.videoPulls === "all")
          ? this.pullVideo(track$, fresh, options)
          : this.main.pull(track$, options),
      ),
    );
  }

  updateVoiceToken(voiceToken: string): void {
    this.main.updateVoiceToken(voiceToken);
    for (const session of this.videoSessions()) {
      session.updateVoiceToken(voiceToken);
    }
  }

  updateIceServers(iceServers: IceServer[]): void {
    this.main.updateIceServers(iceServers);
    for (const session of this.videoSessions()) {
      session.updateIceServers(iceServers);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const sessions = [...this.others];
    if (this.current$.value) sessions.push(this.current$.value);
    this.others.clear();
    this.current$.next(null);
    this.current$.complete();
    for (const session of sessions) {
      session.cancelDrain?.();
      session.errors.unsubscribe();
      session.transport.dispose();
    }
    this.videoPullErrors$.complete();
    this.main.dispose();
  }

  private videoSessions(): SplitTransportSession[] {
    const sessions = [...this.others].map((session) => session.transport);
    if (this.current$.value) sessions.push(this.current$.value.transport);
    return sessions;
  }

  private pullVideo(
    track$: Observable<TrackInfo>,
    fresh: boolean,
    options?: RalphPullOptions,
  ): Observable<MediaStreamTrack> {
    return defer(() => {
      if (this.disposed) return EMPTY;
      const session = this.acquireVideoSession(fresh);
      session.pulls += 1;
      return session.transport
        .pull(track$, options)
        .pipe(finalize(() => this.releaseVideoSession(session)));
    });
  }

  private acquireVideoSession(fresh: boolean): VideoSession {
    const current = this.current$.value;
    if (current && !current.closed && !fresh) return current;
    if (current) this.retire(current);
    const transport = this.createVideoSession();
    const session: VideoSession = {
      transport,
      errors: (transport.pullErrors$ ?? EMPTY).subscribe((error) =>
        this.videoPullErrors$.next(error),
      ),
      pulls: 0,
      closed: false,
    };
    this.onVideoSession?.("opened");
    this.current$.next(session);
    return session;
  }

  /** Takes no new pull; goes once its own pulls have closed. */
  private retire(session: VideoSession): void {
    session.closed = true;
    if (this.current$.value === session) this.current$.next(null);
    this.others.add(session);
    if (session.pulls === 0) this.drain(session);
  }

  private releaseVideoSession(session: VideoSession): void {
    session.pulls -= 1;
    if (session.pulls > 0 || this.disposed) return;
    if (!session.closed) {
      this.retire(session);
      return;
    }
    if (!session.cancelDrain) this.drain(session);
  }

  private drain(session: VideoSession): void {
    session.cancelDrain = this.schedule(() => {
      session.cancelDrain = undefined;
      if (!this.others.delete(session)) return;
      this.onVideoSession?.("closed");
      session.errors.unsubscribe();
      session.transport.dispose();
    }, this.drainMs);
  }
}
