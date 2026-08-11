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
});
