// @vitest-environment jsdom

import { act, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EmbedInfo } from "@/lib/types";

const { openImageViewerMock } = vi.hoisted(() => ({
  openImageViewerMock: vi.fn(),
}));

vi.mock("@/stores/useImageViewerStore", () => ({
  useImageViewerActions: () => ({
    open: openImageViewerMock,
  }),
}));

import { LinkEmbed } from "../LinkEmbed";

function makeQuotedEmbed(rawDescription: string): EmbedInfo {
  return {
    id: "embed_quote_long_text_dom",
    url: "https://x.com/example/status/quote-long-text-dom",
    type: "rich",
    provider: { name: "X", url: "https://x.com" },
    footer: { text: "X" },
    rawDescription: "main post",
    referencedTweet: {
      type: "quoted",
      url: "https://x.com/original/status/quote-long-dom",
      rawDescription,
      author: {
        name: "Original Author (@original)",
        url: "https://twitter.com/original",
      },
    },
    fields: [],
  };
}

function makeStandaloneEmbed(rawDescription: string): EmbedInfo {
  return {
    id: "embed_standalone_long_text_dom",
    url: "https://x.com/example/status/standalone-long-text-dom",
    type: "rich",
    provider: { name: "X", url: "https://x.com" },
    footer: { text: "X" },
    author: {
      name: "Example Author (@example)",
      url: "https://twitter.com/example",
    },
    rawDescription,
    fields: [],
  };
}

function makeInstagramCarouselEmbed(overrides: Partial<EmbedInfo> = {}): EmbedInfo {
  return {
    id: "embed_instagram_carousel_dom",
    url: "https://www.instagram.com/p/DZ9DK2RgNSk/",
    type: "rich",
    provider: { name: "Instagram", url: "https://www.instagram.com" },
    author: {
      name: "tasiyu",
      url: "https://www.instagram.com/tasiyu/",
      iconURL: "https://scontent-ord5-1.cdninstagram.com/avatar.jpg",
      isVerified: true,
    },
    rawDescription: "rukia!",
    thumbnail: {
      url: "https://scontent-ord5-1.cdninstagram.com/cover.jpg",
      width: 1080,
      height: 1350,
    },
    timestamp: "2026-06-25T18:30:00.000Z",
    metrics: {
      likes: 689,
      comments: 11,
    },
    media: [
      {
        type: "image",
        url: "https://scontent-ord5-1.cdninstagram.com/photo-1.jpg?stp=dst-jpg",
        width: 1080,
        height: 1350,
        altText: "Slide one",
      },
      {
        type: "image",
        url: "https://scontent-ord5-1.cdninstagram.com/photo-2.jpg?stp=dst-jpg",
        width: 1080,
        height: 1350,
        altText: "Slide two",
      },
    ],
    fields: [],
    ...overrides,
  };
}

function makeTikTokSlideshowEmbed(overrides: Partial<EmbedInfo> = {}): EmbedInfo {
  return {
    id: "embed_tiktok_slideshow_dom",
    url: "https://www.tiktok.com/t/ZTSBAR6M7/",
    type: "rich",
    provider: { name: "TikTok", url: "https://www.tiktok.com" },
    author: {
      name: "natalia",
      url: "https://www.tiktok.com/@feetlattee",
    },
    thumbnail: {
      url: "https://p16-common-sign.tiktokcdn-us.com/example/cover.webp",
      width: 576,
      height: 1024,
    },
    footer: {
      text: "TikTok",
    },
    fields: [],
    ...overrides,
  };
}

