import type { TrackInfo } from "../track-info";
import type { PartyTracksPullError } from "../partytracks-pull-errors";
import type {
  RalphPublishedTrack,
  RalphPullOptions,
} from "../partytracks-transport";
import { Observable, Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import {
  PartyTracksMediaManager,
  type PartyTracksMediaManagerOptions,
  type PartyTracksMediaTransport,
  type TrackUnavailableEvent,
} from "../partytracks-media-manager";

function mediaTrack(kind: "audio" | "video", id: string): MediaStreamTrack {
  return {
    id,
    kind,
    readyState: "live",
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function mediaStream(...tracks: MediaStreamTrack[]): MediaStream {
  return { getTracks: () => tracks } as unknown as MediaStream;
}

class TestTransport implements PartyTracksMediaTransport {
  readonly peerConnectionState$ = new Subject<RTCPeerConnectionState>();
  readonly pushSources = new Map<string, MediaStreamTrack[]>();
  readonly pushMetadata = new Map<string, Subject<TrackInfo>>();
  readonly pullMetadata = new Map<string, TrackInfo[]>();
  readonly pulledTracks = new Map<string, Subject<MediaStreamTrack>>();
  readonly pullErrors$ = new Subject<PartyTracksPullError>();
  /** Per pull, in order: its alias and whether it asked for a fresh path. */
  readonly pulls: Array<{ trackName: string; fresh: boolean }> = [];
  /** Aliases whose pull subscription closed, in order. */
  readonly closedPulls: string[] = [];
  pullCount = 0;
  pushCount = 0;

  push(
    sourceTrack$: Observable<MediaStreamTrack>,
    identity: RalphPublishedTrack,
  ): Observable<TrackInfo> {
    this.pushCount += 1;
    const sourceTracks: MediaStreamTrack[] = [];
    sourceTrack$.subscribe((track) => sourceTracks.push(track));
    this.pushSources.set(identity.trackName, sourceTracks);
    const metadata = new Subject<TrackInfo>();
    this.pushMetadata.set(identity.trackName, metadata);
    return metadata;
  }

  pull(
    track$: Observable<TrackInfo>,
    options?: RalphPullOptions,
  ): Observable<MediaStreamTrack> {
    this.pullCount += 1;
    let trackName = "";
    const metadata: TrackInfo[] = [];
    track$.subscribe((track) => {
      trackName = track.track_name;
      metadata.push(track);
    });
    this.pullMetadata.set(trackName, metadata);
    this.pulls.push({ trackName, fresh: options?.fresh === true });
    const pulledTrack = new Subject<MediaStreamTrack>();
    this.pulledTracks.set(trackName, pulledTrack);
    return new Observable<MediaStreamTrack>((subscriber) => {
      const inner = pulledTrack.subscribe(subscriber);
      return () => {
        inner.unsubscribe();
        this.closedPulls.push(trackName);
      };
    });
  }
}

describe("PartyTracksMediaManager", () => {
  it("bridges publisher metadata directly into one remote pull and refreshes it after reconnect", () => {
    const publisherTransport = new TestTransport();
    const subscriberTransport = new TestTransport();
    const remoteEvents: Array<{
      action: "add" | "remove";
      track: MediaStreamTrack;
      trackInfo: TrackInfo;
    }> = [];
    const subscriber = new PartyTracksMediaManager(
      subscriberTransport,
      "subscriber",
      {
        onPublicationMetadata: vi.fn(),
        onPublicationStopped: vi.fn(),
        onRemoteTrack: (event) => remoteEvents.push(event),
      },
    );
    const publisher = new PartyTracksMediaManager(
      publisherTransport,
      "publisher",
      {
        onPublicationMetadata: (track) => subscriber.offerTracks([track]),
        onPublicationStopped: vi.fn(),
        onRemoteTrack: vi.fn(),
      },
    );

    const microphone = mediaTrack("audio", "microphone");
    publisher.publishStream(mediaStream(microphone), "cam");
    expect(publisherTransport.pushSources.get("cam-audio-publisher")).toEqual([
      microphone,
    ]);

    const firstMetadata: TrackInfo = {
      participant_id: "publisher",
      track_name: "cam-audio-publisher",
      sfu_track_name: "opaque-audio",
      session_id: "session-capability-1",
      kind: "audio",
    };
    publisherTransport.pushMetadata
      .get("cam-audio-publisher")
      ?.next(firstMetadata);

    expect(subscriberTransport.pullCount).toBe(1);
    expect(subscriberTransport.pullMetadata.get("cam-audio-publisher")).toEqual(
      [firstMetadata],
    );

    const remoteAudio = mediaTrack("audio", "remote-audio-1");
    subscriberTransport.pulledTracks
      .get("cam-audio-publisher")
      ?.next(remoteAudio);
    expect(remoteEvents).toEqual([
      {
        action: "add",
        track: remoteAudio,
        trackInfo: firstMetadata,
      },
    ]);
    expect(subscriber.getRemoteTracksForDiagnostics()).toEqual([
      { ...firstMetadata, track: remoteAudio },
    ]);

    const refreshedMetadata = {
      ...firstMetadata,
      session_id: "session-capability-2",
    };
    publisherTransport.pushMetadata
      .get("cam-audio-publisher")
      ?.next(refreshedMetadata);

    expect(subscriberTransport.pullCount).toBe(1);
    expect(subscriberTransport.pullMetadata.get("cam-audio-publisher")).toEqual(
      [firstMetadata, refreshedMetadata],
    );
  });

  it("pulls a screen share announced after the viewer's VoiceReady without a rejoin", () => {
    const transport = new TestTransport();
    const remoteEvents: string[] = [];
    const viewer = new PartyTracksMediaManager(transport, "viewer", {
      onPublicationMetadata: vi.fn(),
      onPublicationStopped: vi.fn(),
      onRemoteTrack: ({ action, trackInfo }) =>
        remoteEvents.push(`${action}:${trackInfo.track_name}`),
    });
    const microphone: TrackInfo = {
      participant_id: "sharer",
      track_name: "cam-audio-sharer",
      sfu_track_name: "opaque-sharer-audio",
      session_id: "sharer-session",
      kind: "audio",
    };
    // The viewer joins: VoiceReady lists only the sharer's microphone. The
    // viewer watches the sharer (screen video is pulled only when watched).
    viewer.setRemoteTrackSubscription("screen-video-sharer", true);
    viewer.syncRemoteTracks([microphone]);
    transport.pulledTracks
      .get(microphone.track_name)
      ?.next(mediaTrack("audio", "sharer-mic"));

    // Later the sharer (a phone) starts a screen share; the room announces it.
    const screen: TrackInfo = {
      participant_id: "sharer",
      track_name: "screen-video-sharer",
      sfu_track_name: "opaque-sharer-screen",
      session_id: "sharer-session",
      kind: "video",
    };
    viewer.offerTracks([screen]);
    expect(transport.pullCount).toBe(2);
    expect(transport.pullMetadata.get(screen.track_name)).toEqual([screen]);
    transport.pulledTracks
      .get(screen.track_name)
      ?.next(mediaTrack("video", "sharer-screen"));

    // A later VoiceReady (the voice socket reconnecting) keeps both pulls.
    viewer.syncRemoteTracks([microphone, screen]);
    expect(transport.pullCount).toBe(2);
    expect(remoteEvents).toEqual([
      "add:cam-audio-sharer",
      "add:screen-video-sharer",
    ]);
    viewer.dispose();
  });

  it("pulls screen video only once the viewer subscribes to it", () => {
    const transport = new TestTransport();
    const viewer = new PartyTracksMediaManager(transport, "viewer", {
      onPublicationMetadata: vi.fn(),
      onPublicationStopped: vi.fn(),
      onRemoteTrack: vi.fn(),
    });
    const track = (kind: "audio" | "video", name: string): TrackInfo => ({
      participant_id: "sharer",
      track_name: `${name}-sharer`,
      sfu_track_name: `opaque-${name}`,
      session_id: "sharer-session",
      kind,
    });
    // A late joiner's VoiceReady lists a running share: its audio and the
    // camera are pulled; its video waits for Watch.
    viewer.syncRemoteTracks([
      track("audio", "screen-audio"),
      track("video", "screen-video"),
      track("video", "cam-video"),
    ]);
    expect([...transport.pullMetadata.keys()].sort()).toEqual([
      "cam-video-sharer",
      "screen-audio-sharer",
    ]);

    viewer.setRemoteTrackSubscription("screen-video-sharer", true);
    expect(transport.pullMetadata.get("screen-video-sharer")).toEqual([
      track("video", "screen-video"),
    ]);
    viewer.dispose();
  });

  it("keeps a share's video pull across unwatching and new shares", () => {
    const transport = new TestTransport();
    const removed: string[] = [];
    const viewer = new PartyTracksMediaManager(transport, "viewer", {
      onPublicationMetadata: vi.fn(),
      onPublicationStopped: vi.fn(),
      onRemoteTrack: ({ action, trackInfo }) => {
        if (action === "remove") removed.push(trackInfo.sfu_track_name ?? "");
      },
    });
    const share = (sfuTrackName: string): TrackInfo => ({
      participant_id: "sharer",
      track_name: "screen-video-sharer",
      sfu_track_name: sfuTrackName,
      session_id: "sharer-session",
      kind: "video",
    });
    viewer.setRemoteTrackSubscription("screen-video-sharer", true);
    viewer.offerTracks([share("share-1")]);
    transport.pulledTracks
      .get("screen-video-sharer")
      ?.next(mediaTrack("video", "share-1-video"));

    // Stop watching: the pull stays (closing and pulling it again fails in
    // Chrome), so watching again needs no new pull.
    viewer.setRemoteTrackSubscription("screen-video-sharer", false);
    expect(removed).toEqual([]);
    viewer.setRemoteTrackSubscription("screen-video-sharer", true);
    expect(transport.pullCount).toBe(1);

    // Unwatched when the sharer starts a new share: the old share is hidden
    // and the new one is not pulled, but the pull is kept.
    viewer.setRemoteTrackSubscription("screen-video-sharer", false);
    viewer.offerTracks([share("share-2")]);
    expect(removed).toEqual(["share-1"]);
    expect(transport.pullMetadata.get("screen-video-sharer")).toEqual([
      share("share-1"),
    ]);
    // Watching again pulls the new share on a fresh path (a new video
    // session), closing the kept pull.
    viewer.setRemoteTrackSubscription("screen-video-sharer", true);
    expect(transport.closedPulls).toEqual(["screen-video-sharer"]);
    expect(transport.pulls).toEqual([
      { trackName: "screen-video-sharer", fresh: false },
      { trackName: "screen-video-sharer", fresh: true },
    ]);
    expect(transport.pullMetadata.get("screen-video-sharer")).toEqual([
      share("share-2"),
    ]);
    viewer.dispose();
  });

  it("releases kept opt-in pulls nobody watches and pulls them afresh on a new watch", () => {
    const transport = new TestTransport();
    const events: string[] = [];
    const viewer = new PartyTracksMediaManager(
      transport,
      "viewer",
      {
        onPublicationMetadata: vi.fn(),
        onPublicationStopped: vi.fn(),
        onRemoteTrack: ({ action, trackInfo }) =>
          events.push(`${action}:${trackInfo.track_name}`),
      },
      { optInTrackPrefixes: ["cam-video-", "screen-video-"] },
    );
    const video = (trackName: string): TrackInfo => ({
      participant_id: "peer",
      track_name: trackName,
      sfu_track_name: `${trackName}-sfu`,
      session_id: "peer-session",
      kind: "video",
    });
    const audio: TrackInfo = {
      participant_id: "peer",
      track_name: "cam-audio-peer",
      sfu_track_name: "cam-audio-peer-sfu",
      session_id: "peer-session",
      kind: "audio",
    };
    viewer.offerTracks([
      audio,
      video("cam-video-peer"),
      video("screen-video-peer"),
    ]);
    viewer.setRemoteTrackSubscription("cam-video-peer", true);
    viewer.setRemoteTrackSubscription("screen-video-peer", true);
    const audioTrack = mediaTrack("audio", "audio");
    const camera = mediaTrack("video", "camera");
    const share = mediaTrack("video", "share");
    transport.pulledTracks.get("cam-audio-peer")?.next(audioTrack);
    transport.pulledTracks.get("cam-video-peer")?.next(camera);
    transport.pulledTracks.get("screen-video-peer")?.next(share);
    expect(transport.pullCount).toBe(3);

    // Still watched: nothing is released.
    viewer.releaseUnsubscribedPulls();
    expect(camera.stop).not.toHaveBeenCalled();

    // The camera's publisher withdraws it (parked), then nobody watches.
    viewer.withdrawRemoteTracks(["cam-video-peer"]);
    viewer.setRemoteTrackSubscription("cam-video-peer", false);
    viewer.setRemoteTrackSubscription("screen-video-peer", false);
    events.length = 0;
    viewer.releaseUnsubscribedPulls();
    expect(camera.stop).toHaveBeenCalled();
    expect(share.stop).toHaveBeenCalled();
    expect(audioTrack.stop).not.toHaveBeenCalled();
    // The parked camera was hidden already; only the share is removed now.
    expect(events).toEqual(["remove:screen-video-peer"]);
    expect(viewer.hasRemoteOffer("screen-video-peer")).toBe(true);

    // Watching again pulls the share afresh, on the new connection the
    // released ones left for (not one fresh connection per alias).
    viewer.setRemoteTrackSubscription("screen-video-peer", true);
    expect(transport.pullCount).toBe(4);
    expect(transport.pulls.at(-1)).toEqual({
      trackName: "screen-video-peer",
      fresh: false,
    });
    viewer.dispose();
  });

  it("notifies when push and pull start on the shared transport", () => {
    const transport = new TestTransport();
    const onPushStarted = vi.fn();
    const onPullStarted = vi.fn();
    const manager = new PartyTracksMediaManager(transport, "publisher", {
      onPublicationMetadata: vi.fn(),
      onPublicationStopped: vi.fn(),
      onRemoteTrack: vi.fn(),
      onPushStarted,
      onPullStarted,
    });

    manager.publishStream(
      mediaStream(mediaTrack("audio", "microphone")),
      "cam",
    );
    manager.offerTracks([
      {
        participant_id: "remote",
        track_name: "cam-audio-remote",
        sfu_track_name: "opaque-remote",
        session_id: "session-capability",
        kind: "audio",
      },
    ]);

    expect(onPushStarted).toHaveBeenCalledWith("cam-audio-publisher", "audio");
    expect(onPullStarted).toHaveBeenCalledWith("cam-audio-remote");
    manager.dispose();
  });

  it("replays the current publication when the peer connection connects", () => {
    const transport = new TestTransport();
    const manager = new PartyTracksMediaManager(transport, "participant", {
      onPublicationMetadata: vi.fn(),
      onPublicationStopped: vi.fn(),
      onRemoteTrack: vi.fn(),
    });
    const silence = mediaTrack("audio", "silence");
    const microphone = mediaTrack("audio", "microphone");

    manager.publishStream(mediaStream(silence), "cam");
    expect(manager.replaceTrack("cam-audio-participant", microphone)).toBe(
      true,
    );
    expect(transport.pushSources.get("cam-audio-participant")).toEqual([
      silence,
      microphone,
    ]);

    transport.peerConnectionState$.next("connected");

    expect(transport.pushSources.get("cam-audio-participant")).toEqual([
      silence,
      microphone,
      microphone,
    ]);
    manager.dispose();
  });

  it("replaces publications without a second push and tears down local and remote tracks", () => {
    const transport = new TestTransport();
    const onPublicationStopped = vi.fn();
    const onRemoteTrack = vi.fn();
    const manager = new PartyTracksMediaManager(transport, "participant", {
      onPublicationMetadata: vi.fn(),
      onPublicationStopped,
      onRemoteTrack,
    });
    const original = mediaTrack("video", "camera-1");
    const replacement = mediaTrack("video", "camera-2");

    manager.publishStream(mediaStream(original), "cam");
    expect(manager.replaceTrack("cam-video-participant", replacement)).toBe(
      true,
    );
    expect(transport.pushSources.get("cam-video-participant")).toEqual([
      original,
      replacement,
    ]);
    expect(manager.getPublishedTrack("cam-video-participant")).toBe(
      replacement,
    );
    expect(manager.unpublishTrack("cam-video-participant")).toBe(true);
    expect(onPublicationStopped).toHaveBeenCalledWith("cam-video-participant");

    const offer: TrackInfo = {
      participant_id: "remote",
      track_name: "screen-video-remote",
      sfu_track_name: "opaque-screen",
      session_id: "remote-capability",
      kind: "video",
    };
    manager.setRemoteTrackSubscription(offer.track_name, true);
    manager.offerTracks([offer]);
    const remoteVideo = mediaTrack("video", "remote-video");
    transport.pulledTracks.get(offer.track_name)?.next(remoteVideo);
    manager.stopRemoteTracks([offer.track_name]);

    expect(onRemoteTrack).toHaveBeenLastCalledWith({
      action: "remove",
      track: remoteVideo,
      trackInfo: offer,
    });
    expect(remoteVideo.stop).toHaveBeenCalledTimes(1);
  });

  it("republishes a dropped publication on a new transceiver and detaches the old one", () => {
    const events: string[] = [];
    const metadata: Subject<TrackInfo>[] = [];
    const sources: Array<Array<MediaStreamTrack | null>> = [];
    const peerConnectionState$ = new Subject<RTCPeerConnectionState>();
    const transport: PartyTracksMediaTransport = {
      peerConnectionState$,
      push: (sourceTrack$) =>
        new Observable<TrackInfo>((subscriber) => {
          const push = metadata.length + 1;
          const published: Array<MediaStreamTrack | null> = [];
          sources.push(published);
          events.push(`push:${push}`);
          const metadata$ = new Subject<TrackInfo>();
          metadata.push(metadata$);
          const source = sourceTrack$.subscribe((track) =>
            published.push(track),
          );
          const announced = metadata$.subscribe(subscriber);
          return () => {
            events.push(`close:${push}`);
            source.unsubscribe();
            announced.unsubscribe();
          };
        }),
      pull: () => new Subject<MediaStreamTrack>(),
    };
    const announced: TrackInfo[] = [];
    const onPublicationStopped = vi.fn();
    const manager = new PartyTracksMediaManager(transport, "participant", {
      onPublicationMetadata: (track) => announced.push(track),
      onPublicationStopped,
      onRemoteTrack: vi.fn(),
    });
    const silence = mediaTrack("audio", "silence");
    const microphone = mediaTrack("audio", "microphone");
    const trackInfo = (sfuTrackName: string): TrackInfo => ({
      participant_id: "participant",
      track_name: "cam-audio-participant",
      sfu_track_name: sfuTrackName,
      session_id: "session",
      kind: "audio",
    });

    manager.publishStream(mediaStream(silence), "cam");
    metadata[0]?.next(trackInfo("dropped-by-sfu"));
    expect(manager.republishTrack("cam-audio-participant")).toBe(true);

    // A new push for the same alias; the old sender is detached but not
    // closed (that renegotiation can reset a standby's only transport), and
    // the alias is never reported as stopped to the room.
    expect(events).toEqual(["push:1", "push:2"]);
    expect(sources[0]).toEqual([silence, null]);
    expect(onPublicationStopped).not.toHaveBeenCalled();
    expect(sources[1]).toEqual([silence]);
    expect(manager.getPublishedTrack("cam-audio-participant")).toBe(silence);

    // The dead track is never announced again (VoiceReady re-announces);
    // the new one is announced once the SFU answers its push.
    announced.length = 0;
    manager.reannouncePublications();
    expect(announced).toEqual([]);
    metadata[1]?.next(trackInfo("fresh"));
    manager.reannouncePublications();
    expect(announced.map((track) => track.sfu_track_name)).toEqual([
      "fresh",
      "fresh",
    ]);

    // The join's microphone swaps in on the new publication.
    expect(manager.replaceTrack("cam-audio-participant", microphone)).toBe(
      true,
    );
    expect(sources[1]).toEqual([silence, microphone]);
    expect(sources[0]).toEqual([silence, null]);

    // Dropped once the session is down (PartyTracks skips the close then).
    peerConnectionState$.next("connected");
    expect(events).toEqual(["push:1", "push:2"]);
    peerConnectionState$.next("disconnected");
    expect(events).toEqual(["push:1", "push:2", "close:1"]);

    expect(manager.republishTrack("cam-audio-missing")).toBe(false);
    manager.dispose();
    expect(events).toEqual(["push:1", "push:2", "close:1", "close:2"]);
    expect(manager.republishTrack("cam-audio-participant")).toBe(false);
  });
});

/** Timers the test advances by hand. */
class ManualTimers {
  private now = 0;
  private timers: Array<{ at: number; fn: () => void; live: boolean }> = [];

  readonly schedule = (fn: () => void, ms: number) => {
    const timer = { at: this.now + ms, fn, live: true };
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  };

  readonly clock = () => this.now;

  pending(): number {
    return this.timers.filter((timer) => timer.live).length;
  }

  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const due = this.timers
        .filter((timer) => timer.live && timer.at <= end)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.live = false;
      this.now = due.at;
      due.fn();
    }
    this.now = end;
  }
}

describe("PartyTracksMediaManager pull watchdog", () => {
  const WATCHDOG_MS = 8_000;
  const offer: TrackInfo = {
    participant_id: "joiner",
    track_name: "cam-audio-joiner",
    sfu_track_name: "opaque-joiner-audio",
    session_id: "joiner-session",
    kind: "audio",
  };

  function setup() {
    const timers = new ManualTimers();
    const transport = new TestTransport();
    const remoteEvents: string[] = [];
    const onError = vi.fn();
    const manager = new PartyTracksMediaManager(
      transport,
      "listener",
      {
        onPublicationMetadata: vi.fn(),
        onPublicationStopped: vi.fn(),
        onRemoteTrack: ({ action, track }) =>
          remoteEvents.push(`${action}:${track.id}`),
        onError,
      },
      {
        pullWatchdogMs: WATCHDOG_MS,
        pullRetryBaseMs: 500,
        pullRetryMaxMs: 4_000,
        schedule: timers.schedule,
      },
    );
    const pulled = () => transport.pulledTracks.get(offer.track_name);
    return { timers, transport, remoteEvents, onError, manager, pulled };
  }

  it("drops a pull that never produces a track and pulls again with backoff", () => {
    const { timers, transport, remoteEvents, manager, pulled } = setup();
    manager.offerTracks([offer]);
    const hung = pulled();
    expect(transport.pullCount).toBe(1);

    timers.advance(WATCHDOG_MS - 1);
    expect(hung?.observed).toBe(true);
    timers.advance(1);
    expect(hung?.observed).toBe(false);
    expect(manager.hasRemotePulls).toBe(false);

    timers.advance(499);
    expect(transport.pullCount).toBe(1);
    timers.advance(1);
    expect(transport.pullCount).toBe(2);
    expect(transport.pullMetadata.get(offer.track_name)).toEqual([offer]);

    // Hung again: the next re-pull waits twice as long.
    timers.advance(WATCHDOG_MS + 999);
    expect(transport.pullCount).toBe(2);
    timers.advance(1);
    expect(transport.pullCount).toBe(3);

    pulled()?.next(mediaTrack("audio", "joiner-audio"));
    expect(remoteEvents).toEqual(["add:joiner-audio"]);
    timers.advance(10 * 60_000);
    expect(transport.pullCount).toBe(3);
    expect(timers.pending()).toBe(0);
    manager.dispose();
  });

  it("does not let a same-metadata offer pin a dead pull", () => {
    const { timers, transport, remoteEvents, manager, pulled } = setup();
    manager.offerTracks([offer]);
    // Deduplicated: the pull in flight is not restarted.
    manager.offerTracks([{ ...offer }]);
    expect(transport.pullCount).toBe(1);

    timers.advance(WATCHDOG_MS);
    expect(manager.hasRemotePulls).toBe(false);
    // The same offer again (a VoiceReady sync) waits out the backoff.
    manager.syncRemoteTracks([{ ...offer }]);
    expect(transport.pullCount).toBe(1);
    timers.advance(500);
    expect(transport.pullCount).toBe(2);

    pulled()?.next(mediaTrack("audio", "joiner-audio"));
    expect(remoteEvents).toEqual(["add:joiner-audio"]);
    manager.dispose();
  });

  it("pulls a republished track at once instead of waiting for the backoff", () => {
    const { timers, transport, manager } = setup();
    manager.offerTracks([offer]);
    timers.advance(WATCHDOG_MS);

    const republished = { ...offer, session_id: "joiner-session-2" };
    manager.offerTracks([republished]);
    expect(transport.pullCount).toBe(2);
    expect(transport.pullMetadata.get(offer.track_name)).toEqual([republished]);
    timers.advance(500);
    expect(transport.pullCount).toBe(2);
    manager.dispose();
  });

  it("re-arms when an active pull is sent new metadata", () => {
    const { timers, transport, remoteEvents, manager, pulled } = setup();
    manager.offerTracks([offer]);
    pulled()?.next(mediaTrack("audio", "first"));
    timers.advance(60_000);
    expect(transport.pullCount).toBe(1);

    manager.offerTracks([{ ...offer, session_id: "joiner-session-2" }]);
    timers.advance(WATCHDOG_MS);
    expect(remoteEvents).toEqual(["add:first", "remove:first"]);
    timers.advance(500);
    expect(transport.pullCount).toBe(2);
    manager.dispose();
  });

  it("retries a pull that errors", () => {
    const { timers, transport, onError, manager, pulled } = setup();
    manager.offerTracks([offer]);
    const failure = new Error("pull failed");
    pulled()?.error(failure);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(manager.hasRemotePulls).toBe(false);

    timers.advance(500);
    expect(transport.pullCount).toBe(2);
    manager.dispose();
  });

  it("cancels the watchdog and any pending re-pull when tracks stop or the manager is disposed", () => {
    const { timers, transport, manager } = setup();
    const other: TrackInfo = {
      ...offer,
      track_name: "screen-video-joiner",
      sfu_track_name: "opaque-joiner-screen",
      kind: "video",
    };
    manager.setRemoteTrackSubscription(other.track_name, true);
    manager.offerTracks([offer, other]);
    expect(transport.pullCount).toBe(2);

    manager.stopRemoteTracks([offer.track_name]);
    timers.advance(WATCHDOG_MS);
    // Only the other pull's re-pull is waiting.
    expect(timers.pending()).toBe(1);
    manager.setRemoteTrackSubscription(other.track_name, false);
    expect(timers.pending()).toBe(0);

    manager.setRemoteTrackSubscription(other.track_name, true);
    expect(transport.pullCount).toBe(3);
    expect(timers.pending()).toBe(1);
    manager.dispose();
    expect(timers.pending()).toBe(0);
    timers.advance(10 * 60_000);
    expect(transport.pullCount).toBe(3);
  });
});

describe("PartyTracksMediaManager track-unavailable detection", () => {
  const offer: TrackInfo = {
    participant_id: "publisher",
    track_name: "cam-audio-publisher",
    sfu_track_name: "opaque-publisher-audio",
    session_id: "publisher-session",
    kind: "audio",
  };
  const NOT_FOUND: PartyTracksPullError = {
    sessionId: offer.session_id,
    trackName: "opaque-publisher-audio",
    errorCode: "not_found_track_error",
  };

  function setup() {
    const timers = new ManualTimers();
    const transport = new TestTransport();
    const reports: TrackUnavailableEvent[] = [];
    const manager = new PartyTracksMediaManager(
      transport,
      "listener",
      {
        onPublicationMetadata: vi.fn(),
        onPublicationStopped: vi.fn(),
        onRemoteTrack: vi.fn(),
        onTrackUnavailable: (event) => reports.push(event),
      },
      {
        // Far away: these tests are about PartyTracks' own retries.
        pullWatchdogMs: 10 * 60_000,
        schedule: timers.schedule,
        now: timers.clock,
      },
    );
    /** One not-found answer `afterMs` from now. */
    const notFoundAfter = (afterMs: number, error = NOT_FOUND) => {
      timers.advance(afterMs);
      transport.pullErrors$.next(error);
    };
    return { timers, transport, reports, manager, notFoundAfter };
  }

  it("reports a pull the SFU keeps not finding once, after it persists", () => {
    const { reports, manager, notFoundAfter } = setup();
    manager.offerTracks([offer]);

    // PartyTracks' retries: 100, 200, 400, 800 ms apart.
    notFoundAfter(0);
    notFoundAfter(100);
    notFoundAfter(200);
    notFoundAfter(400);
    expect(reports).toEqual([]);
    notFoundAfter(800);
    expect(reports).toEqual([
      {
        participant_id: "publisher",
        track_name: "cam-audio-publisher",
        sfu_track_name: "opaque-publisher-audio",
        session_id: "publisher-session",
        notFoundCount: 5,
        notFoundForMs: 1_500,
        report: 1,
      },
    ]);
    notFoundAfter(1_600);
    expect(reports).toHaveLength(1);
    manager.dispose();
  });

  it("does not report the pull-after-push race that heals", () => {
    const { transport, reports, manager, notFoundAfter } = setup();
    manager.offerTracks([offer]);
    notFoundAfter(0);
    notFoundAfter(100);
    transport.pulledTracks
      .get(offer.track_name)
      ?.next(mediaTrack("audio", "publisher-audio"));
    // A late answer after the track arrived starts counting afresh.
    notFoundAfter(5_000);
    expect(reports).toEqual([]);
    manager.dispose();
  });

  it("needs both the error count and the time span", () => {
    const { reports, manager, notFoundAfter } = setup();
    manager.offerTracks([offer]);
    notFoundAfter(0);
    notFoundAfter(5_000);
    expect(reports).toHaveLength(1);

    const fast = setup();
    fast.manager.offerTracks([offer]);
    for (let i = 0; i < 20; i++) fast.notFoundAfter(40);
    expect(fast.reports).toEqual([]);
    manager.dispose();
    fast.manager.dispose();
  });

  it("reports an alias at most every 5 s and 3 times, across republished SFU tracks", () => {
    const { reports, manager, notFoundAfter } = setup();
    manager.offerTracks([offer]);
    notFoundAfter(0);
    notFoundAfter(1_000);
    expect(reports.map((report) => report.report)).toEqual([1]);
    notFoundAfter(4_999);
    expect(reports).toHaveLength(1);
    notFoundAfter(1);
    expect(reports.map((report) => report.report)).toEqual([1, 2]);

    // The publisher republished, and the new SFU track is not found either.
    const republished = { ...offer, sfu_track_name: "opaque-republished" };
    manager.offerTracks([republished]);
    const republishedNotFound = {
      ...NOT_FOUND,
      trackName: "opaque-republished",
    };
    notFoundAfter(0, republishedNotFound);
    notFoundAfter(5_000, republishedNotFound);
    expect(reports.map((report) => report.report)).toEqual([1, 2, 3]);
    expect(reports[2]).toMatchObject({
      sfu_track_name: "opaque-republished",
      notFoundCount: 2,
    });
    for (let i = 0; i < 10; i++) notFoundAfter(10_000, republishedNotFound);
    expect(reports).toHaveLength(3);
    manager.dispose();
  });

  it("stops reporting once the track arrives", () => {
    const { transport, reports, manager, notFoundAfter } = setup();
    manager.offerTracks([offer]);
    notFoundAfter(0);
    notFoundAfter(1_000);
    expect(reports).toHaveLength(1);
    transport.pulledTracks
      .get(offer.track_name)
      ?.next(mediaTrack("audio", "publisher-audio"));
    notFoundAfter(5_000);
    expect(reports).toHaveLength(1);
    manager.dispose();
  });

  it("ignores other errors, other tracks and tracks it no longer pulls", () => {
    const { reports, manager, notFoundAfter } = setup();
    manager.offerTracks([offer]);
    for (const error of [
      { ...NOT_FOUND, errorCode: "invalid_request_error" },
      { ...NOT_FOUND, sessionId: "other-session" },
      { ...NOT_FOUND, trackName: "opaque-other" },
    ]) {
      notFoundAfter(0, error);
      notFoundAfter(2_000, error);
    }
    expect(reports).toEqual([]);

    manager.setRemoteTrackSubscription(offer.track_name, false);
    notFoundAfter(0);
    notFoundAfter(2_000);
    expect(reports).toEqual([]);

    manager.dispose();
    notFoundAfter(0);
    notFoundAfter(2_000);
    expect(reports).toEqual([]);
  });
});

describe("PartyTracksMediaManager withdrawn publications", () => {
  const cameraMetadata = (sfuTrackName: string): TrackInfo => ({
    participant_id: "publisher",
    track_name: "cam-video-publisher",
    sfu_track_name: sfuTrackName,
    session_id: "publisher-session",
    kind: "video",
  });

  function setup() {
    const transport = new TestTransport();
    const announced: TrackInfo[] = [];
    const stopped: string[] = [];
    const keepalives: Array<{
      track: MediaStreamTrack;
      longestGapMs: () => number;
      stop: () => void;
    }> = [];
    let keepaliveGapMs = 1_000;
    const manager = new PartyTracksMediaManager(
      transport,
      "publisher",
      {
        onPublicationMetadata: (track) => announced.push(track),
        onPublicationStopped: (trackName) => stopped.push(trackName),
        onRemoteTrack: vi.fn(),
      },
      {
        createVideoKeepalive: () => {
          const keepalive = {
            track: mediaTrack("video", `keepalive-${keepalives.length}`),
            longestGapMs: () => keepaliveGapMs,
            stop: vi.fn(),
          };
          keepalives.push(keepalive);
          return keepalive;
        },
      },
    );
    return {
      transport,
      announced,
      stopped,
      keepalives,
      manager,
      setKeepaliveGapMs: (ms: number) => (keepaliveGapMs = ms),
    };
  }

  it("pushes afresh when the keepalive stalled long enough for the SFU to drop the track", () => {
    const { transport, announced, keepalives, manager, setKeepaliveGapMs } =
      setup();
    manager.publishStream(mediaStream(mediaTrack("video", "camera-1")), "cam");
    transport.pushMetadata
      .get("cam-video-publisher")
      ?.next(cameraMetadata("sfu-camera-1"));
    manager.unpublishTrack("cam-video-publisher");
    setKeepaliveGapMs(26_000);

    const camera2 = mediaTrack("video", "camera-2");
    manager.publishStream(mediaStream(camera2), "cam");
    expect(transport.pushCount).toBe(2);
    expect(keepalives[0]?.stop).toHaveBeenCalledOnce();
    expect(transport.pushSources.get("cam-video-publisher")).toEqual([camera2]);
    // Announced once the new push is answered, not before.
    expect(announced).toEqual([cameraMetadata("sfu-camera-1")]);
    transport.pushMetadata
      .get("cam-video-publisher")
      ?.next(cameraMetadata("sfu-camera-2"));
    expect(announced).toEqual([
      cameraMetadata("sfu-camera-1"),
      cameraMetadata("sfu-camera-2"),
    ]);
    manager.dispose();
  });

  it("keeps a camera turned off pushed on a keepalive and resumes the same SFU track", () => {
    const { transport, announced, stopped, keepalives, manager } = setup();
    const camera1 = mediaTrack("video", "camera-1");
    manager.publishStream(mediaStream(camera1), "cam");
    transport.pushMetadata
      .get("cam-video-publisher")
      ?.next(cameraMetadata("sfu-camera"));
    expect(announced).toEqual([cameraMetadata("sfu-camera")]);

    expect(manager.unpublishTrack("cam-video-publisher")).toBe(true);
    expect(stopped).toEqual(["cam-video-publisher"]);
    const keepalive = keepalives[0]!;
    expect(transport.pushSources.get("cam-video-publisher")).toEqual([
      camera1,
      keepalive.track,
    ]);
    // Withdrawn: not a publication to anything else.
    expect(manager.getPublishedTrack("cam-video-publisher")).toBeNull();
    expect(
      manager.replaceTrack("cam-video-publisher", mediaTrack("video", "x")),
    ).toBe(false);
    manager.reannouncePublications();
    expect(announced).toHaveLength(1);

    const camera2 = mediaTrack("video", "camera-2");
    manager.publishStream(mediaStream(camera2), "cam");
    expect(transport.pushCount).toBe(1);
    expect(transport.pushSources.get("cam-video-publisher")).toEqual([
      camera1,
      keepalive.track,
      camera2,
    ]);
    expect(keepalive.stop).toHaveBeenCalledOnce();
    expect(announced).toEqual([
      cameraMetadata("sfu-camera"),
      cameraMetadata("sfu-camera"),
    ]);
    expect(manager.getPublishedTrack("cam-video-publisher")).toBe(camera2);
    manager.dispose();
  });

  it("announces a track re-pushed while withdrawn only once it is published again", () => {
    const { transport, announced, manager } = setup();
    manager.publishStream(mediaStream(mediaTrack("video", "camera-1")), "cam");
    const metadata = transport.pushMetadata.get("cam-video-publisher");
    metadata?.next(cameraMetadata("sfu-camera-1"));
    manager.unpublishTrack("cam-video-publisher");
    // A rebuilt session pushes the keepalive again as a new SFU track.
    metadata?.next(cameraMetadata("sfu-camera-2"));
    expect(announced).toEqual([cameraMetadata("sfu-camera-1")]);

    manager.publishStream(mediaStream(mediaTrack("video", "camera-2")), "cam");
    expect(announced).toEqual([
      cameraMetadata("sfu-camera-1"),
      cameraMetadata("sfu-camera-2"),
    ]);
    manager.dispose();
  });

  it("closes audio, and video the SFU has not answered yet", () => {
    const { transport, keepalives, manager } = setup();
    manager.publishStream(
      mediaStream(mediaTrack("audio", "screen-audio")),
      "screen",
    );
    manager.publishStream(mediaStream(mediaTrack("video", "camera")), "cam");
    manager.unpublishTrack("screen-audio-publisher");
    manager.unpublishTrack("cam-video-publisher");
    expect(keepalives).toEqual([]);

    // Published again: a fresh push.
    manager.publishStream(mediaStream(mediaTrack("video", "camera")), "cam");
    expect(transport.pushCount).toBe(3);
    manager.dispose();
  });

  it("stops the keepalive when the manager is disposed", () => {
    const { transport, keepalives, manager } = setup();
    manager.publishStream(mediaStream(mediaTrack("video", "camera")), "cam");
    transport.pushMetadata
      .get("cam-video-publisher")
      ?.next(cameraMetadata("sfu-camera"));
    manager.unpublishTrack("cam-video-publisher");
    manager.dispose();
    expect(keepalives[0]?.stop).toHaveBeenCalledOnce();
  });
});

describe("PartyTracksMediaManager withdrawn remote tracks", () => {
  const camera = (sfuTrackName: string, participant = "remote"): TrackInfo => ({
    participant_id: participant,
    track_name: `cam-video-${participant}`,
    sfu_track_name: sfuTrackName,
    session_id: `${participant}-session`,
    kind: "video",
  });

  function setup() {
    const transport = new TestTransport();
    const events: string[] = [];
    const manager = new PartyTracksMediaManager(transport, "viewer", {
      onPublicationMetadata: vi.fn(),
      onPublicationStopped: vi.fn(),
      onRemoteTrack: ({ action, track, trackInfo }) =>
        events.push(`${action} ${track.id} ${trackInfo.sfu_track_name}`),
    });
    return { transport, events, manager };
  }

  it("hides a withdrawn camera and shows the same pull when it comes back", () => {
    const { transport, events, manager } = setup();
    manager.offerTracks([camera("sfu-camera")]);
    const remote = mediaTrack("video", "remote-camera");
    transport.pulledTracks.get("cam-video-remote")?.next(remote);

    manager.withdrawRemoteTracks(["cam-video-remote"]);
    expect(events).toEqual([
      "add remote-camera sfu-camera",
      "remove remote-camera sfu-camera",
    ]);
    expect(remote.stop).not.toHaveBeenCalled();
    expect(manager.hasRemoteOffer("cam-video-remote")).toBe(false);
    expect(manager.getRemoteTracksForDiagnostics()).toEqual([]);

    // The publisher turned the camera on again: same SFU track, no pull.
    manager.offerTracks([camera("sfu-camera")]);
    expect(transport.pullCount).toBe(1);
    expect(transport.pullMetadata.get("cam-video-remote")).toEqual([
      camera("sfu-camera"),
    ]);
    expect(events.at(-1)).toBe("add remote-camera sfu-camera");
    manager.dispose();
  });

  it("pulls another SFU track for a withdrawn pull on a fresh path and shows it", () => {
    const { transport, events, manager } = setup();
    manager.offerTracks([camera("sfu-camera-1")]);
    const first = mediaTrack("video", "remote-camera-1");
    transport.pulledTracks.get("cam-video-remote")?.next(first);
    manager.withdrawRemoteTracks(["cam-video-remote"]);

    // A publisher with no keepalive (an iPhone) pushes each camera as a new
    // SFU track. Pulling it into the parked pull's connection can get the
    // recycled MID back, which Chrome rejects: it is pulled on a fresh path.
    manager.offerTracks([camera("sfu-camera-2")]);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(transport.closedPulls).toEqual(["cam-video-remote"]);
    expect(transport.pulls).toEqual([
      { trackName: "cam-video-remote", fresh: false },
      { trackName: "cam-video-remote", fresh: true },
    ]);
    expect(transport.pullMetadata.get("cam-video-remote")).toEqual([
      camera("sfu-camera-2"),
    ]);
    const second = mediaTrack("video", "remote-camera-2");
    transport.pulledTracks.get("cam-video-remote")?.next(second);
    expect(events).toEqual([
      "add remote-camera-1 sfu-camera-1",
      "remove remote-camera-1 sfu-camera-1",
      "add remote-camera-2 sfu-camera-2",
    ]);
    manager.dispose();
  });

  it("closes withdrawn pulls when their participant leaves or is gone after a resync", () => {
    const { transport, events, manager } = setup();
    manager.offerTracks([camera("sfu-a", "a"), camera("sfu-b", "b")]);
    const a = mediaTrack("video", "a-camera");
    const b = mediaTrack("video", "b-camera");
    transport.pulledTracks.get("cam-video-a")?.next(a);
    transport.pulledTracks.get("cam-video-b")?.next(b);
    manager.withdrawRemoteTracks(["cam-video-a", "cam-video-b"]);
    events.length = 0;

    manager.removeParticipant("a");
    expect(a.stop).toHaveBeenCalledOnce();
    // Already hidden: no second remove.
    expect(events).toEqual([]);

    // A snapshot without b (it left while this client was away).
    manager.syncRemoteTracks([camera("sfu-c", "c")]);
    expect(b.stop).toHaveBeenCalledOnce();
    expect(events).toEqual([]);
    manager.dispose();
  });

  it("closes withdrawn audio instead of keeping it", () => {
    const { transport, manager } = setup();
    const microphone: TrackInfo = {
      ...camera("sfu-mic"),
      track_name: "cam-audio-remote",
      kind: "audio",
    };
    manager.offerTracks([microphone]);
    const remote = mediaTrack("audio", "remote-mic");
    transport.pulledTracks.get("cam-audio-remote")?.next(remote);
    manager.withdrawRemoteTracks(["cam-audio-remote"]);
    expect(remote.stop).toHaveBeenCalledOnce();
    expect(manager.hasRemotePulls).toBe(false);
    manager.dispose();
  });

  it("closes a withdrawn pull the SFU no longer finds", () => {
    const { transport, manager } = setup();
    manager.offerTracks([camera("sfu-camera")]);
    const remote = mediaTrack("video", "remote-camera");
    transport.pulledTracks.get("cam-video-remote")?.next(remote);
    manager.withdrawRemoteTracks(["cam-video-remote"]);
    // The viewer's session was rebuilt and PartyTracks pulls it again.
    transport.pullErrors$.next({
      errorCode: "not_found_track_error",
      sessionId: "remote-session",
      trackName: "sfu-camera",
    } as PartyTracksPullError);
    expect(remote.stop).toHaveBeenCalledOnce();
    expect(manager.hasRemotePulls).toBe(false);
    manager.dispose();
  });

  it("drops a pull withdrawn before it produced a track", () => {
    const { transport, manager } = setup();
    manager.offerTracks([camera("sfu-camera")]);
    manager.withdrawRemoteTracks(["cam-video-remote"]);
    expect(manager.hasRemotePulls).toBe(false);
    manager.offerTracks([camera("sfu-camera")]);
    expect(transport.pullCount).toBe(2);
    manager.dispose();
  });
});

describe("PartyTracksMediaManager remote video recovery", () => {
  const camera: TrackInfo = {
    participant_id: "remote",
    track_name: "cam-video-remote",
    sfu_track_name: "sfu-camera",
    session_id: "remote-session",
    kind: "video",
  };
  const microphone: TrackInfo = {
    ...camera,
    track_name: "cam-audio-remote",
    sfu_track_name: "sfu-mic",
    kind: "audio",
  };

  function setup(withHealth = false) {
    const transport = new TestTransport();
    const events: string[] = [];
    let now = 0;
    const frames = new Map<MediaStreamTrack, number>();
    const timers: Array<{ at: number; run: () => void; live: boolean }> = [];
    const schedule = (run: () => void, ms: number) => {
      const timer = { at: now + ms, run, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    };
    /** Runs due timers in order, letting each one's async work settle. */
    const advance = async (ms: number) => {
      const end = now + ms;
      for (;;) {
        const due = timers
          .filter((timer) => timer.live && timer.at <= end)
          .sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        due.live = false;
        now = due.at;
        due.run();
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
      }
      now = end;
    };
    const options: PartyTracksMediaManagerOptions = {
      schedule,
      pullWatchdogMs: 10_000,
      pullRetryBaseMs: 1_000,
      videoRenderDemand: {
        // Every track is on screen.
        largestRenderFor: () => ({ width: 640, height: 360 }),
        subscribe: () => () => {},
      },
    };
    const health: PartyTracksMediaManagerOptions = {
      readVideoFrames: (track: MediaStreamTrack) => ({
        frames: frames.get(track) ?? 0,
        at: now,
      }),
      videoHealthTiming: {
        schedule,
        now: () => now,
        intervalMs: 1_000,
        firstFrameTimeoutMs: 6_000,
        stallAfterMs: 5_000,
      },
    };
    const manager = new PartyTracksMediaManager(
      transport,
      "viewer",
      {
        onPublicationMetadata: vi.fn(),
        onPublicationStopped: vi.fn(),
        onRemoteTrack: ({ action, track }) =>
          events.push(`${action} ${track.id}`),
      },
      withHealth ? { ...options, ...health } : options,
    );
    return { transport, events, manager, advance, frames };
  }

  it("pulls a shown camera again on a fresh path, keeping its layer", () => {
    const { transport, events, manager } = setup();
    manager.offerTracks([camera]);
    const first = mediaTrack("video", "first");
    transport.pulledTracks.get("cam-video-remote")?.next(first);

    expect(manager.recoverRemoteVideo("cam-video-remote")).toBe(true);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(transport.closedPulls).toEqual(["cam-video-remote"]);
    expect(transport.pulls).toEqual([
      { trackName: "cam-video-remote", fresh: false },
      { trackName: "cam-video-remote", fresh: true },
    ]);
    // Already being pulled again: nothing more to do until it arrives.
    expect(manager.recoverRemoteVideo("cam-video-remote")).toBe(false);
    transport.pulledTracks
      .get("cam-video-remote")
      ?.next(mediaTrack("video", "second"));
    expect(events).toEqual(["add first", "remove first", "add second"]);
    manager.dispose();
  });

  it("pulls a recovered camera fresh again when its fresh pull was lost to a withdrawal", () => {
    const { transport, events, manager } = setup();
    manager.offerTracks([camera]);
    transport.pulledTracks
      .get("cam-video-remote")
      ?.next(mediaTrack("video", "first"));
    // Recovered: the main-session pull closes, a fresh one is on its way.
    expect(manager.recoverRemoteVideo("cam-video-remote")).toBe(true);
    // The publisher turns its camera off before the fresh pull lands (it had
    // no track, so it is closed, not parked), then on again.
    manager.withdrawRemoteTracks(["cam-video-remote"]);
    manager.offerTracks([camera]);
    expect(transport.pulls).toEqual([
      { trackName: "cam-video-remote", fresh: false },
      { trackName: "cam-video-remote", fresh: true },
      { trackName: "cam-video-remote", fresh: true },
    ]);
    // Once a fresh pull has brought it back, a later pull is ordinary again.
    transport.pulledTracks
      .get("cam-video-remote")
      ?.next(mediaTrack("video", "second"));
    expect(events).toEqual(["add first", "remove first", "add second"]);
    manager.dispose();
  });

  it("pulls dropped video fresh when a new offer cuts its backoff short", async () => {
    const { transport, manager, advance } = setup();
    manager.offerTracks([camera]);
    // No track: the watchdog drops the pull, which waits out its backoff.
    await advance(10_000);
    // The publisher republishes meanwhile: the new offer is pulled now.
    manager.offerTracks([{ ...camera, sfu_track_name: "sfu-camera-2" }]);
    expect(transport.pulls).toEqual([
      { trackName: "cam-video-remote", fresh: false },
      { trackName: "cam-video-remote", fresh: true },
    ]);
    manager.dispose();
  });

  it("pulls a camera ordinarily once a fresh pull has brought it back", () => {
    const { transport, manager } = setup();
    manager.offerTracks([camera]);
    transport.pulledTracks
      .get("cam-video-remote")
      ?.next(mediaTrack("video", "first"));
    manager.recoverRemoteVideo("cam-video-remote");
    transport.pulledTracks
      .get("cam-video-remote")
      ?.next(mediaTrack("video", "second"));
    // It plays on its fresh session; the publisher withdraws it (parked).
    manager.withdrawRemoteTracks(["cam-video-remote"]);
    // Back with the same SFU track: the parked pull just shows it again.
    manager.offerTracks([camera]);
    expect(transport.pullCount).toBe(2);
    manager.dispose();
  });

  it("recovers nothing that is not shown video", () => {
    const { transport, manager } = setup();
    expect(manager.recoverRemoteVideo("cam-video-remote")).toBe(false);
    manager.offerTracks([camera, microphone]);
    transport.pulledTracks
      .get("cam-audio-remote")
      ?.next(mediaTrack("audio", "mic"));
    expect(manager.recoverRemoteVideo("cam-audio-remote")).toBe(false);
    transport.pulledTracks
      .get("cam-video-remote")
      ?.next(mediaTrack("video", "camera"));
    manager.withdrawRemoteTracks(["cam-video-remote"]);
    expect(manager.recoverRemoteVideo("cam-video-remote")).toBe(false);
    expect(transport.pullCount).toBe(2);
    manager.dispose();
  });

  it("pulls dropped video again on a fresh path, and dropped audio on the same one", async () => {
    const { transport, manager, advance } = setup();
    manager.offerTracks([camera, microphone]);
    // Neither produces a track: the watchdog drops both, then they retry.
    await advance(10_000);
    await advance(1_000);
    expect(transport.pulls).toEqual([
      { trackName: "cam-video-remote", fresh: false },
      { trackName: "cam-audio-remote", fresh: false },
      { trackName: "cam-video-remote", fresh: true },
      { trackName: "cam-audio-remote", fresh: false },
    ]);
    manager.dispose();
  });

  it("re-pulls a shown camera that decodes nothing once, then leaves it stalled", async () => {
    const { transport, events, manager, advance, frames } = setup(true);
    manager.offerTracks([camera]);
    const first = mediaTrack("video", "first");
    transport.pulledTracks.get("cam-video-remote")?.next(first);
    await advance(1_000);
    expect(manager.videoHealth.flowOf(first)).toBe("waiting");

    // No frame in time: pulled again on a fresh path.
    await advance(6_000);
    expect(transport.pulls.at(-1)).toEqual({
      trackName: "cam-video-remote",
      fresh: true,
    });
    expect(manager.videoHealth.flowOf(first)).toBeUndefined();
    const second = mediaTrack("video", "second");
    transport.pulledTracks.get("cam-video-remote")?.next(second);
    // The re-pull's new connection gets longer for its first frame.
    await advance(8_000);
    expect(manager.videoHealth.flowOf(second)).toBe("waiting");
    await advance(3_000);
    expect(manager.videoHealth.flowOf(second)).toBe("stalled");
    expect(transport.pullCount).toBe(2);

    // Frames come back: it plays.
    frames.set(second, 25);
    await advance(1_000);
    expect(manager.videoHealth.flowOf(second)).toBe("playing");
    expect(events).toEqual(["add first", "remove first", "add second"]);
    manager.dispose();
  });

  it("measures cameras only, not shares or audio", async () => {
    const { transport, manager, advance } = setup(true);
    const share: TrackInfo = {
      ...camera,
      track_name: "screen-video-remote",
      sfu_track_name: "sfu-share",
    };
    manager.setRemoteTrackSubscription("screen-video-remote", true);
    manager.offerTracks([share]);
    const shared = mediaTrack("video", "share");
    transport.pulledTracks.get("screen-video-remote")?.next(shared);
    await advance(30_000);
    expect(manager.videoHealth.flowOf(shared)).toBeUndefined();
    expect(transport.pullCount).toBe(1);
    manager.dispose();
  });
});
