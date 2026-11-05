import type {
  IceServer,
  PartyTracksMediaTransport,
  PartyTracksPullError,
  RalphPublishedTrack,
  RalphPullOptions,
  RalphPushOptions,
  TrackInfo,
} from "@ralph/voice-media";
import {
  BehaviorSubject,
  defer,
  EMPTY,
  finalize,
  merge,
  type Observable,
  switchMap,
  take,
} from "rxjs";

// The Expo app's media transport: the main PartyTracks session pushes our
// tracks and pulls audio; remote video is pulled on a session of its own.
//
// A video session lasts while it pulls something. Once its last pull
// closes (the app went to the background, see
// PartyTracksMediaManager.releaseUnsubscribedPulls, or the last video
// ended), it drains for a moment, so PartyTracks can close those pulls at
// the SFU (tracks/close) and the SFU stops sending, and is then dropped.
// The next video pull starts a new session on a new peer connection. That
// is what makes pulling again after a close safe: on the same connection
// the SFU recycles the closed m-line under its old MID with other RTP header
// extension IDs, which libwebrtc rejects (packages/voice/SCREEN_SHARE.md,
// "Watching"), while a new connection has no closed m-lines.

/** The part of PartyTracksTransport this transport drives. */
export interface SplitTransportSession extends PartyTracksMediaTransport {
  readonly pullErrors$: Observable<PartyTracksPullError>;
  updateVoiceToken(voiceToken: string): void;
  updateIceServers(iceServers: IceServer[]): void;
  dispose(): void;
}

export interface SplitTransportOptions {
  /** Makes a video session with the latest credentials. */
  readonly createVideoSession: () => SplitTransportSession;
  /** How long a video session with nothing pulled is kept before it goes. */
  readonly drainMs?: number;
  readonly schedule?: (run: () => void, delayMs: number) => () => void;
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
  pulls: number;
  /** Set once it pulls nothing: no new pull joins it. */
  draining: boolean;
  cancelDrain?: () => void;
}

export class SplitVideoTransport implements PartyTracksMediaTransport {
  readonly peerConnectionState$: Observable<RTCPeerConnectionState>;
  readonly pullErrors$: Observable<PartyTracksPullError>;

  private readonly createVideoSession: () => SplitTransportSession;
  private readonly drainMs: number;
  private readonly schedule: (run: () => void, delayMs: number) => () => void;
  private readonly current$ = new BehaviorSubject<VideoSession | null>(null);
  private readonly draining = new Set<VideoSession>();
  private disposed = false;

  constructor(
    private readonly main: SplitTransportSession,
    options: SplitTransportOptions,
  ) {
    this.createVideoSession = options.createVideoSession;
    this.drainMs = options.drainMs ?? VIDEO_SESSION_DRAIN_MS;
    this.schedule = options.schedule ?? scheduleWithTimers;
    // The call's connection state is the main session's: video comes and
    // goes with watching.
    this.peerConnectionState$ = main.peerConnectionState$;
    this.pullErrors$ = merge(
      main.pullErrors$,
      this.current$.pipe(
        switchMap((session) => session?.transport.pullErrors$ ?? EMPTY),
      ),
    );
  }

  /** Video sessions open now, draining ones included (diagnostics, tests). */
  get videoSessionCount(): number {
    return this.draining.size + (this.current$.value ? 1 : 0);
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
    // An alias's kind never changes, so its first metadata routes it.
    return track$.pipe(
      take(1),
      switchMap((first) =>
        first.kind === "video"
          ? this.pullVideo(track$, options)
          : this.main.pull(track$, options),
      ),
    );
  }

  updateVoiceToken(voiceToken: string): void {
    this.main.updateVoiceToken(voiceToken);
    this.current$.value?.transport.updateVoiceToken(voiceToken);
  }

  updateIceServers(iceServers: IceServer[]): void {
    this.main.updateIceServers(iceServers);
    this.current$.value?.transport.updateIceServers(iceServers);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const sessions = [...this.draining];
    if (this.current$.value) sessions.push(this.current$.value);
    this.draining.clear();
    this.current$.next(null);
    this.current$.complete();
    for (const session of sessions) {
      session.cancelDrain?.();
      session.transport.dispose();
    }
    this.main.dispose();
  }

  private pullVideo(
    track$: Observable<TrackInfo>,
    options?: RalphPullOptions,
  ): Observable<MediaStreamTrack> {
    return defer(() => {
      if (this.disposed) return EMPTY;
      const session = this.acquireVideoSession();
      session.pulls += 1;
      return session.transport
        .pull(track$, options)
        .pipe(finalize(() => this.releaseVideoSession(session)));
    });
  }

  private acquireVideoSession(): VideoSession {
    const current = this.current$.value;
    if (current && !current.draining) return current;
    const session: VideoSession = {
      transport: this.createVideoSession(),
      pulls: 0,
      draining: false,
    };
    console.log("[Voice] Video session opened");
    this.current$.next(session);
    return session;
  }

  private releaseVideoSession(session: VideoSession): void {
    session.pulls -= 1;
    if (session.pulls > 0 || session.draining || this.disposed) return;
    session.draining = true;
    if (this.current$.value === session) this.current$.next(null);
    this.draining.add(session);
    session.cancelDrain = this.schedule(() => {
      session.cancelDrain = undefined;
      if (!this.draining.delete(session)) return;
      console.log("[Voice] Video session closed (nothing pulled)");
      session.transport.dispose();
    }, this.drainMs);
  }
}
