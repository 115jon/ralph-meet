import type { PartyTracksPullError } from "../partytracks-pull-errors";
import type { TrackInfo } from "../track-info";
import { BehaviorSubject, Observable, Subject, type Subscription } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import {
  SplitVideoTransport,
  type SplitTransportSession,
} from "../split-video-transport";

class FakeSession implements SplitTransportSession {
  readonly peerConnectionState$ = new Subject<RTCPeerConnectionState>();
  readonly pullErrors$ = new Subject<PartyTracksPullError>();
  readonly pulls: string[] = [];
  readonly closed: string[] = [];
  readonly tokens: string[] = [];
  disposed = false;

  constructor(readonly name: string) {}

  push = vi.fn(() => new Observable<TrackInfo>());

  /** The tracks this session pulled, as its receivers. */
  readonly receivers: RTCRtpReceiver[] = [];
  readonly peerConnection = {
    getReceivers: () => this.receivers,
  } as unknown as RTCPeerConnection;

  pull(track$: Observable<TrackInfo>): Observable<MediaStreamTrack> {
    return new Observable<MediaStreamTrack>((subscriber) => {
      let trackName = "";
      const metadata = track$.subscribe((track) => {
        trackName = track.track_name;
      });
      this.pulls.push(trackName);
      const track = {
        id: `${this.name}:${trackName}`,
      } as unknown as MediaStreamTrack;
      this.receivers.push({ track } as RTCRtpReceiver);
      subscriber.next(track);
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

function setup(videoPulls?: "all" | "fresh") {
  const main = new FakeSession("main");
  const videos: FakeSession[] = [];
  const timers: Array<{ run: () => void; cancelled: boolean }> = [];
  const transport = new SplitVideoTransport(main, {
    videoPulls,
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
  const pull = (
    trackName: string,
    kind: "audio" | "video",
    fresh?: boolean,
  ) => {
    const tracks: string[] = [];
    const pulled: MediaStreamTrack[] = [];
    const subscription: Subscription = transport
      .pull(new BehaviorSubject(info(trackName, kind)), { fresh })
      .subscribe((track) => {
        tracks.push(track.id);
        pulled.push(track);
      });
    return { tracks, pulled, subscription };
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

  it("on a fresh pull starts a new video session and retires the current one", () => {
    const { videos, transport, runTimers, pull } = setup();
    const camera = pull("cam-video-a", "video");
    // A stalled camera pulled again: the old session keeps its own pulls.
    const again = pull("cam-video-b", "video", true);
    expect(camera.tracks).toEqual(["video1:cam-video-a"]);
    expect(again.tracks).toEqual(["video2:cam-video-b"]);
    // New plain pulls join the fresh session, not the retired one.
    expect(pull("screen-video-a", "video").tracks).toEqual([
      "video2:screen-video-a",
    ]);
    expect(transport.videoSessionCount).toBe(2);
    camera.subscription.unsubscribe();
    runTimers();
    expect(videos[0]?.disposed).toBe(true);
    expect(videos[1]?.disposed).toBe(false);
  });

  it("in fresh mode pulls video on the main session unless asked for a fresh path", () => {
    const { main, videos, transport, runTimers, pull } = setup("fresh");
    expect(pull("cam-video-a", "video").tracks).toEqual(["main:cam-video-a"]);
    expect(pull("cam-audio-a", "audio", true).tracks).toEqual([
      "main:cam-audio-a",
    ]);
    const recovered = pull("cam-video-b", "video", true);
    expect(recovered.tracks).toEqual(["video1:cam-video-b"]);
    expect(main.pulls).toEqual(["cam-video-a", "cam-audio-a"]);
    // Each recovery gets a connection of its own.
    expect(pull("cam-video-c", "video", true).tracks).toEqual([
      "video2:cam-video-c",
    ]);
    recovered.subscription.unsubscribe();
    runTimers();
    expect(videos[0]?.disposed).toBe(true);
    expect(transport.videoSessionCount).toBe(1);
  });

  it("finds a pulled track's receiver on whichever session pulls it", () => {
    const { transport, pull } = setup("fresh");
    const onMain = pull("cam-video-a", "video");
    const onVideo = pull("cam-video-b", "video", true);
    const mainTrack = onMain.pulled[0] as MediaStreamTrack;
    const videoTrack = onVideo.pulled[0] as MediaStreamTrack;
    expect(transport.receiverFor(mainTrack)?.track).toBe(mainTrack);
    expect(transport.receiverFor(videoTrack)?.track).toBe(videoTrack);
    expect(transport.isOnMainSession(mainTrack)).toBe(true);
    expect(transport.isOnMainSession(videoTrack)).toBe(false);
    expect(
      transport.receiverFor({ id: "other" } as unknown as MediaStreamTrack),
    ).toBeNull();
  });

  it("reports pull errors of a retired video session while it still pulls", () => {
    const { videos, transport, pull } = setup();
    const errors: string[] = [];
    transport.pullErrors$.subscribe((error) => errors.push(error.trackName));
    pull("cam-video-a", "video");
    pull("cam-video-b", "video", true);
    const error = (trackName: string) =>
      ({ trackName }) as unknown as PartyTracksPullError;
    videos[0]?.pullErrors$.next(error("retired-sfu"));
    videos[1]?.pullErrors$.next(error("fresh-sfu"));
    expect(errors).toEqual(["retired-sfu", "fresh-sfu"]);
  });
});
