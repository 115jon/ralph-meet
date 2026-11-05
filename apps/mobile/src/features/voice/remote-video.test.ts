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
vi.mock("./store", () => ({ updateCall: vi.fn() }));

import { RemoteVideo, type VideoSubscriber } from "./remote-video";

function setup() {
  const calls: string[] = [];
  const subscriber: VideoSubscriber = {
    setRemoteTrackSubscription: (trackName, subscribe) =>
      calls.push(`${subscribe ? "sub" : "unsub"}:${trackName}`),
    releaseUnwatchedVideo: () => calls.push("release"),
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
});
