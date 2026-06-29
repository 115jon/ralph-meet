import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { EmbedInfo } from "@/lib/types";

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
  configurable: true,
});

vi.mock("@/lib/platform", () => ({
  apiUrl: (path: string) => `https://meet.test${path}`,
  getAuthAssetUrl: (pathOrUrl: string) =>
    pathOrUrl.startsWith("/") ? `https://meet.test${pathOrUrl}` : pathOrUrl,
  getMediaUrl: (pathOrUrl: string) =>
    pathOrUrl.startsWith("/") ? `https://meet.test${pathOrUrl}` : pathOrUrl,
}));

vi.mock("@/stores/useImageViewerStore", () => ({
  useImageViewerActions: () => ({
    open: vi.fn(),
  }),
}));

vi.mock("@/components/chat/VideoAttachment", () => ({
  default: ({ src, poster, aspectRatio }: { src: string; poster?: string; aspectRatio?: number }) =>
    React.createElement("div", {
      "data-testid": "video-attachment",
      "data-src": src,
      "data-poster": poster,
      ...(aspectRatio ? { "data-aspect-ratio": aspectRatio } : {}),
    }),
}));

import { LinkEmbed } from "@/components/chat/LinkEmbed";

function render(embed: EmbedInfo): string {
  return renderToStaticMarkup(React.createElement(LinkEmbed, { embed }));
}

describe("LinkEmbed Instagram preview URLs", () => {
  it("uses a fully qualified proxy URL for Instagram preview images in desktop contexts", () => {
    const markup = render({
      id: "embed_instagram_desktop_preview",
      url: "https://www.instagram.com/reel/DXU4PV2AGJU/",
      type: "rich",
      provider: {
        name: "Instagram",
        url: "https://www.instagram.com",
      },
      thumbnail: {
        url: "https://scontent-ord5-1.cdninstagram.com/thumb.jpg",
        width: 640,
        height: 1137,
      },
      footer: {
        text: "Instagram",
      },
      fields: [],
    });

    expect(markup).toContain("https://meet.test/api/proxy-media?url=https%3A%2F%2Fscontent-ord5-1.cdninstagram.com%2Fthumb.jpg");
  });
});
