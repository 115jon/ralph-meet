import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  cacheFetchMock: vi.fn(),
  cacheGetMock: vi.fn(),
  cacheSetMock: vi.fn(),
  extractAndProcessEmbedsMock: vi.fn(),
  fetchInstagramOEmbedMetadataMock: vi.fn(),
  fetchInstagramVideoMetadataMock: vi.fn(),
  fetchTikTokProxyMetadataMock: vi.fn(),
}));

vi.mock("@/lib/cache", () => ({
  cacheFetch: hoisted.cacheFetchMock,
  cacheGet: hoisted.cacheGetMock,
  cacheSet: hoisted.cacheSetMock,
}));

vi.mock("@/lib/share-preview-proxy", () => ({
  fetchInstagramOEmbedMetadata: hoisted.fetchInstagramOEmbedMetadataMock,
  fetchInstagramVideoMetadata: hoisted.fetchInstagramVideoMetadataMock,
  fetchTikTokProxyMetadata: hoisted.fetchTikTokProxyMetadataMock,
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
  hoisted.fetchInstagramVideoMetadataMock.mockReset();
  hoisted.fetchTikTokProxyMetadataMock.mockReset();
});

describe("proxy media stale TikTok cache handling", () => {
  it("does not reuse expired cached TikTok refresh candidates after a failed refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T16:03:09.000Z"));

    const sourceUrl = "https://www.tiktok.com/@.chungus.67/video/7653680207643135240";
    const staleImageUrl = "https://p19-common-sign.tiktokcdn-us.com/tos-alisg-p-0037/owA3SdtiABZnzAaEAATh0ISVvViBE0cnAVj5Y~tplv-tiktokx-cropcenter-q:300:400:q70.jpeg?dr=8596&refresh_token=20c180f2&x-expires=1782536400&x-signature=stalesig&t=bacd0480&ps=933b5bde&shp=d05b14bd&shcp=1d1a97fc&idc=useast5&biz_tag=tt_video&s=AWEME_DETAIL&sc=cover";

    hoisted.cacheGetMock.mockResolvedValue([{
      type: "image",
      url: staleImageUrl,
    }]);
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
      new Request(`https://meet.test/api/proxy-media?url=${encodeURIComponent(staleImageUrl)}&sourceUrl=${encodeURIComponent(sourceUrl)}`),
      true,
    );

    expect(response.status).toBe(403);
    expect(upstreamFetchMock).toHaveBeenCalledTimes(1);
    expect(hoisted.fetchTikTokProxyMetadataMock).toHaveBeenCalledTimes(3);
    expect(hoisted.cacheSetMock).not.toHaveBeenCalled();
  });
});
