import type { TrackInfo } from "@/lib/types";
import type { ScheduleTimer } from "@/lib/voice/heartbeat-manager";
import {
  type PartyTracksPullError,
  SFU_TRACK_NOT_FOUND,
} from "@/lib/voice/partytracks-pull-errors";
import type { RalphPublishedTrack } from "@/lib/voice/partytracks-transport";
import { BehaviorSubject, type Observable, Subscription } from "rxjs";

export interface PartyTracksMediaTransport {
  readonly peerConnectionState$: Observable<RTCPeerConnectionState>;
  push(
    sourceTrack$: Observable<MediaStreamTrack>,
    identity: RalphPublishedTrack,
  ): Observable<TrackInfo>;
  pull(track$: Observable<TrackInfo>): Observable<MediaStreamTrack>;
  /** SFU errors of pulls the transport is retrying (see partytracks-pull-errors). */
  readonly pullErrors$?: Observable<PartyTracksPullError>;
}

/** A remote track the SFU keeps answering `not_found_track_error` for. */
export interface TrackUnavailableEvent {
  readonly participant_id: string;
  /** Ralph's alias (`cam-audio-<participant id>`). */
  readonly track_name: string;
  readonly sfu_track_name: string;
  readonly session_id: string;
  /** Not-found errors for this SFU track so far, and over how long. */
  readonly notFoundCount: number;
  readonly notFoundForMs: number;
  /** 1 for the first report of this alias since it last arrived. */
  readonly report: number;
}

interface PartyTracksRemoteTrackEvent {
  action: "add" | "remove";
  track: MediaStreamTrack;
  trackInfo: TrackInfo;
}

export interface PartyTracksMediaManagerCallbacks {
  onPublicationMetadata(track: TrackInfo): void;
  onPublicationStopped(trackName: string): void;
  onRemoteTrack(event: PartyTracksRemoteTrackEvent): void;
  onConnectionState?(state: RTCPeerConnectionState): void;
  onError?(error: unknown): void;
  onPushStarted?(trackName: string, kind: "audio" | "video"): void;
  onPullStarted?(trackName: string): void;
  /**
   * The SFU has persistently not found a pulled track although its publisher
   * announced it: only a fresh push of it (republish) recovers.
   */
  onTrackUnavailable?(event: TrackUnavailableEvent): void;
}

interface Publication {
  currentTrack: MediaStreamTrack;
  source$: BehaviorSubject<MediaStreamTrack>;
  subscription: Subscription;
  latestMetadata?: TrackInfo;
}

export interface PartyTracksMediaManagerOptions {
  /**
   * A pull that has produced no track this long after it started (or after
   * its metadata changed) is dropped and pulled again.
   */
  readonly pullWatchdogMs?: number;
  /** Backoff before pulling a dropped track again: first delay and cap. */
  readonly pullRetryBaseMs?: number;
  readonly pullRetryMaxMs?: number;
  readonly schedule?: ScheduleTimer;
  /**
   * A pull is reported unavailable once the SFU has answered not-found for
   * the same SFU track at least `trackUnavailableMinErrors` times spanning at
   * least `trackUnavailableAfterMs`. The pull-after-push race heals within a
   * few hundred ms (PartyTracks retries after 100, 200, 400 ms), so a report
   * takes about 1.5 s of failures.
   */
  readonly trackUnavailableAfterMs?: number;
  readonly trackUnavailableMinErrors?: number;
  /** Reports of one alias: at most this often, at most this many until it arrives. */
  readonly trackUnavailableReportIntervalMs?: number;
  readonly trackUnavailableMaxReports?: number;
  readonly now?: () => number;
}

