import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  cacheFetchMock: vi.fn(),
  cacheGetMock: vi.fn(),
  cacheSetMock: vi.fn(),
  extractAndProcessEmbedsMock: vi.fn(),
  fetchInstagramOEmbedMetadataMock: vi.fn(),
  fetchTikTokProxyMetadataMock: vi.fn(),
  resolveInstagramVideoMetadataMock: vi.fn(),
}));

vi.mock("@/lib/cache", () => ({
  cacheFetch: hoisted.cacheFetchMock,
  cacheGet: hoisted.cacheGetMock,
  cacheSet: hoisted.cacheSetMock,
}));

vi.mock("@/lib/share-preview-proxy", () => ({
  fetchInstagramOEmbedMetadata: hoisted.fetchInstagramOEmbedMetadataMock,
  fetchTikTokProxyMetadata: hoisted.fetchTikTokProxyMetadataMock,
}));

vi.mock("@/lib/instagram-video-resolver", () => ({
  resolveInstagramVideoMetadata: hoisted.resolveInstagramVideoMetadataMock,
}));

vi.mock("@/services/embed-fetcher", () => ({
  extractAndProcessEmbeds: hoisted.extractAndProcessEmbedsMock,
}));

let proxyMedia: typeof import("../proxy-media").proxyMedia;

