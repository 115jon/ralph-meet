import type { TrackInfo } from "@/lib/types";
import { scheduleWithGlobalTimers, type ScheduleTimer } from "@ralph/realtime";
import {
  type PartyTracksPullError,
  SFU_TRACK_NOT_FOUND,
} from "@/lib/voice/partytracks-pull-errors";
import type {
  RalphPublishedTrack,
  RalphPullOptions,
  RalphPushOptions,
} from "@/lib/voice/partytracks-transport";
import {
  CAMERA_SIMULCAST_ENCODINGS,
  compareVideoLayerQuality,
  resolveVideoLayerQuality,
  selectSimulcastRid,
  type RenderedVideoSize,
  type VideoLayerQuality,
} from "@/lib/voice/video-layers";
import {
  videoRenderDemand,
  type VideoRenderDemandSource,
} from "@/lib/voice/video-render-demand";
import { PUBLICATION_STALE_AFTER_MS } from "@/lib/voice/publication-liveness";
import {
  createVideoKeepalive,
  type CreateVideoKeepalive,
  type VideoKeepalive,
} from "@/lib/voice/video-keepalive";
import { BehaviorSubject, type Observable, Subscription } from "rxjs";

export interface PartyTracksMediaTransport {
  readonly peerConnectionState$: Observable<RTCPeerConnectionState>;
  push(
    sourceTrack$: Observable<MediaStreamTrack>,
    identity: RalphPublishedTrack,
    options?: RalphPushOptions,
  ): Observable<TrackInfo>;
  pull(
    track$: Observable<TrackInfo>,
    options?: RalphPullOptions,
  ): Observable<MediaStreamTrack>;
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
  sendEncodings?: readonly RTCRtpEncodingParameters[];
  /** Set while withdrawn (see unpublishTrack): what it sends meanwhile. */
  keepalive?: VideoKeepalive;
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
  /**
   * Where pulled video is rendered and how large, for choosing simulcast
   * layers. Defaults to the app's registry, which VideoPlayer reports to.
   */
  readonly videoRenderDemand?: VideoRenderDemandSource;
  /**
   * A layer change waits this long for the rendered size to settle, so a
   * resize or layout transition switches once. Downgrades wait longer: a
   * tile that shrinks for a moment keeps its sharp layer.
   */
  readonly layerUpgradeDelayMs?: number;
  readonly layerDowngradeDelayMs?: number;
  /**
   * The stand-in a withdrawn video publication sends (see unpublishTrack);
   * returning null closes withdrawn video like audio instead.
   */
  readonly createVideoKeepalive?: CreateVideoKeepalive;
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
const DEFAULT_LAYER_UPGRADE_DELAY_MS = 150;
const DEFAULT_LAYER_DOWNGRADE_DELAY_MS = 1_000;
/** Remote tracks pulled only once subscribed (see isSubscribed). */
const OPT_IN_TRACK_PREFIX = "screen-video-";
/** Until something renders a pulled camera, it is pulled at the low layer. */
const INITIAL_VIDEO_LAYER: VideoLayerQuality = "low";

interface RemotePull {
  currentTrack?: MediaStreamTrack;
  metadata$: BehaviorSubject<TrackInfo>;
  subscription: Subscription;
  /** Armed until the pull produces a track for its current metadata. */
  cancelWatchdog?: () => void;
  /** The simulcast layer asked of the SFU (meaningful for simulcast video). */
  layer: VideoLayerQuality;
  /** That layer's RID in the current offer; undefined for a single layer. */
  preferredRid$: BehaviorSubject<string | undefined>;
  /** A layer change waiting for the rendered size to settle. */
  pendingLayer?: { quality: VideoLayerQuality; cancel: () => void };
  /** The largest size the pulled track was last seen rendered at. */
  renderedSize?: RenderedVideoSize | null;
  /**
   * Its publication was withdrawn: the track is hidden (removed from the UI)
   * but the pull keeps its transceiver for the alias's next publication.
   */
  parked?: boolean;
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

function sameRids(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.length === right.length &&
    left.every((rid, index) => rid === right[index])
  );
}

function sameMetadata(left: TrackInfo, right: TrackInfo): boolean {
  return (
    left.participant_id === right.participant_id &&
    left.track_name === right.track_name &&
    left.sfu_track_name === right.sfu_track_name &&
    left.session_id === right.session_id &&
    left.kind === right.kind &&
    sameRids(left.simulcast_rids, right.simulcast_rids)
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
  /**
   * Withdrawn video publications (camera off, share stopped), still pushed
   * as their SFU track and sending a keepalive until published again.
   */
  private readonly withdrawnPublications = new Map<string, Publication>();
  /** Republished-over transceivers, detached and kept until dispose. */
  private readonly retiredPublications: Publication[] = [];
  private readonly offers = new Map<string, TrackInfo>();
  private readonly pulls = new Map<string, RemotePull>();
  private readonly pullRetries = new Map<string, PullRetry>();
  private readonly unsubscribedTrackNames = new Set<string>();
  /** Opt-in tracks (screen video) the viewer has asked for. */
  private readonly subscribedTrackNames = new Set<string>();
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
  private readonly videoRenderDemand: VideoRenderDemandSource;
  private readonly unsubscribeVideoRenderDemand: () => void;
  private readonly layerUpgradeDelayMs: number;
  private readonly layerDowngradeDelayMs: number;
  private readonly createVideoKeepalive: CreateVideoKeepalive;

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
    this.layerUpgradeDelayMs =
      options.layerUpgradeDelayMs ?? DEFAULT_LAYER_UPGRADE_DELAY_MS;
    this.layerDowngradeDelayMs =
      options.layerDowngradeDelayMs ?? DEFAULT_LAYER_DOWNGRADE_DELAY_MS;
    this.createVideoKeepalive =
      options.createVideoKeepalive ?? createVideoKeepalive;
    this.videoRenderDemand = options.videoRenderDemand ?? videoRenderDemand;
    this.unsubscribeVideoRenderDemand = this.videoRenderDemand.subscribe(() =>
      this.refreshVideoLayers(),
    );
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
      const withdrawn = this.withdrawnPublications.get(trackName);
      if (withdrawn && withdrawn.currentTrack.kind === track.kind) {
        this.resumePublication(trackName, withdrawn, track);
        continue;
      }

      this.startPublication(
        trackName,
        track,
        track.kind,
        prefix === "cam" && track.kind === "video"
          ? CAMERA_SIMULCAST_ENCODINGS
          : undefined,
      );
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
      stale.sendEncodings,
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
    sendEncodings?: readonly RTCRtpEncodingParameters[],
  ): void {
    const source$ = new BehaviorSubject(track);
    const publication: Publication = {
      currentTrack: track,
      source$,
      subscription: new Subscription(),
      sendEncodings,
    };
    this.publications.set(trackName, publication);
    this.callbacks.onPushStarted?.(trackName, kind);
    publication.subscription = this.transport
      .push(
        source$,
        { participantId: this.participantId, trackName, kind },
        sendEncodings ? { sendEncodings } : undefined,
      )
      .subscribe({
        next: (metadata) => {
          if (
            publication.latestMetadata &&
            sameMetadata(publication.latestMetadata, metadata)
          ) {
            return;
          }
          publication.latestMetadata = metadata;
          // Re-pushed while withdrawn (a rebuilt session): announced when
          // it is published again.
          if (publication.keepalive) return;
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
      if (!pull.currentTrack || pull.parked) continue;
      tracks.push({
        ...(this.offers.get(trackName) ?? pull.metadata$.value),
        track: pull.currentTrack,
      });
    }
    return tracks;
  }

  /**
   * Stops offering a publication. Its listeners are told it stopped either
   * way; what happens to the SFU track depends on the kind.
   *
   * Video (camera, share) stays pushed as the same SFU track, sending a
   * keepalive instead of the source, so publishing it again is a
   * replaceTrack() and the same SFU track is announced: viewers keep their
   * pulls (see withdrawRemoteTracks) and nobody renegotiates. Closing it
   * made every viewer close its pull and pull the next SFU track, and the
   * SFU recycles the closed m-line under the same MID with other RTP
   * header extension IDs, which Chrome rejects ("RTP extension ID
   * reassignment not supported"): the camera never came back for them.
   *
   * Audio, and video not yet answered, is closed.
   */
  unpublishTrack(trackName: string): boolean {
    const publication = this.publications.get(trackName);
    if (!publication) return false;
    this.publications.delete(trackName);
    const keepalive =
      publication.currentTrack.kind === "video" && publication.latestMetadata
        ? this.createVideoKeepalive()
        : null;
    if (keepalive) {
      publication.keepalive = keepalive;
      publication.currentTrack = keepalive.track;
      publication.source$.next(keepalive.track);
      this.withdrawnPublications.set(trackName, publication);
    } else {
      this.closePublication(publication);
    }
    this.callbacks.onPublicationStopped(trackName);
    return true;
  }

  private resumePublication(
    trackName: string,
    publication: Publication,
    track: MediaStreamTrack,
  ): void {
    this.withdrawnPublications.delete(trackName);
    const keepalive = publication.keepalive;
    if (keepalive && keepalive.longestGapMs() >= PUBLICATION_STALE_AFTER_MS) {
      // The keepalive stalled (a throttled timer) long enough that the SFU
      // may have dropped the track: announcing it again would show viewers
      // a dead track. Push afresh instead.
      this.closePublication(publication);
      this.startPublication(
        trackName,
        track,
        track.kind as "audio" | "video",
        publication.sendEncodings,
      );
      return;
    }
    this.publications.set(trackName, publication);
    publication.keepalive = undefined;
    publication.currentTrack = track;
    publication.source$.next(track);
    keepalive?.stop();
    this.callbacks.onPushStarted?.(trackName, track.kind as "audio" | "video");
    if (publication.latestMetadata) {
      this.callbacks.onPublicationMetadata(publication.latestMetadata);
    }
  }

  private closePublication(publication: Publication): void {
    publication.subscription.unsubscribe();
    publication.source$.complete();
    publication.keepalive?.stop();
    publication.keepalive = undefined;
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
        if (!this.isSubscribed(track.track_name)) {
          // A kept share pull (see setRemoteTrackSubscription) whose
          // publisher started a new share: not watched, so the new share is
          // not pulled. The pull is parked until it is.
          if (!sameSfuTrack(pull.metadata$.value, track)) {
            this.parkPull(track.track_name, pull);
          }
        } else if (changed || pull.parked) {
          this.retargetPull(track.track_name, pull, track);
        }
      } else if (!this.isSubscribed(track.track_name)) {
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
    const current = tracks.filter((track) => track.sfu_track_name);
    const currentTrackNames = new Set(current.map((track) => track.track_name));
    const currentParticipants = new Set(
      current.map((track) => track.participant_id),
    );
    this.stopRemoteTracks(
      [...this.offers.keys()].filter(
        (trackName) => !currentTrackNames.has(trackName),
      ),
    );
    // Parked pulls of participants who publish nothing any more: they left
    // while this client was away, so no leave reached it. (One still here
    // with nothing published loses its parked pull and is pulled afresh,
    // as every withdrawn track was before.)
    const departed: string[] = [];
    for (const [trackName, pull] of this.pulls) {
      if (
        pull.parked &&
        !currentParticipants.has(pull.metadata$.value.participant_id)
      ) {
        departed.push(trackName);
      }
    }
    this.stopRemoteTracks(departed);
    this.offerTracks(tracks);
  }

  hasRemoteOffer(trackName: string): boolean {
    return this.offers.has(trackName);
  }

  /**
   * Screen video is opt-in: it is pulled only once the viewer subscribes
   * (watches the share), so joining a room with shares running does not
   * pull, negotiate and then drop each of them. Everything else is pulled
   * unless unsubscribed.
   */
  private isSubscribed(trackName: string): boolean {
    if (this.unsubscribedTrackNames.has(trackName)) return false;
    return (
      !trackName.startsWith(OPT_IN_TRACK_PREFIX) ||
      this.subscribedTrackNames.has(trackName)
    );
  }

  setRemoteTrackSubscription(trackName: string, subscribe: boolean): void {
    if (subscribe) {
      this.unsubscribedTrackNames.delete(trackName);
      this.subscribedTrackNames.add(trackName);
      const offer = this.offers.get(trackName);
      const pull = this.pulls.get(trackName);
      if (offer && pull?.parked) this.retargetPull(trackName, pull, offer);
      else if (offer && !pull) this.startPull(offer);
      return;
    }
    this.subscribedTrackNames.delete(trackName);
    this.unsubscribedTrackNames.add(trackName);
    // Screen video already pulled keeps its pull (and its transceiver).
    // Closing a pull and pulling again fails in Chrome: the SFU recycles the
    // closed m-line under the same MID with other RTP header extension IDs,
    // which Chrome rejects ("RTP extension ID reassignment not supported"),
    // and the retries leave the session's signalling out of step (406, then
    // 410).
    if (
      trackName.startsWith(OPT_IN_TRACK_PREFIX) &&
      this.pulls.has(trackName)
    ) {
      return;
    }
    this.stopPull(trackName);
    this.clearPullRetry(trackName);
  }

  /**
   * Their publisher withdrew these tracks (camera off, share stopped). A
   * pull that produced a track is parked rather than closed: hidden, but
   * kept with its transceiver. A publisher that keeps the withdrawn SFU
   * track alive (see unpublishTrack) offers that same track again, and the
   * parked pull just shows it again (see retargetPull); meanwhile it
   * receives the publisher's keepalive. A parked pull is closed when its
   * participant leaves.
   */
  withdrawRemoteTracks(trackNames: string[]): void {
    for (const trackName of trackNames) {
      const pull = this.pulls.get(trackName);
      // Withdrawn audio is closed by its publisher: nothing to keep.
      if (pull?.metadata$.value.kind !== "video") {
        this.stopRemoteTracks([trackName]);
        continue;
      }
      this.offers.delete(trackName);
      this.clearPullRetry(trackName);
      this.notFound.delete(trackName);
      this.parkPull(trackName, pull);
    }
  }

  stopRemoteTracks(trackNames: string[]): void {
    for (const trackName of trackNames) {
      this.offers.delete(trackName);
      this.stopPull(trackName);
      this.clearPullRetry(trackName);
      this.notFound.delete(trackName);
    }
  }

  /** Stops a participant's tracks, except the ones named in `keep`. */
  removeParticipant(
    participantId: string,
    keep: ReadonlySet<string> = new Set(),
  ): void {
    // Its offers, and its withdrawn (parked) pulls, which have none.
    const trackNames = new Set<string>();
    for (const track of this.offers.values()) {
      if (track.participant_id === participantId) {
        trackNames.add(track.track_name);
      }
    }
    for (const [trackName, pull] of this.pulls) {
      if (pull.metadata$.value.participant_id === participantId) {
        trackNames.add(trackName);
      }
    }
    for (const trackName of keep) trackNames.delete(trackName);
    this.stopRemoteTracks([...trackNames]);
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
      if (!pull.currentTrack || pull.parked) continue;
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
      this.closePublication(publication);
    }
    this.publications.clear();
    for (const publication of this.withdrawnPublications.values()) {
      this.closePublication(publication);
    }
    this.withdrawnPublications.clear();
    this.releaseRetiredPublications();
    for (const trackName of [...this.pulls.keys()]) this.stopPull(trackName);
    for (const trackName of [...this.pullRetries.keys()]) {
      this.clearPullRetry(trackName);
    }
    this.offers.clear();
    this.unsubscribedTrackNames.clear();
    this.subscribedTrackNames.clear();
    this.notFound.clear();
    this.unsubscribeVideoRenderDemand();
    this.pullErrorSubscription?.unsubscribe();
    this.stateSubscription.unsubscribe();
  }

  private startPull(track: TrackInfo): void {
    const metadata$ = new BehaviorSubject(track);
    const pull: RemotePull = {
      metadata$,
      subscription: new Subscription(),
      layer: INITIAL_VIDEO_LAYER,
      preferredRid$: new BehaviorSubject(
        selectSimulcastRid(INITIAL_VIDEO_LAYER, track.simulcast_rids),
      ),
    };
    this.pulls.set(track.track_name, pull);
    this.armPullWatchdog(track.track_name, pull);
    this.callbacks.onPullStarted?.(track.track_name);
    const pullOptions =
      track.kind === "video"
        ? { preferredRid$: pull.preferredRid$.asObservable() }
        : undefined;
    pull.subscription = this.transport.pull(metadata$, pullOptions).subscribe({
      next: (remoteTrack) => {
        pull.cancelWatchdog?.();
        pull.cancelWatchdog = undefined;
        this.pullRetries.delete(track.track_name);
        this.notFound.delete(track.track_name);
        const offer = this.offers.get(track.track_name);
        // PartyTracks re-emits a track it already produced.
        if (pull.currentTrack === remoteTrack) {
          if (pull.parked) this.unparkPull(track.track_name, pull);
          return;
        }
        if (pull.currentTrack) {
          if (!pull.parked) {
            this.callbacks.onRemoteTrack({
              action: "remove",
              track: pull.currentTrack,
              trackInfo: offer ?? pull.metadata$.value,
            });
          }
          pull.currentTrack.stop();
        }
        pull.currentTrack = remoteTrack;
        // Withdrawn while it was being pulled, or a parked share the viewer
        // does not watch: it stays parked.
        pull.parked =
          !offer ||
          (pull.parked === true && !this.isSubscribed(track.track_name));
        if (pull.parked || !offer) return;
        this.callbacks.onRemoteTrack({
          action: "add",
          track: remoteTrack,
          trackInfo: offer,
        });
        this.refreshVideoLayer(track.track_name, pull);
      },
      error: (error) => {
        this.callbacks.onError?.(error);
        this.dropPull(track.track_name, pull);
      },
    });
  }

  /**
   * Points a pull at `offer`, its alias's current publication. The same SFU
   * track (a camera turned back on, see unpublishTrack) just shows the
   * pulled track again, with no request. Another SFU track (an older
   * publisher, or one whose session was rebuilt) is pulled afresh by
   * PartyTracks, which closes the old transceiver; the watchdog covers that
   * pull. The SFU cannot move a pull to another track in place: tracks/update
   * answers success for a new trackName but keeps the closed one.
   */
  private retargetPull(
    trackName: string,
    pull: RemotePull,
    offer: TrackInfo,
  ): void {
    const pulled = pull.metadata$.value;
    // Before the metadata, so the move (or a re-pull) asks for this offer's
    // RID.
    pull.preferredRid$.next(
      selectSimulcastRid(pull.layer, offer.simulcast_rids),
    );
    if (!sameMetadata(pulled, offer)) pull.metadata$.next(offer);
    if (!sameSfuTrack(pulled, offer)) {
      this.armPullWatchdog(trackName, pull);
    } else {
      this.unparkPull(trackName, pull);
    }
  }

  /** Hides a pull's track and keeps the pull; see withdrawRemoteTracks. */
  private parkPull(trackName: string, pull: RemotePull): void {
    if (pull.parked) return;
    if (!pull.currentTrack) {
      // Nothing pulled yet, so no transceiver to keep.
      this.stopPull(trackName);
      return;
    }
    pull.parked = true;
    pull.cancelWatchdog?.();
    pull.cancelWatchdog = undefined;
    pull.pendingLayer?.cancel();
    pull.pendingLayer = undefined;
    this.callbacks.onRemoteTrack({
      action: "remove",
      track: pull.currentTrack,
      trackInfo: pull.metadata$.value,
    });
  }

  private unparkPull(trackName: string, pull: RemotePull): void {
    const offer = this.offers.get(trackName);
    if (!pull.parked || !pull.currentTrack || !offer) return;
    if (!this.isSubscribed(trackName)) return;
    pull.parked = false;
    this.callbacks.onRemoteTrack({
      action: "add",
      track: pull.currentTrack,
      trackInfo: offer,
    });
    this.refreshVideoLayer(trackName, pull);
  }

  /**
   * Counts the SFU's not-found answers per pulled alias and reports the alias
   * once they persist. A not-found that outlives PartyTracks' first retries
   * does not heal by pulling again (the SFU keeps answering it for that
   * track); only a fresh push by the publisher does.
   */
  private onPullError(error: PartyTracksPullError): void {
    if (this.disposed || error.errorCode !== SFU_TRACK_NOT_FOUND) return;
    // A parked pull PartyTracks pulls again (its session was rebuilt) for
    // an SFU track that is gone: nothing will bring that track back, and
    // PartyTracks would retry it until the participant leaves.
    const gone: string[] = [];
    for (const [trackName, pull] of this.pulls) {
      const pulled = pull.metadata$.value;
      if (
        pull.parked &&
        pulled.session_id === error.sessionId &&
        (pulled.sfu_track_name ?? pulled.track_name) === error.trackName
      ) {
        gone.push(trackName);
      }
    }
    this.stopRemoteTracks(gone);
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
        !this.isSubscribed(trackName)
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

  /** The RID each simulcast pull asks for, by alias (diagnostics). */
  getRemoteVideoLayers(): Record<string, string> {
    const layers: Record<string, string> = {};
    for (const [trackName, pull] of this.pulls) {
      if (pull.parked) continue;
      const rid = pull.preferredRid$.value;
      if (rid !== undefined) layers[trackName] = rid;
    }
    return layers;
  }

  private refreshVideoLayers(): void {
    if (this.disposed) return;
    for (const [trackName, pull] of this.pulls) {
      if (!pull.parked) this.refreshVideoLayer(trackName, pull);
    }
  }

  /**
   * Moves a simulcast pull to the layer its largest render needs once that
   * need has held for the upgrade or downgrade delay. Only a change of layer
   * reaches the SFU (one tracks/update, no renegotiation, same track);
   * resizes within a layer's range do nothing.
   */
  private refreshVideoLayer(trackName: string, pull: RemotePull): void {
    const offer = this.offers.get(trackName) ?? pull.metadata$.value;
    if (offer.kind !== "video" || !offer.simulcast_rids) return;
    const size = pull.currentTrack
      ? this.videoRenderDemand.largestRenderFor(pull.currentTrack)
      : null;
    const resized =
      size?.width !== pull.renderedSize?.width ||
      size?.height !== pull.renderedSize?.height;
    pull.renderedSize = size;
    const wanted = resolveVideoLayerQuality(size);
    if (wanted === pull.layer) {
      pull.pendingLayer?.cancel();
      pull.pendingLayer = undefined;
      return;
    }
    // Still settling (a resize or layout transition): wait out the delay
    // from its last step, so it switches once, to where it lands.
    if (pull.pendingLayer?.quality === wanted && !resized) return;
    pull.pendingLayer?.cancel();
    const delay =
      compareVideoLayerQuality(wanted, pull.layer) > 0
        ? this.layerUpgradeDelayMs
        : this.layerDowngradeDelayMs;
    pull.pendingLayer = {
      quality: wanted,
      cancel: this.schedule(() => {
        pull.pendingLayer = undefined;
        if (this.disposed || this.pulls.get(trackName) !== pull) return;
        pull.layer = wanted;
        const rids = (this.offers.get(trackName) ?? pull.metadata$.value)
          .simulcast_rids;
        pull.preferredRid$.next(selectSimulcastRid(wanted, rids));
      }, delay),
    };
  }

  private stopPull(trackName: string): void {
    const pull = this.pulls.get(trackName);
    if (!pull) return;
    this.pulls.delete(trackName);
    pull.cancelWatchdog?.();
    pull.cancelWatchdog = undefined;
    pull.pendingLayer?.cancel();
    pull.pendingLayer = undefined;
    pull.subscription.unsubscribe();
    pull.metadata$.complete();
    pull.preferredRid$.complete();
    if (!pull.currentTrack) return;
    if (pull.parked) {
      pull.currentTrack.stop();
      return;
    }
    this.callbacks.onRemoteTrack({
      action: "remove",
      track: pull.currentTrack,
      trackInfo: this.offers.get(trackName) ?? pull.metadata$.value,
    });
    pull.currentTrack.stop();
  }
}
