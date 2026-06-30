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
  default: ({
    src,
    poster,
    aspectRatio,
    fallbackToPosterOnError,
    mediaClassName,
    showDurationBadge,
    durationBadgeSeconds,
  }: {
    src: string;
    poster?: string;
    aspectRatio?: number;
    fallbackToPosterOnError?: boolean;
    mediaClassName?: string;
    showDurationBadge?: boolean;
    durationBadgeSeconds?: number;
  }) =>
    React.createElement(
      "div",
      {
        "data-testid": "video-attachment",
        "data-src": src,
        "data-poster": poster,
        "data-fallback-poster": String(Boolean(fallbackToPosterOnError)),
        ...(aspectRatio ? { "data-aspect-ratio": aspectRatio } : {}),
        ...(mediaClassName ? { "data-media-class": mediaClassName } : {}),
      },
      showDurationBadge && durationBadgeSeconds
        ? React.createElement("span", {}, `${Math.floor(durationBadgeSeconds / 60)}:${Math.floor(durationBadgeSeconds % 60).toString().padStart(2, "0")}`)
        : null
    ),
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
          durationSeconds: 8.4,
        },
      ],
      fields: [],
    });

    expect(markup).toContain("x-image-1");
    expect(markup).toContain("/api/proxy-media?url=https%3A%2F%2Fpbs.twimg.com%2Ftweet_video_thumb%2FHKes4LvXkAADDvJ.jpg");
    expect(markup).toContain("Add clip to favorites");
    expect(markup).toContain("/api/proxy-media?url=https%3A%2F%2Fvideo.twimg.com%2Ftweet_video%2FHKes4LvXkAADDvJ.mp4&amp;sourceUrl=https%3A%2F%2Fx.com%2FDieChanc3%2Fstatus%2F2064809045672783978%3Fs%3D20");
    expect(markup).toContain("data-testid=\"video-attachment\"");
    expect(markup).toContain("data-fallback-poster=\"true\"");
    expect(markup).toContain(">0:08<");
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

  it("renders low-key X metrics when counts are available", () => {
    const markup = render({
      id: "embed_metrics",
      url: "https://x.com/example/status/metrics",
      type: "rich",
      provider: { name: "X", url: "https://x.com" },
      footer: { text: "X" },
      author: {
        name: "Example Author (@example)",
        url: "https://twitter.com/example",
      },
      rawDescription: "Metrics post",
      metrics: {
        replies: 30,
        retweets: 1800,
        likes: 34_000,
        impressions: 380_000,
      },
      fields: [],
    });

    expect(markup).toContain("Replies: 30");
    expect(markup).toContain(">1.8K<");
    expect(markup).toContain(">34K<");
    expect(markup).toContain(">380K<");
  });

  it("hides zero-valued X counts while keeping the metric affordances", () => {
    const markup = render({
      id: "embed_metrics_zero",
      url: "https://x.com/example/status/metrics-zero",
      type: "rich",
      provider: { name: "X", url: "https://x.com" },
      footer: { text: "X" },
      author: {
        name: "Example Author (@example)",
        url: "https://twitter.com/example",
      },
      rawDescription: "Metrics post",
      metrics: {
        replies: 0,
        retweets: 0,
        likes: 133,
        impressions: 1600,
      },
      fields: [],
    });

    expect(markup).toContain("Replies: 0");
    expect(markup).toContain("Reposts: 0");
    expect(markup).not.toContain(">0<");
    expect(markup).toContain(">133<");
    expect(markup).toContain(">1.6K<");
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

  it("left aligns single portrait videos inside their tile container", () => {
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
          durationSeconds: 19,
        },
      ],
      fields: [],
    });

    expect(markup).toContain("w-full max-w-full justify-start");
    expect(markup).toContain("block w-fit max-w-full rounded-[20px]");
    expect(markup).not.toContain("bg-black/30");
    expect(markup).toContain("Add clip to favorites");
    expect(markup).toContain("/api/proxy-media?url=https%3A%2F%2Fvideo.twimg.com%2Fext_tw_video%2Fportrait.mp4&amp;sourceUrl=https%3A%2F%2Fx.com%2Fexample%2Fstatus%2F4");
    expect(markup).toContain("data-aspect-ratio=\"0.5625\"");
    expect(markup).toContain("data-media-class=\"object-left\"");
    expect(markup).toContain(">0:19<");
  });

  it("keeps standalone single tweet images left aligned inside a full rounded frame", () => {
    const markup = render({
      id: "embed_single_image_frame",
      url: "https://x.com/example/status/single-image",
      type: "rich",
      provider: { name: "X", url: "https://x.com" },
      footer: { text: "X" },
      media: [
        {
          type: "image",
          url: "https://pbs.twimg.com/media/portrait-image.png",
          width: 546,
          height: 674,
        },
      ],
      fields: [],
    });

    expect(markup).toContain("h-auto max-h-[420px] w-auto max-w-full object-contain object-left");
    expect(markup).toContain("block w-fit max-w-full rounded-[20px] border border-rm-border/45 bg-rm-bg-surface/30");
  });

  it("renders X external card chips over standalone media with a low-key source line", () => {
    const markup = render({
      id: "embed_external_card",
      url: "https://x.com/example/status/external-card",
      type: "rich",
      provider: { name: "X", url: "https://x.com" },
      footer: { text: "X" },
      rawDescription: "Cupcake has been hanging around with Rem lately.",
      media: [
        {
          type: "image",
          url: "https://pbs.twimg.com/media/cupcake-card.jpg",
          width: 1600,
          height: 900,
        },
      ],
      externalCard: {
        url: "https://gamebanana.com/mods/689999",
        title: "MLC soul bag Mod for Deadlock | DL Mods",
        domain: "gamebanana.com",
      },
      fields: [],
    });

    expect(markup).toContain("MLC soul bag Mod for Deadlock | DL Mods");
    expect(markup).toContain("pointer-events-none absolute inset-x-0 bottom-0 z-20");
    expect(markup).toContain("From ");
    expect(markup).toContain(">gamebanana.com<");
  });

  it("keeps single quoted tweet media in a smaller compact card", () => {
    const markup = render({
      id: "embed_quote_compact",
      url: "https://x.com/example/status/quote",
      type: "rich",
      provider: { name: "X", url: "https://x.com" },
      footer: { text: "X" },
      author: {
        name: "Quoted Poster (@quotedposter)",
        url: "https://twitter.com/quotedposter",
      },
      rawDescription: "main post",
      media: [{
        type: "image",
        url: "https://pbs.twimg.com/media/main-media.jpg",
        width: 1200,
        height: 800,
      }],
      referencedTweet: {
        type: "quoted",
        url: "https://x.com/original/status/1",
        rawDescription: "quoted post",
        author: {
          name: "Original Author (@original)",
          url: "https://twitter.com/original",
        },
        media: [{
          type: "image",
          url: "https://pbs.twimg.com/media/quoted-portrait.jpg",
          width: 900,
          height: 1600,
        }],
      },
      fields: [],
    });

    expect(markup).toContain("max-w-[240px]");
    expect(markup).toContain("h-[180px]");
    expect(markup).toContain("object-center");
    expect(markup).toContain("mx-auto");
    expect(markup).not.toContain("max-w-[240px] rounded-[18px] border border-rm-border/45");
    expect(markup).not.toContain("rounded-[18px]");
    expect(markup).toContain("Open quoted post on X");
  });

  it("lets quoted tweet media render larger when it is the only media in the embed", () => {
    const markup = render({
      id: "embed_quote_expanded",
      url: "https://x.com/example/status/quote-large",
      type: "rich",
      provider: { name: "X", url: "https://x.com" },
      footer: { text: "X" },
      author: {
        name: "Quoted Poster (@quotedposter)",
        url: "https://twitter.com/quotedposter",
      },
      rawDescription: "main post",
      referencedTweet: {
        type: "quoted",
        url: "https://x.com/original/status/large-1",
        rawDescription: "soon",
        author: {
          name: "Original Author (@original)",
          url: "https://twitter.com/original",
        },
        media: [{
          type: "image",
          url: "https://pbs.twimg.com/media/quoted-portrait-large.jpg",
          width: 546,
          height: 674,
        }],
      },
      fields: [],
    });

    expect(markup).not.toContain("max-w-[240px]");
    expect(markup).not.toContain("h-[180px]");
    expect(markup).toContain("h-auto max-h-[420px] w-auto max-w-full object-contain object-center");
    expect(markup).toContain("mx-auto");
    expect(markup).toContain("block w-fit max-w-full");
    expect(markup).not.toContain("rounded-[20px]");
    expect(markup).not.toContain("block w-fit max-w-full rounded-[20px] border border-rm-border/45 bg-rm-bg-surface/30");
  });

  it("collapses oversized referenced tweet text behind an expandable affordance", () => {
    const markup = render({
      id: "embed_quote_long_text",
      url: "https://x.com/example/status/quote-long-text",
      type: "rich",
      provider: { name: "X", url: "https://x.com" },
      footer: { text: "X" },
      rawDescription: "main post",
      referencedTweet: {
        type: "quoted",
        url: "https://x.com/original/status/quote-long",
        rawDescription: [
          "giving away a FREE MiniMax API key worth BILLIONS (330M+ tokens daily, No Rate Limits) 😳",
          "",
          "All MiniMax models included-",
          "text to video",
          "image generation",
          "music generation",
        ].join("\n"),
        author: {
          name: "Original Author (@original)",
          url: "https://twitter.com/original",
        },
      },
      fields: [],
    });

    expect(markup).toContain("aria-label=\"Expand quoted post text\"");
    expect(markup).toContain("aria-expanded=\"false\"");
    expect(markup).toContain("line-clamp-4");
    expect(markup).toContain(">...<");
  });

  it("uses a show more button for oversized standalone tweet text", () => {
    const markup = render({
      id: "embed_standalone_long_text",
      url: "https://x.com/example/status/standalone-long-text",
      type: "rich",
      provider: { name: "X", url: "https://x.com" },
      footer: { text: "X" },
      author: {
        name: "Example Author (@example)",
        url: "https://twitter.com/example",
      },
      rawDescription: [
        "PVE // JUNGLE // MISSION",
        "",
        "VOSHIL SEES THE F/BAR",
        "PVE JUNGLE MISSION",
        "TOMORROW THE WALLS",
        "AND THE SIGNAL KEEPS GOING",
      ].join("\n"),
      fields: [],
    });

    expect(markup).toContain("aria-label=\"Expand post text\"");
    expect(markup).toContain(">Show more<");
    expect(markup).not.toContain(">...<");
  });

  it("does not render a standalone show more button for shorter tweet text", () => {
    const markup = render({
      id: "embed_standalone_short_text",
      url: "https://x.com/example/status/standalone-short-text",
      type: "rich",
      provider: { name: "X", url: "https://x.com" },
      footer: { text: "X" },
      author: {
        name: "Example Author (@example)",
        url: "https://twitter.com/example",
      },
      rawDescription: "short standalone post",
      fields: [],
    });

    expect(markup).not.toContain("aria-label=\"Expand post text\"");
    expect(markup).not.toContain(">Show more<");
  });

  it("uses compact X header time and restores the X footer timestamp row", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T05:00:00-05:00"));

    try {
      const markup = render({
        id: "embed_x_timestamp_footer",
        url: "https://x.com/example/status/timestamp-footer",
        type: "rich",
        provider: { name: "X", url: "https://x.com" },
        footer: { text: "X" },
        author: {
          name: "Example Author (@example)",
          url: "https://twitter.com/example",
        },
        rawDescription: "Timestamp post",
        timestamp: "2026-06-29T08:00:00-05:00",
        fields: [],
      });

      expect(markup).toContain("· 21h");
      expect(markup).toContain(">X<");
      expect(markup).toContain("2026");
      expect(markup).not.toContain("Yesterday at");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders duration badges for quoted tweet videos too", () => {
    const markup = render({
      id: "embed_quote_video_duration",
      url: "https://x.com/example/status/quote-video",
      type: "rich",
      provider: { name: "X", url: "https://x.com" },
      footer: { text: "X" },
      rawDescription: "main post",
      referencedTweet: {
        type: "quoted",
        url: "https://x.com/original/status/2",
        rawDescription: "quoted video",
        author: {
          name: "Original Author (@original)",
          url: "https://twitter.com/original",
        },
        media: [{
          type: "video",
          url: "https://video.twimg.com/ext_tw_video/quoted.mp4",
          width: 720,
          height: 1280,
          thumbnailUrl: "https://pbs.twimg.com/ext_tw_video_thumb/quoted.jpg",
          contentType: "video/mp4",
          durationSeconds: 3,
        }],
      },
      fields: [],
    });

    expect(markup).toContain(">0:03<");
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

  it("renders Instagram thumbnails through the media proxy", () => {
    const markup = render({
      id: "embed_instagram_reel",
      url: "https://www.instagram.com/reel/DXU4PV2AGJU/",
      type: "rich",
      rawTitle: "craziest work",
      author: {
        name: "chardanceswag",
        url: "https://www.instagram.com/chardanceswag",
      },
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

    expect(markup).toContain("/api/proxy-media?url=https%3A%2F%2Fscontent-ord5-1.cdninstagram.com%2Fthumb.jpg&amp;sourceUrl=https%3A%2F%2Fwww.instagram.com%2Freel%2FDXU4PV2AGJU%2F");
    expect(markup).toContain("Open in Instagram");
    expect(markup).toContain("Instagram");
    expect(markup).toContain("VsNE-OHk_8a.png");
    expect(markup).not.toContain("craziest work");
    expect(markup).not.toContain("instagram.com/reel/DXU4PV2AGJU/embed/captioned");
  });

  it("keeps Instagram preview sizing aligned with the media aspect ratio before playback", () => {
    const markup = render({
      id: "embed_instagram_landscape",
      url: "https://www.instagram.com/reel/LANDSCAPE123/",
      type: "rich",
      provider: {
        name: "Instagram",
        url: "https://www.instagram.com",
      },
      thumbnail: {
        url: "https://scontent-ord5-1.cdninstagram.com/landscape.jpg",
        width: 1280,
        height: 720,
      },
      footer: {
        text: "Instagram",
      },
      fields: [],
    });

    expect(markup).toContain("aspect-ratio:1280/720");
    expect(markup).not.toContain("height:540px");
  });
});
