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

vi.mock("@/stores/useImageViewerStore", () => ({
  useImageViewerActions: () => ({
    open: vi.fn(),
  }),
}));

vi.mock("@/components/chat/VideoAttachment", () => ({
  default: ({ src, poster }: { src: string; poster?: string }) =>
    React.createElement("div", {
      "data-testid": "video-attachment",
      "data-src": src,
      "data-poster": poster,
    }),
}));

import { LinkEmbed } from "@/components/chat/LinkEmbed";

function render(embed: EmbedInfo): string {
  return renderToStaticMarkup(React.createElement(LinkEmbed, { embed }));
}

describe("LinkEmbed - X mixed media", () => {
  it("renders the X media grid when a tweet has both an image and a video", () => {
    const markup = render({
      id: "embed_1",
      url: "https://x.com/DieChanc3/status/2064809045672783978?s=20",
      type: "rich",
      provider: {
        name: "X",
        url: "https://x.com",
      },
      footer: {
        text: "X",
        iconURL: "https://abs.twimg.com/responsive-web/client-web/icon-default.522d363a.png",
      },
      author: {
        name: "Die Chance (5/5) (@DieChanc3)",
        url: "https://twitter.com/DieChanc3",
        iconURL: "https://pbs.twimg.com/profile_images/example.jpg",
      },
      thumbnail: {
        url: "https://pbs.twimg.com/media/HKesst8XkAAUY06.jpg?name=orig",
        width: 1557,
        height: 836,
      },
      video: {
        url: "https://video.twimg.com/tweet_video/HKes4LvXkAADDvJ.mp4",
        width: 498,
        height: 270,
        kind: "direct",
        contentType: "video/mp4",
      },
      media: [
        {
          type: "image",
          url: "https://pbs.twimg.com/media/HKesst8XkAAUY06.jpg?name=orig",
          width: 1557,
          height: 836,
        },
        {
          type: "video",
          url: "https://video.twimg.com/tweet_video/HKes4LvXkAADDvJ.mp4",
          width: 498,
          height: 270,
          thumbnailUrl: "https://pbs.twimg.com/tweet_video_thumb/HKes4LvXkAADDvJ.jpg",
          contentType: "video/mp4",
        },
      ],
      fields: [],
    });

    expect(markup).toContain("x-image-1");
    expect(markup).toContain("https://pbs.twimg.com/tweet_video_thumb/HKes4LvXkAADDvJ.jpg");
    expect(markup).toContain("X video thumbnail");
    expect(markup).not.toContain("data-testid=\"video-attachment\"");
  });
});