beforeAll(async () => {
  ({ proxyMedia } = await import("../proxy-media"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  hoisted.cacheFetchMock.mockReset();
  hoisted.cacheGetMock.mockReset();
  hoisted.cacheSetMock.mockReset();
  hoisted.extractAndProcessEmbedsMock.mockReset();
  hoisted.fetchInstagramOEmbedMetadataMock.mockReset();
  hoisted.fetchTikTokProxyMetadataMock.mockReset();
  hoisted.resolveInstagramVideoMetadataMock.mockReset();
});

describe("proxy media stale TikTok cache handling", () => {
  it("rejects resolver-generated redirects outside the media allowlist", async () => {
    const sourceUrl =
      "https://www.tiktok.com/@example/photo/7644364274630020383";
    const unsafeResolvedUrl = "https://evil.example/redirect-target";

    hoisted.cacheGetMock.mockResolvedValue(null);
    hoisted.cacheSetMock.mockResolvedValue(undefined);
    hoisted.fetchTikTokProxyMetadataMock.mockResolvedValue({
      media: [{ type: "video", url: unsafeResolvedUrl }],
    });

    const upstreamFetchMock = vi.fn(async () => {
      throw new Error("The unsafe resolver result must not be fetched");
    });
    vi.stubGlobal("fetch", upstreamFetchMock as unknown as typeof fetch);

    const response = await proxyMedia(
      new Request(
        `https://meet.test/api/proxy-media?url=${encodeURIComponent(sourceUrl)}`,
      ),
      true,
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("Location")).toBeNull();
    expect(upstreamFetchMock).not.toHaveBeenCalled();
  });

  it("does not reuse expired cached TikTok refresh candidates after a failed refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T16:03:09.000Z"));

    const sourceUrl =
      "https://www.tiktok.com/@.chungus.67/video/7653680207643135240";
    const staleImageUrl =
      "https://p19-common-sign.tiktokcdn-us.com/tos-alisg-p-0037/owA3SdtiABZnzAaEAATh0ISVvViBE0cnAVj5Y~tplv-tiktokx-cropcenter-q:300:400:q70.jpeg?dr=8596&refresh_token=20c180f2&x-expires=1782536400&x-signature=stalesig&t=bacd0480&ps=933b5bde&shp=d05b14bd&shcp=1d1a97fc&idc=useast5&biz_tag=tt_video&s=AWEME_DETAIL&sc=cover";

    hoisted.cacheGetMock.mockResolvedValue([
      {
        type: "image",
        url: staleImageUrl,
      },
    ]);
    hoisted.fetchTikTokProxyMetadataMock.mockResolvedValue(null);

    const upstreamFetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url === staleImageUrl) {
        return new Response(null, {
          status: 403,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", upstreamFetchMock as unknown as typeof fetch);

    const response = await proxyMedia(
      new Request(
        `https://meet.test/api/proxy-media?url=${encodeURIComponent(staleImageUrl)}&sourceUrl=${encodeURIComponent(sourceUrl)}`,
      ),
      true,
    );

    expect(response.status).toBe(403);
    expect(upstreamFetchMock).toHaveBeenCalledTimes(1);
    expect(hoisted.fetchTikTokProxyMetadataMock).toHaveBeenCalledTimes(3);
    expect(hoisted.cacheSetMock).not.toHaveBeenCalled();
  });

  it("bypasses the Instagram refresh cache after a stale asset returns 403", async () => {
    const sourceUrl =
      "https://www.instagram.com/p/DZ9DK2RgNSk/?igsh=MXV1bnhwem9iMmY4bA==";
    const staleImageUrl =
      "https://scontent-ord5-1.cdninstagram.com/v/t51.82787-15/730789341_17944127202213277_6913518894253597983_n.jpg?stp=dst-jpg_e35_s640x640_sh2.08_tt6&_nc_ht=scontent-ord5-1.cdninstagram.com&_nc_cat=101&_nc_sid=57e406&oh=00_AQDx9LC9h7uYQ1UdVfD1icczKSVXjx0ucuMouw-IJveBpg&oe=6A4A071B";
    const freshImageUrl =
      "https://scontent-ord5-2.cdninstagram.com/v/t51.82787-15/730789341_17944127202213277_6913518894253597983_n.jpg?stp=c363.0.1090.1090a_dst-jpg_e35_s640x640_tt6&_nc_cat=104&_nc_sid=18de74&_nc_ht=scontent-ord5-2.cdninstagram.com&oh=00_AQB23V7tkXoY_q_85WBrDyANhyZ2u_z2X-T52tBIe0_teQ&oe=6A53095B";

    hoisted.cacheFetchMock.mockImplementation(
      async (_key: string, _ttl: number, fetcher: () => Promise<unknown>) =>
        fetcher(),
    );
    hoisted.fetchInstagramOEmbedMetadataMock.mockResolvedValue(null);
    hoisted.resolveInstagramVideoMetadataMock.mockImplementation(
      async (_url: string, options?: { bypassCache?: boolean }) => {
        if (!options?.bypassCache) {
          return {
            videoUrl: null,
            thumbnailUrl: staleImageUrl,
            title: "rukia!",
            durationSeconds: null,
            media: [
              {
                type: "image",
                url: staleImageUrl,
              },
            ],
          };
        }

        return {
          videoUrl: null,
          thumbnailUrl: freshImageUrl,
          title: "rukia!",
          durationSeconds: null,
          media: [
            {
              type: "image",
              url: freshImageUrl,
            },
          ],
        };
      },
    );

    const upstreamFetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url === staleImageUrl) {
        return new Response("expired", {
          status: 403,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }
      if (url === freshImageUrl) {
        return new Response("fresh-image", {
          status: 200,
          headers: {
            "Content-Type": "image/jpeg",
            "Content-Length": "11",
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", upstreamFetchMock as unknown as typeof fetch);

    const response = await proxyMedia(
      new Request(
        `https://meet.test/api/proxy-media?url=${encodeURIComponent(staleImageUrl)}&sourceUrl=${encodeURIComponent(sourceUrl)}`,
      ),
      true,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(upstreamFetchMock).toHaveBeenCalledTimes(2);
    expect(hoisted.resolveInstagramVideoMetadataMock).toHaveBeenCalledTimes(2);
    expect(hoisted.resolveInstagramVideoMetadataMock).toHaveBeenNthCalledWith(
      1,
      "https://www.instagram.com/p/DZ9DK2RgNSk/",
      { bypassCache: undefined },
    );
    expect(hoisted.resolveInstagramVideoMetadataMock).toHaveBeenNthCalledWith(
      2,
      "https://www.instagram.com/p/DZ9DK2RgNSk/",
      { bypassCache: true },
    );
  });
});
