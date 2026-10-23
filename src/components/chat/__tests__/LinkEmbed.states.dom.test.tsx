// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EmbedInfo } from "@/lib/types";

const { openImageViewerMock } = vi.hoisted(() => ({
  openImageViewerMock: vi.fn(),
}));

vi.mock("@/stores/useImageViewerStore", () => ({
  useImageViewerActions: () => ({
    open: openImageViewerMock,
    updateImage: vi.fn(),
  }),
}));

import { LinkEmbed } from "../LinkEmbed";
import {
  getDirectMediaBox,
  getSpotifyEmbedUrl,
  getXSingleImageBoxStyle,
} from "../embed-layout";
import { clearEmbedHydrationCache } from "@/lib/embed-hydration-cache";

class InertIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = "";
  thresholds = [];
}

class VisibleIntersectionObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe = (target: Element) => {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  };
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = "";
  thresholds = [];
}

afterEach(() => {
  clearEmbedHydrationCache();
  openImageViewerMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const youtube: EmbedInfo = {
  id: "yt",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  type: "video",
  rawTitle: "Never Gonna Give You Up",
  provider: { name: "YouTube", url: "https://www.youtube.com" },
  thumbnail: {
    url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    width: 480,
    height: 360,
  },
  video: {
    url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    width: 1280,
    height: 720,
    kind: "player",
  },
  fields: [],
};

describe("play overlays", () => {
  it("centres the YouTube play target on the whole frame and keeps the open link in a corner", () => {
    render(<LinkEmbed embed={youtube} />);

    const play = screen.getByRole("button", {
      name: "Play Never Gonna Give You Up",
    });
    // The play target fills the frame (absolute inset-0, flex centred), so
    // the mark is centred whatever the size.
    expect(play.className).toContain("absolute");
    expect(play.className).toContain("inset-0");
    expect(play.className).toContain("items-center");
    expect(play.className).toContain("justify-center");

    const open = screen.getByRole("link", { name: "Open in YouTube" });
    expect(open.className).toContain("right-2");
    expect(open.className).toContain("top-2");
    // Not a sibling inside the play target's flex row any more.
    expect(play.contains(open)).toBe(false);
  });

  it("swaps the thumbnail for the player on play", () => {
    render(<LinkEmbed embed={youtube} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Play Never Gonna Give You Up" }),
    );
    expect(
      document.querySelector('iframe[src*="youtube.com/embed/dQw4w9WgXcQ"]'),
    ).not.toBeNull();
  });
});

describe("direct media links", () => {
  it("fits a direct image in 400x300 without upscaling", () => {
    expect(getDirectMediaBox(544, 184)).toEqual({
      width: 400,
      aspectRatio: 544 / 184,
    });
    expect(getDirectMediaBox(1080, 1920)?.width).toBe(169);
    expect(getDirectMediaBox(120, 80)?.width).toBe(120);
    expect(getDirectMediaBox(undefined, 10)).toBeNull();
  });

  it("renders a direct image bare, with its box reserved, and opens the viewer", () => {
    render(
      <LinkEmbed
        messageId="m1"
        embed={{
          id: "png",
          url: "https://cdn.test/logo.png",
          type: "image",
          direct: true,
          media: [
            {
              type: "image",
              url: "https://cdn.test/logo.png",
              width: 544,
              height: 184,
              contentType: "image/png",
            },
          ],
          fields: [],
        }}
      />,
    );

    const button = screen.getByRole("button", { name: "Open image" });
    expect(button.style.aspectRatio).toBe(`${544 / 184} / 1`);
    expect(
      document.querySelector('img[src="https://cdn.test/logo.png"]'),
    ).not.toBeNull();

    fireEvent.click(button);
    expect(openImageViewerMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          url: "https://cdn.test/logo.png",
          content_type: "image/png",
        }),
      ],
      0,
      expect.anything(),
    );
  });

  it("falls back to a link chip when the direct file fails to load", () => {
    render(
      <LinkEmbed
        embed={{
          id: "gif",
          url: "https://cdn.test/spin.gif",
          type: "image",
          direct: true,
          media: [{ type: "image", url: "https://cdn.test/spin.gif" }],
          fields: [],
        }}
      />,
    );

    fireEvent.error(
      document.querySelector('img[src="https://cdn.test/spin.gif"]')!,
    );

    expect(screen.getByRole("link", { name: /spin\.gif/ })).toHaveAttribute(
      "href",
      "https://cdn.test/spin.gif",
    );
  });

  it("plays a direct video file in the video player", () => {
    render(
      <LinkEmbed
        embed={{
          id: "mp4",
          url: "https://cdn.test/clip.mp4",
          type: "video",
          direct: true,
          video: {
            url: "https://cdn.test/clip.mp4",
            kind: "direct",
            contentType: "video/mp4",
            width: 1280,
            height: 720,
          },
          fields: [],
        }}
      />,
    );

    const video = document.querySelector("video.rm-custom-video");
    expect(video?.getAttribute("src")).toBe("https://cdn.test/clip.mp4");
    expect(screen.getByTestId("direct-media-video")).toBeTruthy();
  });
});