// PartyTracks retries a failing pull itself (100 ms doubling to 10 s) and
// gives up resolving a pulled transceiver after 5 s, so 10 s without a track
// means the pull is stuck, not slow.
const DEFAULT_PULL_WATCHDOG_MS = 10_000;
const DEFAULT_PULL_RETRY_BASE_MS = 1_000;
const DEFAULT_PULL_RETRY_MAX_MS = 30_000;
const DEFAULT_TRACK_UNAVAILABLE_AFTER_MS = 1_000;
const DEFAULT_TRACK_UNAVAILABLE_MIN_ERRORS = 2;
const DEFAULT_TRACK_UNAVAILABLE_REPORT_INTERVAL_MS = 5_000;
const DEFAULT_TRACK_UNAVAILABLE_MAX_REPORTS = 3;

const scheduleWithGlobalTimers: ScheduleTimer = (callback, ms) => {
  const handle = setTimeout(callback, ms);
  return () => clearTimeout(handle);
};

interface RemotePull {
  currentTrack?: MediaStreamTrack;
  metadata$: BehaviorSubject<TrackInfo>;
  subscription: Subscription;
  /** Armed until the pull produces a track for its current metadata. */
  cancelWatchdog?: () => void;
}

interface PullRetry {
  /** Pulls dropped in a row (watchdog or error) without producing a track. */
  failures: number;
  /** Set while the re-pull waits out its backoff. */
  cancel?: () => void;
}

/** Not-found errors of one remote alias, until its track arrives. */
interface TrackNotFound {
  /** The SFU track (session id + SFU name) `firstAt` and `count` are for. */
  sfuTrack: string;
  firstAt: number;
  count: number;
  /** Kept across SFU tracks of the alias, so republishes stay bounded. */
  reports: number;
  lastReportAt?: number;
}

function isMediaKind(kind: string): kind is "audio" | "video" {
  return kind === "audio" || kind === "video";
}

function sameMetadata(left: TrackInfo, right: TrackInfo): boolean {
  return (
    left.participant_id === right.participant_id &&
    left.track_name === right.track_name &&
    left.sfu_track_name === right.sfu_track_name &&
    left.session_id === right.session_id &&
    left.kind === right.kind
  );
}

function sameSfuTrack(left: TrackInfo, right: TrackInfo): boolean {
  return (
    left.sfu_track_name === right.sfu_track_name &&
    left.session_id === right.session_id
  );
}

/**
 * Adapts Ralph's semantic track aliases to one PartyTracks transport.
 * Publication sources and pull metadata stay hot so PartyTracks can replace
 * tracks and recover sessions without rebuilding Ralph's voice state.
 */
export class PartyTracksMediaManager {
  private readonly publications = new Map<string, Publication>();
  /** Republished-over transceivers, detached and kept until dispose. */
  private readonly retiredPublications: Publication[] = [];
  private readonly offers = new Map<string, TrackInfo>();
  private readonly pulls = new Map<string, RemotePull>();
  private readonly pullRetries = new Map<string, PullRetry>();
  private readonly unsubscribedTrackNames = new Set<string>();
  private readonly stateSubscription: Subscription;
  private peerConnectionState: RTCPeerConnectionState = "new";
  private disposed = false;
  private readonly pullWatchdogMs: number;
  private readonly pullRetryBaseMs: number;
  private readonly pullRetryMaxMs: number;
  private readonly schedule: ScheduleTimer;
  private readonly notFound = new Map<string, TrackNotFound>();
  private readonly pullErrorSubscription?: Subscription;
  private readonly trackUnavailableAfterMs: number;
  private readonly trackUnavailableMinErrors: number;
  private readonly trackUnavailableReportIntervalMs: number;
  private readonly trackUnavailableMaxReports: number;
  private readonly now: () => number;

