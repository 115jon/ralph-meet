import type { PartyTracksPullError, TrackInfo } from "@ralph/voice-media";
import { BehaviorSubject, Observable, Subject, type Subscription } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import {
  SplitVideoTransport,
  type SplitTransportSession,
} from "./split-transport";

class FakeSession implements SplitTransportSession {
  readonly peerConnectionState$ = new Subject<RTCPeerConnectionState>();
  readonly pullErrors$ = new Subject<PartyTracksPullError>();
  readonly pulls: string[] = [];
  readonly closed: string[] = [];
  readonly tokens: string[] = [];
  disposed = false;

  constructor(readonly name: string) {}

  push = vi.fn(() => new Observable<TrackInfo>());

  pull(track$: Observable<TrackInfo>): Observable<MediaStreamTrack> {
    return new Observable<MediaStreamTrack>((subscriber) => {
      let trackName = "";
      const metadata = track$.subscribe((track) => {
        trackName = track.track_name;
      });
      this.pulls.push(trackName);
      subscriber.next({
        id: `${this.name}:${trackName}`,
      } as unknown as MediaStreamTrack);
      return () => {
        metadata.unsubscribe();
        this.closed.push(trackName);
      };
    });
  }

  updateVoiceToken(voiceToken: string): void {
    this.tokens.push(voiceToken);
  }

  updateIceServers = vi.fn();

  dispose(): void {
    this.disposed = true;
  }
}

function info(trackName: string, kind: "audio" | "video"): TrackInfo {
  return {
    participant_id: "peer",
    track_name: trackName,
    sfu_track_name: `${trackName}-sfu`,
    session_id: "peer-session",
    kind,
  };
}

function setup() {
  const main = new FakeSession("main");
  const videos: FakeSession[] = [];
  const timers: Array<{ run: () => void; cancelled: boolean }> = [];
  const transport = new SplitVideoTransport(main, {
    createVideoSession: () => {
      const session = new FakeSession(`video${videos.length + 1}`);
      videos.push(session);
      return session;
    },
    schedule: (run) => {
      const timer = { run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  const runTimers = () => {
    for (const timer of timers.splice(0)) if (!timer.cancelled) timer.run();
  };
  const pull = (trackName: string, kind: "audio" | "video") => {
    const tracks: string[] = [];
    const subscription: Subscription = transport
      .pull(new BehaviorSubject(info(trackName, kind)))
      .subscribe((track) => tracks.push(track.id));
    return { tracks, subscription };
  };
  return { main, videos, transport, runTimers, pull };
}

describe("SplitVideoTransport", () => {
  it("pulls audio on the main session and video on a session of its own", () => {
    const { main, videos, pull } = setup();
    const audio = pull("cam-audio-peer", "audio");
    const camera = pull("cam-video-peer", "video");
    const share = pull("screen-video-peer", "video");
    expect(audio.tracks).toEqual(["main:cam-audio-peer"]);
    expect(camera.tracks).toEqual(["video1:cam-video-peer"]);
    expect(share.tracks).toEqual(["video1:screen-video-peer"]);
    expect(main.pulls).toEqual(["cam-audio-peer"]);
    expect(videos).toHaveLength(1);
  });

  it("drops the video session once its pulls closed and pulls again on a new one", () => {
    const { main, videos, transport, runTimers, pull } = setup();
    const audio = pull("cam-audio-peer", "audio");
    const camera = pull("cam-video-peer", "video");
    const share = pull("screen-video-peer", "video");

    // The app goes to the background: every video pull closes. The session
    // stays a moment so PartyTracks can close them at the SFU.
    camera.subscription.unsubscribe();
    share.subscription.unsubscribe();
    expect(videos[0]?.closed).toEqual(["cam-video-peer", "screen-video-peer"]);
    expect(videos[0]?.disposed).toBe(false);
    runTimers();
    expect(videos[0]?.disposed).toBe(true);
    expect(transport.videoSessionCount).toBe(0);
    expect(main.closed).toEqual([]);
    expect(audio.tracks).toEqual(["main:cam-audio-peer"]);

    // Back in front: a new session, so no closed m-line is recycled.
    const again = pull("screen-video-peer", "video");
    expect(again.tracks).toEqual(["video2:screen-video-peer"]);
    expect(videos).toHaveLength(2);
  });

  it("starts a new video session for a pull made while the last one drains", () => {
    const { videos, transport, runTimers, pull } = setup();
    pull("cam-video-peer", "video").subscription.unsubscribe();
    const again = pull("cam-video-peer", "video");
    expect(again.tracks).toEqual(["video2:cam-video-peer"]);
    expect(transport.videoSessionCount).toBe(2);
    runTimers();
    expect(videos[0]?.disposed).toBe(true);
    expect(videos[1]?.disposed).toBe(false);
  });

  it("keeps a video session while any of its pulls is open", () => {
    const { videos, runTimers, pull } = setup();
    const camera = pull("cam-video-peer", "video");
    pull("screen-video-peer", "video");
    camera.subscription.unsubscribe();
    runTimers();
    expect(videos[0]?.disposed).toBe(false);
    expect(pull("cam-video-peer", "video").tracks).toEqual([
      "video1:cam-video-peer",
    ]);
  });

  it("hands new credentials to the open video session and disposes everything", () => {
    const { main, videos, transport, pull } = setup();
    pull("cam-video-peer", "video");
    transport.updateVoiceToken("token-2");
    expect(main.tokens).toEqual(["token-2"]);
    expect(videos[0]?.tokens).toEqual(["token-2"]);
    transport.dispose();
    expect(main.disposed).toBe(true);
    expect(videos[0]?.disposed).toBe(true);
  });

  it("reports pull errors of the main and the current video session", () => {
    const { main, videos, transport, pull } = setup();
    const errors: string[] = [];
    transport.pullErrors$.subscribe((error) => errors.push(error.trackName));
    pull("cam-video-peer", "video");
    const error = (trackName: string) =>
      ({ trackName }) as unknown as PartyTracksPullError;
    main.pullErrors$.next(error("audio-sfu"));
    videos[0]?.pullErrors$.next(error("video-sfu"));
    expect(errors).toEqual(["audio-sfu", "video-sfu"]);
  });
});