describe("LinkEmbed DOM rendering", () => {
  afterEach(() => {
    openImageViewerMock.mockReset();
    vi.restoreAllMocks();
  });

  it("expands oversized standalone tweet text with a show more button", () => {
    render(
      <LinkEmbed
        embed={makeStandaloneEmbed([
          "PVE // JUNGLE // MISSION",
          "",
          "VOSHIL SEES THE F/BAR",
          "PVE JUNGLE MISSION",
          "TOMORROW THE WALLS",
          "AND THE SIGNAL KEEPS GOING",
        ].join("\n"))}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Expand post text" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("Show more");

    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Collapse post text" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Show less")).toBeInTheDocument();
  });

  it("does not render the standalone show more button for shorter tweet text", () => {
    render(
      <LinkEmbed
        embed={makeStandaloneEmbed("short standalone post")}
      />,
    );

    expect(screen.queryByRole("button", { name: "Expand post text" })).not.toBeInTheDocument();
  });

  it("expands oversized referenced tweet text on demand", () => {
    render(
      <LinkEmbed
        embed={makeQuotedEmbed([
          "giving away a FREE MiniMax API key worth BILLIONS (330M+ tokens daily, No Rate Limits) 😳",
          "",
          "All MiniMax models included-",
          "text to video",
          "image generation",
          "music generation",
        ].join("\n"))}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Expand quoted post text" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Collapse quoted post text" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Show less")).toBeInTheDocument();
  });

  it("does not render the expand affordance for shorter referenced tweet text", () => {
    render(
      <LinkEmbed
        embed={makeQuotedEmbed("short quoted post")}
      />,
    );

    expect(screen.queryByRole("button", { name: "Expand quoted post text" })).not.toBeInTheDocument();
  });

  it("hides the quoted tweet ellipsis affordance when the measured text does not actually overflow", async () => {
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function(this: HTMLElement) {
      return this.dataset.xExpandableText === "true" ? 96 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function(this: HTMLElement) {
      return this.dataset.xExpandableText === "true" ? 96 : 0;
    });

    render(
      <LinkEmbed
        embed={makeQuotedEmbed("A".repeat(260))}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Expand quoted post text" })).not.toBeInTheDocument();
    });
  });

  it("advances Instagram carousels with the next button", () => {
    const { container } = render(
      <LinkEmbed embed={makeInstagramCarouselEmbed()} />,
    );

    const track = container.querySelector('[data-testid="instagram-carousel-track"]') as HTMLDivElement | null;
    expect(track).not.toBeNull();
    expect(track?.style.transform).toBe("translate3d(calc(0% + 0px), 0, 0)");

    fireEvent.click(screen.getByRole("button", { name: "Next media" }));

    expect(track?.style.transform).toBe("translate3d(calc(-50% + 0px), 0, 0)");
  });

  it("opens Instagram images in the shared viewer and keeps carousel state synced", () => {
    const { container } = render(
      <LinkEmbed
        embed={makeInstagramCarouselEmbed()}
        messageId="message-123"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open media 1 of 2" }));

    expect(openImageViewerMock).toHaveBeenCalledTimes(1);
    const [attachments, initialIndex, context] = openImageViewerMock.mock.calls[0];
    expect(initialIndex).toBe(0);
    expect(attachments).toHaveLength(2);
    expect(attachments[0]?.url).toContain("/api/proxy-media?url=");
    expect(context).toMatchObject({
      username: "tasiyu",
      created_at: "2026-06-25T18:30:00.000Z",
    });
    expect(context?.avatar_url).toContain("/api/proxy-media?url=");
    expect(typeof context?.onIndexChange).toBe("function");

    act(() => {
      context.onIndexChange(1);
    });

    const track = container.querySelector('[data-testid="instagram-carousel-track"]') as HTMLDivElement | null;
    expect(track?.style.transform).toBe("translate3d(calc(-50% + 0px), 0, 0)");
  });

  it("prevents native drag on Instagram images so clicks can open the viewer", () => {
    render(
      <LinkEmbed embed={makeInstagramCarouselEmbed()} />,
    );

    const image = screen.getByAltText("Slide one");
    expect(image).toHaveAttribute("draggable", "false");

    const dragStart = createEvent.dragStart(image);
    fireEvent(image, dragStart);

    expect(dragStart.defaultPrevented).toBe(true);
  });

  it("toggles Instagram audio playback from the artwork button", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function(this: HTMLMediaElement) {
      Object.defineProperty(this, "paused", { configurable: true, value: false });
      return Promise.resolve();
    });
    const pauseMock = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function(this: HTMLMediaElement) {
      Object.defineProperty(this, "paused", { configurable: true, value: true });
    });

    render(
      <LinkEmbed
        embed={makeInstagramCarouselEmbed({
          audio: {
            title: "Blue Hour",
            artist: "Example Artist",
            url: "https://scontent-ord5-1.cdninstagram.com/audio/track.m4a?ccb=7-5",
            artworkUrl: "https://scontent-ord5-1.cdninstagram.com/audio-art.jpg?ccb=7-5",
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Play audio preview" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause audio preview" })).toBeInTheDocument();
    });

    pauseMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Pause audio preview" }));

    expect(pauseMock).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Play audio preview" })).toBeInTheDocument();
  });

  it("renders TikTok slideshow branding in the footer without the extra badge", async () => {
    vi.stubGlobal("IntersectionObserver", class {
      private readonly callback: IntersectionObserverCallback;

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }

      observe = () => {
        this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      };

      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = "";
      thresholds = [];
    } as unknown as typeof IntersectionObserver);

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (!url.includes("/api/tiktok-video?videoUrl=")) {
        return new Response("not found", { status: 404 });
      }

      return Response.json({
        canonicalUrl: "https://www.tiktok.com/@feetlattee/photo/7649484991986027806",
        postType: "slideshow",
        coverUrl: "https://p16-common-sign.tiktokcdn-us.com/example/cover.webp",
        title: "summer dump",
        authorName: "natalia",
        authorHandle: "feetlattee",
        authorAvatarUrl: "https://p19-common-sign.tiktokcdn-us.com/example/avatar.jpeg",
        media: [
          {
            type: "image",
            url: "https://p19-common-sign.tiktokcdn-us.com/example/photo-1.jpeg",
          },
          {
            type: "image",
            url: "https://p16-common-sign.tiktokcdn-us.com/example/photo-2.jpeg",
          },
        ],
        audio: {
          title: "original sound - realtonyay",
          artist: "Tonya",
          url: "https://v16-ies-music.tiktokcdn-us.com/example/audio-track/?mime_type=audio_mpeg",
          artworkUrl: "https://p19-common-sign.tiktokcdn-us.com/example/music-cover.jpeg",
        },
        likeCount: 2311,
        commentCount: 19,
        viewCount: 12416,
        timestamp: "2026-06-08T17:48:57.000Z",
      });
    }) as unknown as typeof fetch);

    const { container } = render(
      <LinkEmbed embed={makeTikTokSlideshowEmbed()} />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-testid="tiktok-carousel-track"]')).not.toBeNull();
    });

    const footerIcon = container.querySelector(`img[src="${"https://www.tiktok.com/favicon.ico"}"]`);
    expect(footerIcon).not.toBeNull();
    expect(container.textContent?.match(/TikTok/g)?.length ?? 0).toBe(1);
  });
});
