// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/chat/useVideoPlayer", () => ({
  useVideoPlayer: () => ({
    videoRef: { current: null },
    progressRef: { current: null },
    containerRef: { current: null },
    state: {
      playing: false,
      ended: false,
      hasStarted: false,
      currentTime: 0,
      duration: 0,
      progress: 0,
      buffered: 0,
      volume: 1,
      muted: false,
      showControls: true,
      hovering: false,
      dragging: false,
      dragProgress: 0,
      isFullscreen: false,
      splashKey: 0,
      splashIcon: "play" as const,
    },
    dispatch: vi.fn(),
    controlsVisible: true,
    displayProgress: 0,
    displayTime: 0,
    togglePlay: vi.fn(),
    toggleMute: vi.fn(),
    handleVolumeChange: vi.fn(),
    toggleFullscreen: vi.fn(),
    handleSeekClick: vi.fn(),
    handleDragStart: vi.fn(),
    scheduleHide: vi.fn(),
  }),
}));

vi.mock("@/components/chat/GifProviderBranding", () => ({
  GifProviderBranding: () => null,
}));

import VideoAttachment from "../VideoAttachment";

describe("VideoAttachment media lifecycle", () => {
  it("releases an active media pin on pause, ended, and unmount", () => {
    const onPlay = vi.fn();
    const onStop = vi.fn();
    const props = {
      src: "https://cdn.example.com/video.mp4",
      filename: "video.mp4",
      onPlay,
      onStop,
    } as React.ComponentProps<typeof VideoAttachment> & {
      onStop: () => void;
    };
    const { container, unmount } = render(<VideoAttachment {...props} />);
    const video = container.querySelector("video");

    expect(video).not.toBeNull();
    fireEvent.play(video!);
    fireEvent.pause(video!);
    fireEvent.ended(video!);
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);

    fireEvent.play(video!);
    unmount();
    expect(onStop).toHaveBeenCalledTimes(2);
  });

  it("does not release an active pin when the parent replaces callback props", () => {
    const firstStop = vi.fn();
    const { container, rerender } = render(
      <VideoAttachment
        src="https://cdn.example.com/video.mp4"
        filename="video.mp4"
        onStop={firstStop}
      />,
    );
    const video = container.querySelector("video");

    fireEvent.play(video!);
    const nextStop = vi.fn();
    rerender(
      <VideoAttachment
        src="https://cdn.example.com/video.mp4"
        filename="video.mp4"
        onStop={nextStop}
      />,
    );

    expect(firstStop).not.toHaveBeenCalled();
    expect(nextStop).not.toHaveBeenCalled();
    fireEvent.pause(video!);
    expect(nextStop).toHaveBeenCalledTimes(1);
  });
});
