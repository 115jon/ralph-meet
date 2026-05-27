import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTikTokProxyMetadata, getTikTokShareUrl, getTikTokThumbnailUrl, proxyImage } from "../share-preview-proxy";

describe("share preview proxy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finds TikTok thumbnails from the share snapshot", () => {
    const share = {
      snapshot: {
        embeds: [
          {
            url: "https://www.tiktok.com/@johnny/video/123",
            provider: { name: "TikTok" },
            thumbnail: { url: "https://p16-common-sign.tiktokcdn-us.com/thumb.jpeg" },
          },
        ],
      },
    } as any;

    expect(getTikTokThumbnailUrl(share)).toBe("https://p16-common-sign.tiktokcdn-us.com/thumb.jpeg");
  });

  it("finds TikTok source URLs from the share snapshot", () => {
    const share = {
      snapshot: {
        embeds: [
          {
            url: "https://www.tiktok.com/@johnny/video/123",
            provider: { name: "TikTok" },
          },
        ],
      },
    } as any;

    expect(getTikTokShareUrl(share)).toBe("https://www.tiktok.com/@johnny/video/123");
  });

  it("loads refreshed TikTok proxy metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      code: 0,
      data: {
        title: "hello",
        cover: "https://p16-common-sign.tiktokcdn-us.com/fresh.jpeg",
        play: "https://v19.tiktokcdn-us.com/video.mp4",
        author: { nickname: "Johnny" },
      },
    })));

    await expect(fetchTikTokProxyMetadata("https://www.tiktok.com/@johnny/video/123")).resolves.toEqual({
      title: "hello",
      coverUrl: "https://p16-common-sign.tiktokcdn-us.com/fresh.jpeg",
      videoUrl: "https://v19.tiktokcdn-us.com/video.mp4",
      authorName: "Johnny",
    });
  });

  it("proxies fetchable images with safe headers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("image-bytes", {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": "11",
      },
    })));

    const response = await proxyImage("https://p16-common-sign.tiktokcdn-us.com/thumb.jpeg");

    expect(response).not.toBeNull();
    expect(response?.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response?.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    expect(await response?.text()).toBe("image-bytes");
  });

  it("falls back when the upstream image refuses bot fetches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Forbidden", { status: 403 })));

    await expect(proxyImage("https://p16-common-sign.tiktokcdn-us.com/thumb.jpeg")).resolves.toBeNull();
  });
});
