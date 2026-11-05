// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { CAMERA_CONNECT_GRACE_MS, type VideoFlow } from "@ralph/voice-media";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ParticipantCard,
  type ParticipantCardProps,
} from "@/components/voice/ParticipantCard";
import type { GridItem, VoiceActions } from "@/components/voice/types";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/components/voice/VideoPlayer", () => ({
  VideoPlayer: () => <div data-testid="video-player" />,
}));

/** The SFU client's video flow, as a tile reads it. */
class FakeFlowSource {
  readonly flows = new Map<MediaStreamTrack, VideoFlow>();
  private readonly listeners = new Set<() => void>();

  getRemoteVideoFlow(track: MediaStreamTrack): VideoFlow | undefined {
    return this.flows.get(track);
  }

  subscribeRemoteVideoFlow(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // The overlay's app events.
  on() {
    return () => {};
  }

  set(track: MediaStreamTrack, flow: VideoFlow): void {
    this.flows.set(track, flow);
    for (const listener of [...this.listeners]) listener();
  }
}

function videoTrack(): MediaStreamTrack {
  return {
    kind: "video",
    readyState: "live",
    id: "remote-camera",
    getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }),
  } as unknown as MediaStreamTrack;
}

function stream(track: MediaStreamTrack | null): MediaStream {
  const tracks = track ? [track] : [];
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks,
    getAudioTracks: () => [],
  } as unknown as MediaStream;
}

function camera(overrides: Partial<GridItem> = {}): GridItem {
  return {
    id: "remote-camera-u-ada",
    userId: "u-ada",
    name: "Ada Lovelace",
    avatar: null,
    stream: null,
    isLocal: false,
    type: "camera",
    isStreaming: false,
    isMuted: false,
    isDeafened: false,
    ...overrides,
  };
}

function renderCard(item: GridItem, sfu: FakeFlowSource) {
  const props: ParticipantCardProps = {
    item,
    isFocused: false,
    isTray: false,
    globalDeafened: false,
    onClick: () => {},
    watchedStreams: {},
    streamThumbnails: {},
    voiceActions: { sfu } as unknown as VoiceActions,
  };
  return render(
    <TooltipProvider>
      <ParticipantCard {...props} />
    </TooltipProvider>,
  );
}

/** The wrapper of the (mocked) video element: hidden while not playing. */
function videoLayer(container: HTMLElement) {
  return container.querySelector('[data-testid="video-player"]')?.parentElement;
}

describe("ParticipantCard remote camera video", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows a playing camera, and its avatar with the state once it stalls", () => {
    const sfu = new FakeFlowSource();
    const track = videoTrack();
    sfu.flows.set(track, "playing");
    const { container, queryByText } = renderCard(
      camera({ stream: stream(track) }),
      sfu,
    );
    expect(videoLayer(container)?.className).not.toContain("opacity-0");
    expect(queryByText("Video unavailable")).toBeNull();

    // Stalled after its one fresh re-pull: the avatar and the state, with
    // the video kept mounted (it is measured on screen).
    act(() => sfu.set(track, "stalled"));
    expect(queryByText("Video unavailable")).not.toBeNull();
    // No resolution readout for video that is not showing.
    expect(queryByText(/FPS/)).toBeNull();
    expect(container.querySelector('[role="img"]')?.textContent).toBe("A");
    expect(videoLayer(container)?.className).toContain("opacity-0");

    // Frames came back.
    act(() => sfu.set(track, "playing"));
    expect(queryByText("Video unavailable")).toBeNull();
    expect(videoLayer(container)?.className).not.toContain("opacity-0");
  });

  it("shows the loading state while the first frame is on the way", () => {
    const sfu = new FakeFlowSource();
    const track = videoTrack();
    sfu.flows.set(track, "waiting");
    const { container, queryByText } = renderCard(
      camera({ stream: stream(track) }),
      sfu,
    );
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Loading stream",
    );
    expect(videoLayer(container)?.className).toContain("opacity-0");
    expect(queryByText("Video unavailable")).toBeNull();
  });

  it("says the video is unavailable when an announced camera never arrives", () => {
    const sfu = new FakeFlowSource();
    const { queryByText } = renderCard(camera({ stream: stream(null) }), sfu);
    expect(queryByText("Video unavailable")).toBeNull();
    act(() => vi.advanceTimersByTime(CAMERA_CONNECT_GRACE_MS - 1));
    expect(queryByText("Video unavailable")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(queryByText("Video unavailable")).not.toBeNull();
  });

  it("leaves your own camera and an unmeasured one as they were", () => {
    const sfu = new FakeFlowSource();
    const track = videoTrack();
    const own = renderCard(
      camera({ isLocal: true, stream: stream(track) }),
      sfu,
    );
    expect(videoLayer(own.container)?.className).not.toContain("opacity-0");
    cleanup();
    // No flow reported (stats unreadable, or a fixture without an SFU).
    const unmeasured = renderCard(camera({ stream: stream(track) }), sfu);
    expect(videoLayer(unmeasured.container)?.className).not.toContain(
      "opacity-0",
    );
    act(() => vi.advanceTimersByTime(60_000));
    expect(unmeasured.queryByText("Video unavailable")).toBeNull();
  });
});
