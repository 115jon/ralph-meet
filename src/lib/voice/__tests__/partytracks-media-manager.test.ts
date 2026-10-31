import type { TrackInfo } from "@/lib/types";
import type { PartyTracksPullError } from "@/lib/voice/partytracks-pull-errors";
import type { RalphPublishedTrack } from "@/lib/voice/partytracks-transport";
import { Observable, Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import {
  PartyTracksMediaManager,
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
  pullCount = 0;

  push(
    sourceTrack$: Observable<MediaStreamTrack>,
    identity: RalphPublishedTrack,
  ): Observable<TrackInfo> {
    const sourceTracks: MediaStreamTrack[] = [];
    sourceTrack$.subscribe((track) => sourceTracks.push(track));
    this.pushSources.set(identity.trackName, sourceTracks);
    const metadata = new Subject<TrackInfo>();
    this.pushMetadata.set(identity.trackName, metadata);
    return metadata;
  }

  pull(track$: Observable<TrackInfo>): Observable<MediaStreamTrack> {
    this.pullCount += 1;
    let trackName = "";
    const metadata: TrackInfo[] = [];
    track$.subscribe((track) => {
      trackName = track.track_name;
      metadata.push(track);
    });
    this.pullMetadata.set(trackName, metadata);
    const pulledTrack = new Subject<MediaStreamTrack>();
    this.pulledTracks.set(trackName, pulledTrack);
    return pulledTrack;
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