  constructor(
    private readonly transport: PartyTracksMediaTransport,
    private readonly participantId: string,
    private readonly callbacks: PartyTracksMediaManagerCallbacks,
    options: PartyTracksMediaManagerOptions = {},
  ) {
    this.pullWatchdogMs = options.pullWatchdogMs ?? DEFAULT_PULL_WATCHDOG_MS;
    this.pullRetryBaseMs =
      options.pullRetryBaseMs ?? DEFAULT_PULL_RETRY_BASE_MS;
    this.pullRetryMaxMs = options.pullRetryMaxMs ?? DEFAULT_PULL_RETRY_MAX_MS;
    this.schedule = options.schedule ?? scheduleWithGlobalTimers;
    this.trackUnavailableAfterMs =
      options.trackUnavailableAfterMs ?? DEFAULT_TRACK_UNAVAILABLE_AFTER_MS;
    this.trackUnavailableMinErrors =
      options.trackUnavailableMinErrors ?? DEFAULT_TRACK_UNAVAILABLE_MIN_ERRORS;
    this.trackUnavailableReportIntervalMs =
      options.trackUnavailableReportIntervalMs ??
      DEFAULT_TRACK_UNAVAILABLE_REPORT_INTERVAL_MS;
    this.trackUnavailableMaxReports =
      options.trackUnavailableMaxReports ??
      DEFAULT_TRACK_UNAVAILABLE_MAX_REPORTS;
    this.now = options.now ?? (() => performance.now());
    this.pullErrorSubscription = this.transport.pullErrors$?.subscribe(
      (error) => this.onPullError(error),
    );
    this.stateSubscription = this.transport.peerConnectionState$.subscribe({
      next: (state) => {
        this.peerConnectionState = state;
        this.callbacks.onConnectionState?.(state);
        if (state === "connected") this.replayPublishedTracks();
        // Drop detached transceivers while the session is down: PartyTracks
        // skips closing them then, and would otherwise re-push them (with no
        // track) if it rebuilds the session.
        else this.releaseRetiredPublications();
      },
      error: (error) => this.callbacks.onError?.(error),
    });
  }

  publishStream(stream: MediaStream, prefix: string): void {
    if (this.disposed) return;
    for (const track of stream.getTracks()) {
      if (!isMediaKind(track.kind)) continue;
      const trackName = `${prefix}-${track.kind}-${this.participantId}`;
      const existing = this.publications.get(trackName);
      if (existing) {
        if (existing.currentTrack === track) continue;
        existing.currentTrack = track;
        existing.source$.next(track);
        continue;
      }

      this.startPublication(trackName, track, track.kind);
    }
  }

  /**
   * Pushes a publication again as a new SFU track: same alias, same source
   * track, fresh transceiver. For a publication the SFU may have dropped
   * (see publication-liveness). Nothing is announced until the new push is
   * answered.
   *
   * The old transceiver is detached (its sender sends nothing) but not
   * closed until the session ends. Closing it renegotiates, and on a
   * standby (where it is the first and only m-line) that reset the peer
   * connection's ICE in testing, after which the SFU answered 410 for the
   * whole session.
   */
  republishTrack(trackName: string): boolean {
    if (this.disposed) return false;
    const stale = this.publications.get(trackName);
    if (!stale || !isMediaKind(stale.currentTrack.kind)) return false;
    this.startPublication(
      trackName,
      stale.currentTrack,
      stale.currentTrack.kind,
    );
    // PartyTracks hands each source emission to sender.replaceTrack(), which
    // accepts null.
    stale.source$.next(null as unknown as MediaStreamTrack);
    this.retiredPublications.push(stale);
    return true;
  }

  private releaseRetiredPublications(): void {
    for (const publication of this.retiredPublications.splice(0)) {
      publication.subscription.unsubscribe();
      publication.source$.complete();
    }
  }

  private startPublication(
    trackName: string,
    track: MediaStreamTrack,
    kind: "audio" | "video",
  ): void {
    const source$ = new BehaviorSubject(track);
    const publication: Publication = {
      currentTrack: track,
      source$,
      subscription: new Subscription(),
    };
    this.publications.set(trackName, publication);
    this.callbacks.onPushStarted?.(trackName, kind);
    publication.subscription = this.transport
      .push(source$, {
        participantId: this.participantId,
        trackName,
        kind,
      })
      .subscribe({
        next: (metadata) => {
          if (
            publication.latestMetadata &&
            sameMetadata(publication.latestMetadata, metadata)
          ) {
            return;
          }
          publication.latestMetadata = metadata;
          this.callbacks.onPublicationMetadata(metadata);
        },
        error: (error) => this.callbacks.onError?.(error),
      });
  }

