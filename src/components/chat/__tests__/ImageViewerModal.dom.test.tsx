// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
  configurable: true,
});

vi.mock("@/hooks/useBackButton", () => ({
  useBackButton: () => {},
}));

vi.mock("@/components/chat/ImageViewerToolbar", () => ({
  ImageViewerToolbar: () => null,
}));

vi.mock("@/components/chat/ImageViewerThumbnails", () => ({
  ImageViewerThumbnails: () => null,
}));

vi.mock("@/components/chat/ImageViewerNavigation", () => ({
  ImageViewerNavigation: () => null,
}));

vi.mock("@/lib/video-playback-availability", () => ({
  useVideoPlaybackAvailability: () => "playable",
  primeVideoPlaybackAvailability: vi.fn(() => Promise.resolve()),
}));

import { ImageViewerModal } from "@/components/chat/ImageViewerModal";
import { useImageViewerStore } from "@/stores/useImageViewerStore";
import type { Attachment } from "@/lib/types";

const viewerImages: Attachment[] = [
  {
    id: "img-1",
    filename: "one.jpg",
    file_key: "attachments/one.jpg",
    content_type: "image/jpeg",
    size_bytes: 100,
    url: "https://cdn.example.com/one.jpg",
  },
  {
    id: "img-2",
    filename: "two.jpg",
    file_key: "attachments/two.jpg",
    content_type: "image/jpeg",
    size_bytes: 200,
    url: "https://cdn.example.com/two.jpg",
  },
];

describe("ImageViewerModal drag navigation", () => {
  const actions = useImageViewerStore.getState().actions;

  beforeEach(() => {
    useImageViewerStore.setState({
      isOpen: true,
      initialIndex: 0,
      images: viewerImages,
      context: undefined,
      actions,
    });
  });

  afterEach(() => {
    useImageViewerStore.setState({
      isOpen: false,
      initialIndex: 0,
      images: [],
      context: undefined,
      actions,
    });
    vi.restoreAllMocks();
  });

  it("advances to the next image on a touch swipe", () => {
    render(<ImageViewerModal />);

    const stage = screen.getByTestId("image-viewer-stage");
    Object.defineProperty(stage, "clientWidth", {
      configurable: true,
      value: 320,
    });

    expect(screen.getByTestId("image-viewer-image")).toHaveAttribute(
      "src",
      "https://cdn.example.com/one.jpg",
    );

    fireEvent.touchStart(stage, { touches: [{ clientX: 260, clientY: 120 }] });
    fireEvent.touchMove(stage, { touches: [{ clientX: 120, clientY: 126 }] });
    fireEvent.touchEnd(stage, {
      changedTouches: [{ clientX: 120, clientY: 126 }],
    });

    expect(screen.getByTestId("image-viewer-image")).toHaveAttribute(
      "src",
      "https://cdn.example.com/two.jpg",
    );
  });

  it("advances to the next image on a mouse drag", () => {
    render(<ImageViewerModal />);

    const stage = screen.getByTestId("image-viewer-stage");
    Object.defineProperty(stage, "clientWidth", {
      configurable: true,
      value: 320,
    });

    expect(screen.getByTestId("image-viewer-image")).toHaveAttribute(
      "src",
      "https://cdn.example.com/one.jpg",
    );

    fireEvent.mouseDown(stage, { button: 0, clientX: 260, clientY: 120 });
    fireEvent.mouseMove(stage, { clientX: 120, clientY: 122 });
    fireEvent.mouseUp(stage, { clientX: 120, clientY: 122 });

    expect(screen.getByTestId("image-viewer-image")).toHaveAttribute(
      "src",
      "https://cdn.example.com/two.jpg",
    );
  });
});
