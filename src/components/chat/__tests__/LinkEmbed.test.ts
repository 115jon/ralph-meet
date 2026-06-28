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
import { NATIVE_EMOJI_STYLE_VERSION } from "@/lib/emoji";

function render(embed: EmbedInfo): string {
  return renderToStaticMarkup(React.createElement(LinkEmbed, { embed }));
}

describe("LinkEmbed - X mixed media", () => {
  it("uses portrait sizing for vertical YouTube embeds", () => {
    const markup = render({
      id: "embed_youtube_vertical",
      url: "https://youtu.be/oLb96nwOKDg?si=r0EuY4LzKVy4PziG",
      type: "video",
      rawTitle: "The Hunter Became the Hunted #DEADLOCK",
      provider: {
        name: "YouTube",
        url: "https://www.youtube.com",
      },
      thumbnail: {
        url: "https://i.ytimg.com/vi/oLb96nwOKDg/hqdefault.jpg",
        width: 480,
        height: 360,
      },
      video: {
        url: "https://www.youtube.com/embed/oLb96nwOKDg",
        width: 1080,
        height: 1920,
        kind: "player",
      },
      fields: [],
    });

    expect(markup).toContain("width:280px");
    expect(markup).toContain("aspect-ratio:1080/1920");
  });

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
    expect(markup).toContain("/api/proxy-media?url=https%3A%2F%2Fpbs.twimg.com%2Ftweet_video_thumb%2FHKes4LvXkAADDvJ.jpg");
    expect(markup).toContain("Add clip to favorites");
    expect(markup).toContain("/api/proxy-media?url=https%3A%2F%2Fvideo.twimg.com%2Ftweet_video%2FHKes4LvXkAADDvJ.mp4&amp;sourceUrl=https%3A%2F%2Fx.com%2FDieChanc3%2Fstatus%2F2064809045672783978%3Fs%3D20");
    expect(markup).toContain("data-testid=\"video-attachment\"");
  });

  it("uses a full-height two-column grid for two X media items", () => {
    const markup = render({
      id: "embed_2",
      url: "https://x.com/example/status/2",
      type: "rich",
      provider: { name: "X", url: "https://x.com" },
      footer: { text: "X" },
      media: [
        {
          type: "image",
          url: "https://pbs.twimg.com/media/one.jpg",
          width: 1200,
          height: 800,
        },
        {
          type: "image",
          url: "https://pbs.twimg.com/media/two.jpg",
          width: 1200,
          height: 800,
        },
      ],
      fields: [],
    });

    expect(markup).toContain("grid-cols-2 h-[220px] sm:h-[300px]");
    expect(markup).not.toContain("grid-rows-2");
  });

  it("renders gif tiles with autoplay and an inline pause button", () => {
    const markup = render({
      id: "embed_3",
      url: "https://x.com/example/status/3",
      type: "rich",
      provider: { name: "X", url: "https://x.com" },
      footer: { text: "X" },
      media: [
        {
          type: "image",
          url: "https://pbs.twimg.com/media/one.jpg",
          width: 1200,
          height: 800,
        },
        {
          type: "video",
          url: "https://video.twimg.com/tweet_video/example.mp4",
          width: 498,
          height: 270,
          thumbnailUrl: "https://pbs.twimg.com/tweet_video_thumb/example.jpg",
          contentType: "video/mp4",
          isGif: true,
          altText: "Yes Thanos GIF",
        },
      ],
      fields: [],
    });

    expect(markup).toContain("data-x-gif=\"true\"");
    expect(markup).toContain("loop");
    expect(markup).toContain("muted");
    expect(markup).toContain("Pause GIF");
    expect(markup).toContain(">GIF<");
    expect(markup).toContain(">ALT<");
    expect(markup).toContain("Yes Thanos GIF");
  });

  it("hides the gif alt button when no alt text exists", () => {
    const markup = render({
      id: "embed_3b",
      url: "https://x.com/example/status/3b",
      type: "rich",
      provider: { name: "X", url: "https://x.com" },
      footer: { text: "X" },
      media: [
        {
          type: "video",
          url: "https://video.twimg.com/tweet_video/example-2.mp4",
          width: 498,
          height: 270,
          thumbnailUrl: "https://pbs.twimg.com/tweet_video_thumb/example-2.jpg",
          contentType: "video/mp4",
          isGif: true,
        },
      ],
      fields: [],
    });

    expect(markup).not.toContain(">ALT<");
    expect(markup).not.toContain("No alt text provided.");
  });

  it("centers single portrait videos inside their tile container", () => {
    const markup = render({
      id: "embed_4",
      url: "https://x.com/example/status/4",
      type: "rich",
      provider: { name: "X", url: "https://x.com" },
      footer: { text: "X" },
      media: [
        {
          type: "video",
          url: "https://video.twimg.com/ext_tw_video/portrait.mp4",
          width: 720,
          height: 1280,
          thumbnailUrl: "https://pbs.twimg.com/ext_tw_video_thumb/portrait.jpg",
          contentType: "video/mp4",
        },
      ],
      fields: [],
    });

    expect(markup).toContain("items-center justify-center");
    expect(markup).toContain("Add clip to favorites");
    expect(markup).toContain("/api/proxy-media?url=https%3A%2F%2Fvideo.twimg.com%2Fext_tw_video%2Fportrait.mp4&amp;sourceUrl=https%3A%2F%2Fx.com%2Fexample%2Fstatus%2F4");
  });

  it("renders native emoji in X embed text with the shared emoji asset component", () => {
    const markup = render({
      id: "embed_x_emoji",
      url: "https://x.com/example/status/5",
      type: "rich",
      provider: { name: "X", url: "https://x.com" },
      footer: { text: "X" },
      author: {
        name: "Pizza 😂 Dev",
        url: "https://twitter.com/example",
      },
      rawDescription: "Ship it 😂",
      fields: [],
    });

    expect(markup).toContain(`emoji-datasource-twitter@${NATIVE_EMOJI_STYLE_VERSION}`);
    expect(markup).not.toContain("Ship it 😂</div>");
  });

  it("renders native emoji in generic embed titles and descriptions with the shared emoji asset component", () => {
    const markup = render({
      id: "embed_link_emoji",
      url: "https://example.com/post",
      type: "link",
      provider: { name: "Docs 😂", url: "https://example.com" },
      rawTitle: "Launch 😂 Notes",
      rawDescription: "Updated 😂 description",
      fields: [],
    });

    expect(markup).toContain(`emoji-datasource-twitter@${NATIVE_EMOJI_STYLE_VERSION}`);
    expect(markup).not.toContain("Launch 😂 Notes");
  });
});
