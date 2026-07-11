import {
  buildProxyHeaders,
  makeSyntheticRangeResponse,
  normalizeListenTogetherUpstreamRange,
} from "../listen-together/stream";
import { describe, expect, it } from "vitest";

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
});
