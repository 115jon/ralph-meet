import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/listen-together.service", () => ({
  resolveListenTogetherAudioStream: resolveMock,
}));

import {
  buildProxyHeaders,
  isAllowedListenTogetherStreamHost,
  makeSyntheticRangeResponse,
  normalizeListenTogetherUpstreamRange,
  streamListenTogetherAudio,
} from "../listen-together/stream";
import { UpstreamBlockedError } from "@/lib/upstream-guard";
import { YouTubeBotCheckError } from "@/lib/ytdlp/youtube";

function resolvedStream(url: string) {
  return {
    url,
    itag: 140,
    mimeType: 'audio/mp4; codecs="mp4a.40.2"',
    contentLength: 4_000_000,
    expiresAt: Date.now() + 6 * 60 * 60 * 1000,
  };
}

const STALE_URL =
  "https://rr1---sn-stale.googlevideo.com/videoplayback?itag=140";
const FRESH_URL =
  "https://rr2---sn-fresh.googlevideo.com/videoplayback?itag=140";

function audioChunk(start: number, end: number, total = 4_000_000) {
  return new Response(new Uint8Array(end - start + 1), {
    status: 206,
    headers: {
      "Content-Type": "audio/mp4",
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Content-Length": String(end - start + 1),
    },
  });
}

describe("listen together stream proxy helpers", () => {
  it("builds ranged responses when an upstream stream ignores the range header", async () => {
    const upstream = new Response(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]), {
      status: 200,
      headers: {
        "Content-Length": "8",
        "Content-Type": "audio/webm",
      },
    });

    const response = await makeSyntheticRangeResponse(upstream, "bytes=2-5");
    expect(response?.status).toBe(206);
    expect(response?.headers.get("Content-Range")).toBe("bytes 2-5/8");
    expect(response?.headers.get("Content-Length")).toBe("4");
    expect(Array.from(new Uint8Array(await response!.arrayBuffer()))).toEqual([
      2, 3, 4, 5,
    ]);
  });

  it("returns a 416 when the requested range is outside the content length", async () => {
    const upstream = new Response(new Uint8Array([0, 1, 2]), {
      status: 200,
      headers: {
        "Content-Length": "3",
        "Content-Type": "audio/webm",
      },
    });

    const response = await makeSyntheticRangeResponse(upstream, "bytes=9-12");
    expect(response?.status).toBe(416);
    expect(response?.headers.get("Content-Range")).toBe("bytes */3");
  });

  it("adds cache and content-type hardening headers for proxied audio", () => {
    const headers = buildProxyHeaders(
      new Headers({
        "Content-Length": "10",
        "Content-Type": "audio/webm",
      }),
    );

    expect(headers.get("Content-Type")).toBe("audio/webm");
    expect(headers.get("Cache-Control")).toBe("private, max-age=60");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("normalizes open-ended media ranges into bounded upstream requests", () => {
    expect(normalizeListenTogetherUpstreamRange("bytes=0-")).toBe(
      "bytes=0-10485759",
    );
    expect(normalizeListenTogetherUpstreamRange("bytes=65536-")).toBe(
      "bytes=65536-10551295",
    );
  });

  it("caps large closed media ranges to upstream-safe chunks", () => {
    expect(normalizeListenTogetherUpstreamRange("bytes=65536-3860871")).toBe(
      "bytes=65536-3860871",
    );
    expect(
      normalizeListenTogetherUpstreamRange("bytes=0-2048", {
        includeBody: false,
      }),
    ).toBe("bytes=0-1");
  });

  it("trims an upstream partial response that exceeds the requested range", async () => {
    const upstream = new Response(
      new Uint8Array([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]),
      {
        status: 206,
        headers: {
          "Content-Length": "10",
          "Content-Range": "bytes 100-109/1000",
          "Content-Type": "audio/mp4",
        },
      },
    );

    const response = await makeSyntheticRangeResponse(
      upstream,
      "bytes=102-105",
    );
    expect(response?.status).toBe(206);
    expect(response?.headers.get("Content-Range")).toBe("bytes 102-105/1000");
    expect(response?.headers.get("Content-Length")).toBe("4");
    expect(Array.from(new Uint8Array(await response!.arrayBuffer()))).toEqual([
      102, 103, 104, 105,
    ]);
  });

  it("uses a tiny probe range for HEAD-style metadata requests", () => {
    expect(
      normalizeListenTogetherUpstreamRange(null, { includeBody: false }),
    ).toBe("bytes=0-1");
    expect(
      normalizeListenTogetherUpstreamRange("bytes=2048-", {
        includeBody: false,
      }),
    ).toBe("bytes=2048-2049");
  });

  it("only allows googlevideo media hosts over https", () => {
    expect(isAllowedListenTogetherStreamHost(new URL(FRESH_URL))).toBe(true);
    expect(
      isAllowedListenTogetherStreamHost(
        new URL("https://googlevideo.com.example.net/videoplayback"),
      ),
    ).toBe(false);
    expect(
      isAllowedListenTogetherStreamHost(
        new URL("http://rr1---sn.googlevideo.com/videoplayback"),
      ),
    ).toBe(false);
  });
});

