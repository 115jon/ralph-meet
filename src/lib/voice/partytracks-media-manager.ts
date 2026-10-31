import type { TrackInfo } from "@/lib/types";
import type { RalphPublishedTrack } from "@/lib/voice/partytracks-transport";
import { BehaviorSubject, type Observable, Subscription } from "rxjs";

export interface PartyTracksMediaTransport {
  readonly peerConnectionState$: Observable<RTCPeerConnectionState>;
  push(
    sourceTrack$: Observable<MediaStreamTrack>,
    identity: RalphPublishedTrack,
  ): Observable<TrackInfo>;
  pull(track$: Observable<TrackInfo>): Observable<MediaStreamTrack>;
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
}

interface Publication {
  currentTrack: MediaStreamTrack;
  source$: BehaviorSubject<MediaStreamTrack>;
  subscription: Subscription;
  latestMetadata?: TrackInfo;
}

interface RemotePull {
  currentTrack?: MediaStreamTrack;
  metadata$: BehaviorSubject<TrackInfo>;
  subscription: Subscription;
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
  private readonly unsubscribedTrackNames = new Set<string>();
  private readonly stateSubscription: Subscription;
  private peerConnectionState: RTCPeerConnectionState = "new";
  private disposed = false;

  constructor(
    private readonly transport: PartyTracksMediaTransport,
    private readonly participantId: string,
    private readonly callbacks: PartyTracksMediaManagerCallbacks,
  ) {
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
      const pull = this.pulls.get(track.track_name);
      if (pull) {
        if (!previous || !sameMetadata(previous, track)) {
          pull.metadata$.next(track);
        }
      } else if (!this.unsubscribedTrackNames.has(track.track_name)) {
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
  }

  stopRemoteTracks(trackNames: string[]): void {
    for (const trackName of trackNames) {
      this.offers.delete(trackName);
      this.stopPull(trackName);
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
    this.offers.clear();
    this.unsubscribedTrackNames.clear();
    this.stateSubscription.unsubscribe();
  }

  private startPull(track: TrackInfo): void {
    const metadata$ = new BehaviorSubject(track);
    const pull: RemotePull = {
      metadata$,
      subscription: new Subscription(),
    };
    this.pulls.set(track.track_name, pull);
    this.callbacks.onPullStarted?.(track.track_name);
    pull.subscription = this.transport.pull(metadata$).subscribe({
      next: (remoteTrack) => {
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
      error: (error) => this.callbacks.onError?.(error),
    });
  }

  private stopPull(trackName: string): void {
    const pull = this.pulls.get(trackName);
    if (!pull) return;
    this.pulls.delete(trackName);
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