  private replayPublishedTracks(): void {
    for (const publication of this.publications.values()) {
      publication.source$.next(publication.currentTrack);
    }
  }

  replaceTrack(trackName: string, newTrack: MediaStreamTrack | null): boolean {
    const publication = this.publications.get(trackName);
    if (!publication) return false;
    if (!newTrack) return true;
    publication.currentTrack = newTrack;
    publication.source$.next(newTrack);
    return true;
  }

  replaceTrackIfCurrent(
    trackName: string,
    expectedTrack: MediaStreamTrack,
    newTrack: MediaStreamTrack | null,
  ): boolean {
    if (this.getPublishedTrack(trackName) !== expectedTrack) return false;
    return this.replaceTrack(trackName, newTrack);
  }

  /** The SFU track a publication was last announced as, once answered. */
  getPublicationMetadata(trackName: string): TrackInfo | null {
    return this.publications.get(trackName)?.latestMetadata ?? null;
  }

  getPublishedTrack(trackName: string): MediaStreamTrack | null {
    return this.publications.get(trackName)?.currentTrack ?? null;
  }

  getRemoteTracksForDiagnostics(): TrackInfo[] {
    const tracks: TrackInfo[] = [];
    for (const [trackName, pull] of this.pulls) {
      if (!pull.currentTrack) continue;
      tracks.push({
        ...(this.offers.get(trackName) ?? pull.metadata$.value),
        track: pull.currentTrack,
      });
    }
    return tracks;
  }

  unpublishTrack(trackName: string): boolean {
    const publication = this.publications.get(trackName);
    if (!publication) return false;
    this.publications.delete(trackName);
    publication.subscription.unsubscribe();
    publication.source$.complete();
    this.callbacks.onPublicationStopped(trackName);
    return true;
  }

  offerTracks(tracks: TrackInfo[]): void {
    if (this.disposed) return;
    for (const track of tracks) {
      if (
        track.participant_id === this.participantId ||
        !track.sfu_track_name
      ) {
        continue;
      }
      const previous = this.offers.get(track.track_name);
      this.offers.set(track.track_name, track);
      const changed = !previous || !sameMetadata(previous, track);
      const pull = this.pulls.get(track.track_name);
      if (pull) {
        if (changed) {
          // PartyTracks pulls again (and must produce a track) only when
          // the SFU track it names changes.
          if (!previous || !sameSfuTrack(previous, track)) {
            this.armPullWatchdog(track.track_name, pull);
          }
          pull.metadata$.next(track);
        }
      } else if (this.unsubscribedTrackNames.has(track.track_name)) {
        continue;
      } else if (this.pullRetries.get(track.track_name)?.cancel) {
        // A dropped pull is waiting out its backoff; the re-pull takes the
        // latest offer. A different publication need not wait for it.
        if (changed) {
          this.cancelPullRetry(track.track_name);
          this.startPull(track);
        }
      } else {
        this.startPull(track);
      }
    }
  }

  syncRemoteTracks(tracks: TrackInfo[]): void {
    const currentTrackNames = new Set(
      tracks
        .filter((track) => track.sfu_track_name)
        .map((track) => track.track_name),
    );
    this.stopRemoteTracks(
      [...this.offers.keys()].filter(
        (trackName) => !currentTrackNames.has(trackName),
      ),
    );
    this.offerTracks(tracks);
  }

  hasRemoteOffer(trackName: string): boolean {
    return this.offers.has(trackName);
  }

  setRemoteTrackSubscription(trackName: string, subscribe: boolean): void {
    if (subscribe) {
      this.unsubscribedTrackNames.delete(trackName);
      const offer = this.offers.get(trackName);
      if (offer && !this.pulls.has(trackName)) this.startPull(offer);
      return;
    }
    this.unsubscribedTrackNames.add(trackName);
    this.stopPull(trackName);
    this.clearPullRetry(trackName);
  }

