import { describe, expect, it, vi } from "vitest";

vi.mock("react-native-webrtc", () => ({
  MediaStream: class {
    toURL(): string {
      return "stream-url";
    }
    release(): void {}
  },
}));
vi.mock("./render-demand", () => ({
  registerRenderStream: vi.fn(),
  unregisterRenderStream: vi.fn(),
}));
interface StoredCall {
  videos: Record<string, unknown>;
  cameraFlows: Record<string, string>;
}
const store = vi.hoisted(() => {
  const call: StoredCall = { videos: {}, cameraFlows: {} };
  return { call };
});
vi.mock("./store", () => ({
  updateCall: (update: (call: typeof store.call) => typeof store.call) => {
    store.call = update(store.call);
  },
}));

import type { TrackInfo, VideoFlow } from "@ralph/voice-media";

import { RemoteVideo, type VideoSubscriber } from "./remote-video";

function setup(
  videoFlowOf: (track: MediaStreamTrack) => VideoFlow | undefined = () =>
    undefined,
) {
  const calls: string[] = [];
  const subscriber: VideoSubscriber = {
    setRemoteTrackSubscription: (trackName, subscribe) =>
      calls.push(`${subscribe ? "sub" : "unsub"}:${trackName}`),
    releaseUnwatchedVideo: () => calls.push("release"),
    videoFlowOf,
  };
  const video = new RemoteVideo(() => subscriber);
  return { calls, video };
}

describe("RemoteVideo", () => {
  it("pulls what the call screen watches, and nothing in the background", () => {
    const { calls, video } = setup();
    video.noteOffer("cam-video-a");
    video.setWatching(true);
    expect(calls).toEqual(["sub:cam-video-a"]);

    // Backgrounded: unsubscribe first, then close the kept pulls.
    calls.length = 0;
    video.setBackground(true);
    expect(calls).toEqual(["unsub:cam-video-a", "release"]);
    expect(video.isWatching).toBe(false);

    // An offer while backgrounded is not pulled.
    calls.length = 0;
    video.noteOffer("screen-video-a");
    expect(calls).toEqual([]);

    // Back in front with the call screen up: both are pulled.
    video.setBackground(false);
    expect(calls).toEqual(["sub:cam-video-a", "sub:screen-video-a"]);
  });

  it("keeps pulls when the call screen only stops watching", () => {
    const { calls, video } = setup();
    video.noteOffer("cam-video-a");
    video.setWatching(true);
    calls.length = 0;
    video.setWatching(false);
    expect(calls).toEqual(["unsub:cam-video-a"]);
  });

  it("returns to the background state the call screen left", () => {
    const { calls, video } = setup();
    video.noteOffer("cam-video-a");
    video.setBackground(true);
    // The call screen was not up: coming back pulls nothing.
    calls.length = 0;
    video.setBackground(false);
    expect(calls).toEqual([]);
  });

  it("unsubscribes an alias whose publication ended", () => {
    const { calls, video } = setup();
    video.noteOffer("cam-video-a");
    video.setWatching(true);
    calls.length = 0;
    video.forget("cam-video-a");
    video.forget("cam-audio-a");
    expect(calls).toEqual(["unsub:cam-video-a"]);
    // Offered again while watched: subscribed again.
    video.noteOffer("cam-video-a");
    expect(calls).toEqual(["unsub:cam-video-a", "sub:cam-video-a"]);
  });

  it("mirrors each shown camera's flow into the store, and drops it when hidden", () => {
    store.call = { videos: {}, cameraFlows: {} };
    const { video } = setup();
    video.noteOffer("cam-video-a");
    video.setWatching(true);
    const camera = { id: "camera" } as unknown as MediaStreamTrack;
    const share = { id: "share" } as unknown as MediaStreamTrack;
    const info = (trackName: string): TrackInfo => ({
      participant_id: "a",
      track_name: trackName,
      sfu_track_name: `${trackName}-sfu`,
      session_id: "a-session",
      kind: "video",
    });
    video.onTrack("add", camera, info("cam-video-a"));
    video.onTrack("add", share, info("screen-video-a"));

    video.refreshFlows((track) => (track === camera ? "stalled" : "playing"));
    expect(store.call.cameraFlows).toEqual({ a: "stalled" });
    video.refreshFlows(() => undefined);
    expect(store.call.cameraFlows).toEqual({});

    video.refreshFlows(() => "playing");
    video.onTrack("remove", camera, info("cam-video-a"));
    expect(store.call.cameraFlows).toEqual({});
  });

  it("shows a re-pulled camera as waiting from the moment it is added", () => {
    store.call = { videos: {}, cameraFlows: {} };
    const camera = { id: "camera" } as unknown as MediaStreamTrack;
    // The health monitor watched the re-pull's track (and notified) before
    // the track reached RemoteVideo: no flow change follows until a reading.
    const { video } = setup((track) =>
      track === camera ? "waiting" : undefined,
    );
    video.noteOffer("cam-video-a");
    video.setWatching(true);
    video.onTrack("add", camera, {
      participant_id: "a",
      track_name: "cam-video-a",
      sfu_track_name: "cam-video-a-sfu",
      session_id: "a-session",
      kind: "video",
    });
    expect(store.call.cameraFlows).toEqual({ a: "waiting" });
    expect(store.call.videos).toEqual({
      a: { camera: "stream-url", screen: null },
    });
  });
});