describe("streamListenTogetherAudio", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    resolveMock.mockReset();
  });

  it("relays a bounded upstream range with its audio headers", async () => {
    resolveMock.mockResolvedValue(resolvedStream(FRESH_URL));
    fetchMock.mockResolvedValue(audioChunk(0, 10_485_759, 20_000_000));

    const response = await streamListenTogetherAudio({
      videoId: "video-1",
      preferredFormat: "mp4",
      range: "bytes=0-",
      includeBody: true,
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Type")).toBe("audio/mp4");
    expect(response.headers.get("Content-Range")).toBe(
      "bytes 0-10485759/20000000",
    );
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).get("Range")).toBe("bytes=0-10485759");
  });

  it("resolves again once when the cached URL is refused, then streams", async () => {
    resolveMock
      .mockResolvedValueOnce(resolvedStream(STALE_URL))
      .mockResolvedValueOnce(resolvedStream(FRESH_URL));
    fetchMock
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }))
      .mockResolvedValueOnce(audioChunk(0, 1023));

    const response = await streamListenTogetherAudio({
      videoId: "video-1",
      preferredFormat: "mp4",
      range: "bytes=0-1023",
      includeBody: true,
    });

    expect(response.status).toBe(206);
    expect(resolveMock).toHaveBeenNthCalledWith(2, "video-1", "mp4", {
      forceRefresh: true,
    });
    expect(String(fetchMock.mock.calls[1]![0])).toBe(FRESH_URL);
  });

  it("fails after one refresh instead of retrying a refused stream", async () => {
    resolveMock.mockResolvedValue(resolvedStream(STALE_URL));
    fetchMock.mockImplementation(
      async () => new Response("Forbidden", { status: 403 }),
    );

    const response = await streamListenTogetherAudio({
      videoId: "video-1",
      preferredFormat: "mp4",
      range: "bytes=0-",
      includeBody: true,
    });

    expect(response.status).toBe(502);
    expect(response.headers.get("X-Listen-Together-Error")).toBe(
      "UPSTREAM_FAILED",
    );
    expect(resolveMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not re-resolve for an upstream server error", async () => {
    resolveMock.mockResolvedValue(resolvedStream(FRESH_URL));
    fetchMock.mockResolvedValue(new Response("oops", { status: 500 }));

    const response = await streamListenTogetherAudio({
      videoId: "video-1",
      preferredFormat: "mp4",
      range: null,
      includeBody: true,
    });

    expect(response.status).toBe(502);
    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("answers YouTube's bot wall with a retryable 503", async () => {
    resolveMock.mockRejectedValue(new YouTubeBotCheckError("walled"));

    const response = await streamListenTogetherAudio({
      videoId: "video-1",
      preferredFormat: "webm",
      range: null,
      includeBody: false,
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("20");
    expect(response.headers.get("X-Listen-Together-Error")).toBe(
      "YOUTUBE_BOT_CHECK",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes an open circuit's remaining backoff to the client", async () => {
    resolveMock.mockRejectedValue(
      new UpstreamBlockedError("youtube-player", 7),
    );

    const response = await streamListenTogetherAudio({
      videoId: "video-1",
      preferredFormat: "mp4",
      range: null,
      includeBody: true,
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("7");
  });

  it("reports a track with no playable stream as RESOLVE_FAILED", async () => {
    resolveMock.mockRejectedValue(new Error("no formats"));

    const response = await streamListenTogetherAudio({
      videoId: "video-1",
      preferredFormat: "mp4",
      range: null,
      includeBody: true,
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "RESOLVE_FAILED" });
  });

  it("refuses to fetch a resolved URL outside googlevideo", async () => {
    resolveMock.mockResolvedValue(
      resolvedStream("https://example.com/videoplayback"),
    );

    const response = await streamListenTogetherAudio({
      videoId: "video-1",
      preferredFormat: "mp4",
      range: null,
      includeBody: true,
    });

    expect(response.status).toBe(502);
    expect(response.headers.get("X-Listen-Together-Error")).toBe(
      "HOST_NOT_ALLOWED",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers HEAD with the full length from a two-byte probe", async () => {
    resolveMock.mockResolvedValue(resolvedStream(FRESH_URL));
    fetchMock.mockResolvedValue(audioChunk(0, 1));

    const response = await streamListenTogetherAudio({
      videoId: "video-1",
      preferredFormat: "mp4",
      range: null,
      includeBody: false,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("4000000");
    expect(response.headers.get("Content-Range")).toBeNull();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).get("Range")).toBe("bytes=0-1");
  });
});