  stopRemoteTracks(trackNames: string[]): void {
    for (const trackName of trackNames) {
      this.offers.delete(trackName);
      this.stopPull(trackName);
      this.clearPullRetry(trackName);
      this.notFound.delete(trackName);
    }
  }

  removeParticipant(participantId: string): void {
    this.stopRemoteTracks(
      [...this.offers.values()]
        .filter((track) => track.participant_id === participantId)
        .map((track) => track.track_name),
    );
  }

  get connectionState(): RTCPeerConnectionState | "idle" {
    if (this.publications.size === 0 && this.pulls.size === 0) return "idle";
    return this.peerConnectionState;
  }

  get hasPublications(): boolean {
    return this.publications.size > 0;
  }

  reannouncePublications(): void {
    if (this.disposed) return;
    for (const publication of this.publications.values()) {
      if (publication.latestMetadata) {
        this.callbacks.onPublicationMetadata(publication.latestMetadata);
      }
    }
  }

  replayRemoteTracks(): void {
    if (this.disposed) return;
    for (const [trackName, pull] of this.pulls) {
      if (!pull.currentTrack) continue;
      this.callbacks.onRemoteTrack({
        action: "add",
        track: pull.currentTrack,
        trackInfo: this.offers.get(trackName) ?? pull.metadata$.value,
      });
    }
  }

