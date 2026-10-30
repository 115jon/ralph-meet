import type { TrackInfo } from "@/lib/types";
import type { RalphPublishedTrack } from "@/lib/voice/partytracks-transport";
import { Observable, Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import {
  PartyTracksMediaManager,
  type PartyTracksMediaTransport,
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
