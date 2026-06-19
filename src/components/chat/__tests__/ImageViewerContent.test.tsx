import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useVideoPlaybackAvailabilityMock = vi.fn((_request?: unknown) => "playable");

vi.mock("@/components/chat/VideoAttachment", () => ({
  default: ({
    src,
    poster,
    fallbackToPosterOnError,
    playbackMode,
  }: {
    src: string;
    poster?: string;
    fallbackToPosterOnError?: boolean;
    playbackMode?: string;
  }) =>
    React.createElement("div", {
      "data-testid": "video-attachment",
      "data-src": src,
      "data-poster": poster,
      "data-fallback-poster": String(Boolean(fallbackToPosterOnError)),
      "data-playback-mode": playbackMode,
    }),
}));

vi.mock("@/lib/video-playback-availability", () => ({
  useVideoPlaybackAvailability: (request: unknown) => useVideoPlaybackAvailabilityMock(request),
}));

import { ImageViewerContent } from "@/components/chat/ImageViewerContent";
import type { Attachment } from "@/lib/types";

const baseAttachment: Attachment = {
  id: "att_1",
  filename: "copyright-struck.mp4",
  file_key: "attachments/copyright-struck.mp4",
  content_type: "video/mp4",
  size_bytes: 1234,
  url: "https://cdn.example.com/copyright-struck.mp4",
  thumbnailUrl: "https://cdn.example.com/copyright-struck.jpg",
  sourceUrl: "https://x.com/example/status/1",
};

const baseViewState = {
  scale: 1,
  pan: { x: 0, y: 0 },
  isDragging: false,
  dragStart: { x: 0, y: 0 },
  hideUi: false,
};

describe("ImageViewerContent", () => {
  beforeEach(() => {
    useVideoPlaybackAvailabilityMock.mockReset();
    useVideoPlaybackAvailabilityMock.mockReturnValue("playable");
  });

  it("passes poster fallbacks through to the shared video attachment in viewer mode", () => {
    const markup = renderToStaticMarkup(
      <ImageViewerContent
        currentImage={baseAttachment}
        isVideo
        isLoaded
        viewState={baseViewState}
        imageRef={{ current: null }}
        handleImageClick={() => {}}
        setLocalState={() => {}}
        getUrl={() => "https://media.example.com/video.mp4"}
        getPosterUrl={() => "https://media.example.com/poster.jpg"}
      />
    );

    expect(markup).toContain('data-src="https://media.example.com/video.mp4"');
    expect(markup).toContain('data-poster="https://media.example.com/poster.jpg"');
    expect(markup).toContain('data-fallback-poster="true"');
    expect(markup).toContain('data-playback-mode="default"');
  });

  it("renders the poster directly when playback resolves to poster-only", () => {
    useVideoPlaybackAvailabilityMock.mockReturnValue("poster");

    const markup = renderToStaticMarkup(
      <ImageViewerContent
        currentImage={baseAttachment}
        isVideo
        isLoaded
        viewState={baseViewState}
        imageRef={{ current: null }}
        handleImageClick={() => {}}
        setLocalState={() => {}}
        getUrl={() => "https://media.example.com/video.mp4"}
        getPosterUrl={() => "https://media.example.com/poster.jpg"}
      />
    );

    expect(markup).toContain('src="https://media.example.com/poster.jpg"');
    expect(markup).not.toContain('data-testid="video-attachment"');
  });

  it("keeps animated media in animated playback mode while still passing the poster", () => {
    const markup = renderToStaticMarkup(
      <ImageViewerContent
        currentImage={{ ...baseAttachment, isGif: true }}
        isVideo
        isAnimatedMedia
        isLoaded
        viewState={baseViewState}
        imageRef={{ current: null }}
        handleImageClick={() => {}}
        setLocalState={() => {}}
        getUrl={() => "https://media.example.com/gif.mp4"}
        getPosterUrl={() => "https://media.example.com/gif-poster.jpg"}
      />
    );

    expect(markup).toContain('data-playback-mode="animated"');
    expect(markup).toContain('data-poster="https://media.example.com/gif-poster.jpg"');
  });
});