  get hasRemotePulls(): boolean {
    return this.pulls.size > 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const publication of this.publications.values()) {
      publication.subscription.unsubscribe();
      publication.source$.complete();
    }
    this.publications.clear();
    this.releaseRetiredPublications();
    for (const trackName of [...this.pulls.keys()]) this.stopPull(trackName);
    for (const trackName of [...this.pullRetries.keys()]) {
      this.clearPullRetry(trackName);
    }
    this.offers.clear();
    this.unsubscribedTrackNames.clear();
    this.notFound.clear();
    this.pullErrorSubscription?.unsubscribe();
    this.stateSubscription.unsubscribe();
  }

  private startPull(track: TrackInfo): void {
    const metadata$ = new BehaviorSubject(track);
    const pull: RemotePull = {
      metadata$,
      subscription: new Subscription(),
    };
    this.pulls.set(track.track_name, pull);
    this.armPullWatchdog(track.track_name, pull);
    this.callbacks.onPullStarted?.(track.track_name);
    pull.subscription = this.transport.pull(metadata$).subscribe({
      next: (remoteTrack) => {
        pull.cancelWatchdog?.();
        pull.cancelWatchdog = undefined;
        this.pullRetries.delete(track.track_name);
        this.notFound.delete(track.track_name);
        const currentMetadata = this.offers.get(track.track_name) ?? track;
        if (pull.currentTrack === remoteTrack) return;
        if (pull.currentTrack) {
          this.callbacks.onRemoteTrack({
            action: "remove",
            track: pull.currentTrack,
            trackInfo: currentMetadata,
          });
          pull.currentTrack.stop();
        }
        pull.currentTrack = remoteTrack;
        this.callbacks.onRemoteTrack({
          action: "add",
          track: remoteTrack,
          trackInfo: currentMetadata,
        });
      },
      error: (error) => {
        this.callbacks.onError?.(error);
        this.dropPull(track.track_name, pull);
      },
    });
  }

  /**
   * Counts the SFU's not-found answers per pulled alias and reports the alias
   * once they persist. A not-found that outlives PartyTracks' first retries
   * does not heal by pulling again (the SFU keeps answering it for that
   * track); only a fresh push by the publisher does.
   */
  private onPullError(error: PartyTracksPullError): void {
    if (this.disposed || error.errorCode !== SFU_TRACK_NOT_FOUND) return;
    for (const [trackName, offer] of this.offers) {
      const sfuTrackName = offer.sfu_track_name ?? offer.track_name;
      if (
        offer.session_id !== error.sessionId ||
        sfuTrackName !== error.trackName ||
        !this.pulls.has(trackName)
      ) {
        continue;
      }
      this.countNotFound(trackName, offer, sfuTrackName);
    }
  }

  private countNotFound(
    trackName: string,
    offer: TrackInfo,
    sfuTrackName: string,
  ): void {
    const now = this.now();
    const sfuTrack = `${offer.session_id}\n${sfuTrackName}`;
    const previous = this.notFound.get(trackName);
    const state: TrackNotFound =
      previous?.sfuTrack === sfuTrack
        ? previous
        : {
            sfuTrack,
            firstAt: now,
            count: 0,
            reports: previous?.reports ?? 0,
            lastReportAt: previous?.lastReportAt,
          };
    state.count += 1;
    this.notFound.set(trackName, state);
    const notFoundForMs = now - state.firstAt;
    if (
      state.count < this.trackUnavailableMinErrors ||
      notFoundForMs < this.trackUnavailableAfterMs ||
      state.reports >= this.trackUnavailableMaxReports ||
      (state.lastReportAt !== undefined &&
        now - state.lastReportAt < this.trackUnavailableReportIntervalMs)
    ) {
      return;
    }
    state.reports += 1;
    state.lastReportAt = now;
    this.callbacks.onTrackUnavailable?.({
      participant_id: offer.participant_id,
      track_name: trackName,
      sfu_track_name: sfuTrackName,
      session_id: offer.session_id,
      notFoundCount: state.count,
      notFoundForMs,
      report: state.reports,
    });
  }

  /**
   * A pull that never settles would otherwise keep its track name forever:
   * later offers with the same metadata are deduplicated here and in
   * PartyTracks, so nothing would ever pull that track again.
   */
  private armPullWatchdog(trackName: string, pull: RemotePull): void {
    pull.cancelWatchdog?.();
    pull.cancelWatchdog = this.schedule(() => {
      pull.cancelWatchdog = undefined;
      this.dropPull(trackName, pull);
    }, this.pullWatchdogMs);
  }

  /** Drops a pull that failed or produced nothing, and pulls again later. */
  private dropPull(trackName: string, pull: RemotePull): void {
    if (this.disposed || this.pulls.get(trackName) !== pull) return;
    this.stopPull(trackName);
    const retry = this.pullRetries.get(trackName) ?? { failures: 0 };
    retry.failures += 1;
    this.pullRetries.set(trackName, retry);
    const delay = Math.min(
      this.pullRetryBaseMs * 2 ** (retry.failures - 1),
      this.pullRetryMaxMs,
    );
    retry.cancel?.();
    retry.cancel = this.schedule(() => {
      retry.cancel = undefined;
      const offer = this.offers.get(trackName);
      if (
        this.disposed ||
        !offer ||
        this.pulls.has(trackName) ||
        this.unsubscribedTrackNames.has(trackName)
      ) {
        return;
      }
      this.startPull(offer);
    }, delay);
  }

  /** Cancels a pending re-pull but keeps the failure count (backoff). */
  private cancelPullRetry(trackName: string): void {
    const retry = this.pullRetries.get(trackName);
    if (!retry) return;
    retry.cancel?.();
    retry.cancel = undefined;
  }

  private clearPullRetry(trackName: string): void {
    this.cancelPullRetry(trackName);
    this.pullRetries.delete(trackName);
  }

  private stopPull(trackName: string): void {
    const pull = this.pulls.get(trackName);
    if (!pull) return;
    this.pulls.delete(trackName);
    pull.cancelWatchdog?.();
    pull.cancelWatchdog = undefined;
    pull.subscription.unsubscribe();
    pull.metadata$.complete();
    if (!pull.currentTrack) return;
    this.callbacks.onRemoteTrack({
      action: "remove",
      track: pull.currentTrack,
      trackInfo: this.offers.get(trackName) ?? pull.metadata$.value,
    });
    pull.currentTrack.stop();
  }
}
