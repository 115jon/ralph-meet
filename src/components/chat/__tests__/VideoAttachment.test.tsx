import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

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

import VideoAttachment from "@/components/chat/VideoAttachment";

function render(
  props: Partial<React.ComponentProps<typeof VideoAttachment>> = {},
): string {
  return renderToStaticMarkup(
    <VideoAttachment
      src="https://meet.test/api/proxy-media?url=https%3A%2F%2Fvideo.twimg.com%2Fext_tw_video%2Fsample.mp4"
      filename="sample.mp4"
      poster="https://meet.test/api/proxy-media?url=https%3A%2F%2Fpbs.twimg.com%2Fext_tw_video_thumb%2Fsample.jpg"
      {...props}
    />,
  );
}

describe("VideoAttachment", () => {
  it("defers preload for poster-backed proxied embedded videos", () => {
    expect(render()).toContain('preload="none"');
  });

  it("keeps metadata preload in viewer mode", () => {
    expect(render({ variant: "viewer" })).toContain('preload="metadata"');
  });

  it("keeps metadata preload for non-proxied videos", () => {
    expect(
      render({
        src: "https://cdn.example.com/video.mp4",
        poster: "https://cdn.example.com/poster.jpg",
      }),
    ).toContain('preload="metadata"');
  });

  it("keeps poster overlays contained inside explicit video boxes", () => {
    const markup = render({
      aspectRatio: 9 / 16,
      maxWidth: 360,
      maxHeight: 640,
    });

    expect(markup).toContain("object-contain");
    expect(markup).not.toContain("object-cover");
  });
});