describe("link cards", () => {
  const base: EmbedInfo = {
    id: "card",
    url: "https://www.reddit.com/r/programming/",
    type: "link",
    rawTitle: "r/programming",
    rawDescription: "Computer Programming",
    provider: { name: "Reddit" },
    thumbnail: {
      url: "https://www.redditstatic.com/icon.png",
      width: 256,
      height: 256,
    },
    fields: [],
  };

  it("puts a summary-card image beside the text as a small thumbnail", () => {
    render(<LinkEmbed embed={{ ...base, imageLayout: "thumbnail" }} />);
    const img = document.querySelector(
      'img[src="https://www.redditstatic.com/icon.png"]',
    );
    expect(img?.className).toContain("size-20");
  });

  it("reserves the large image box from its size", () => {
    render(
      <LinkEmbed
        embed={{
          ...base,
          imageLayout: "large",
          thumbnail: {
            url: "https://og.test/hero.png",
            width: 1200,
            height: 630,
          },
        }}
      />,
    );
    const img = document.querySelector(
      'img[src="https://og.test/hero.png"]',
    ) as HTMLImageElement;
    expect(img.style.aspectRatio).toBe("1200 / 630");
  });

  it("drops an image that fails to load instead of showing a broken icon", () => {
    render(
      <LinkEmbed
        embed={{ ...base, thumbnail: { url: "https://og.test/missing.jpg" } }}
      />,
    );
    const img = document.querySelector(
      'img[src="https://og.test/missing.jpg"]',
    );
    fireEvent.error(img!);
    expect(
      document.querySelector('img[src="https://og.test/missing.jpg"]'),
    ).toBeNull();
    expect(screen.getByText("r/programming")).toBeTruthy();
  });
});

describe("unavailable posts", () => {
  it("shows the unavailable art and provider wording for a stored tombstone", () => {
    render(
      <LinkEmbed
        embed={{
          id: "gone",
          url: "https://www.tiktok.com/@gone/video/1",
          type: "rich",
          unavailable: true,
          provider: { name: "TikTok", url: "https://www.tiktok.com" },
          fields: [],
        }}
      />,
    );

    const card = screen.getByTestId("embed-unavailable");
    expect(
      card.querySelector('img[src="/tiktok-unavailable.webp"]'),
    ).not.toBeNull();
    expect(screen.getByText("This TikTok is no longer available")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View original" })).toHaveAttribute(
      "href",
      "https://www.tiktok.com/@gone/video/1",
    );
  });

  it("turns an Instagram post the server reports gone into the unavailable card", async () => {
    vi.stubGlobal("IntersectionObserver", VisibleIntersectionObserver);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "gone", unavailable: true }, { status: 404 }),
      ),
    );

    render(
      <LinkEmbed
        embed={{
          id: "ig",
          url: "https://www.instagram.com/p/DELETED/",
          type: "rich",
          rawTitle: "old caption",
          provider: { name: "Instagram" },
          thumbnail: { url: "https://scontent.cdninstagram.com/x.jpg" },
          fields: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("embed-unavailable")).toBeTruthy();
    });
    expect(screen.queryByText("old caption")).toBeNull();
  });
});

describe("hydration cache", () => {
  it("fetches TikTok hydration once for repeated mounts of the same post", async () => {
    vi.stubGlobal("IntersectionObserver", InertIntersectionObserver);
    const fetchMock = vi.fn(async () =>
      Response.json({
        postType: "video",
        videoUrl: "https://v19.tiktokcdn-us.com/a/video.mp4",
        coverUrl: "https://p16-common-sign.tiktokcdn-us.com/a/cover.jpeg",
        title: "hi",
        media: [
          {
            type: "video",
            url: "https://v19.tiktokcdn-us.com/a/video.mp4",
            width: 576,
            height: 1024,
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const embed: EmbedInfo = {
      id: "tt",
      url: "https://www.tiktok.com/@a/video/7600000000000000009",
      type: "video",
      provider: { name: "TikTok" },
      video: {
        url: "https://www.tiktok.com/player/v1/7600000000000000009",
        kind: "player",
      },
      fields: [],
    };

    const first = render(<LinkEmbed embed={embed} />);
    await waitFor(() => {
      expect(
        first.container.querySelector("video.rm-custom-video"),
      ).not.toBeNull();
    });
    first.unmount();

    // Scrolling back: the virtualised list mounts the card again.
    const second = render(<LinkEmbed embed={embed} />);
    expect(
      second.container.querySelector("video.rm-custom-video"),
    ).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("spotify", () => {
  it("drops the locale segment from the player URL", () => {
    expect(
      getSpotifyEmbedUrl("https://open.spotify.com/intl-de/album/abc?si=1"),
    ).toBe("https://open.spotify.com/embed/album/abc");
  });

  it("gives albums the taller player and tracks the compact one", () => {
    const { rerender } = render(
      <LinkEmbed
        embed={{
          id: "sp",
          url: "https://open.spotify.com/album/abc",
          type: "link",
          provider: { name: "Spotify" },
          fields: [],
        }}
      />,
    );
    expect(
      (document.querySelector("iframe") as HTMLIFrameElement).style.height,
    ).toBe("152px");

    rerender(
      <LinkEmbed
        embed={{
          id: "sp2",
          url: "https://open.spotify.com/track/abc",
          type: "link",
          provider: { name: "Spotify" },
          fields: [],
        }}
      />,
    );
    expect(
      (document.querySelector("iframe") as HTMLIFrameElement).style.height,
    ).toBe("80px");
  });
});

describe("x single image", () => {
  it("reserves a box capped at 520x420 from the image size", () => {
    expect(getXSingleImageBoxStyle(1122, 1402)).toEqual({
      aspectRatio: "1122 / 1402",
      width: "min(100%, 336px)",
    });
    expect(getXSingleImageBoxStyle(2000, 1000)?.width).toBe("min(100%, 520px)");
    expect(getXSingleImageBoxStyle(undefined, 100)).toBeUndefined();
  });
});
