import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetUpstreamState } from "../upstream-guard";
import { youtubeFetch } from "../ytdlp/youtube-fetch";
import {
  EGRESS_TEST_URL,
  disableEgress,
  enableEgress,
  proxyError,
} from "./egress-fakes";

interface Call {
  url: string;
  init?: RequestInit;
}

/** Records every network call; the proxy and direct hosts answer from `reply`. */
function stubNetwork(reply: (call: Call) => Response | Error) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const call = { url: input.toString(), init };
      calls.push(call);
      const answer = reply(call);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  );
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return {
    calls,
    proxy: () => calls.filter((c) => c.url.startsWith(EGRESS_TEST_URL)),
    direct: () => calls.filter((c) => !c.url.startsWith(EGRESS_TEST_URL)),
  };
}

function proxyPayload(call: Call) {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>;
}

const MEDIA_URL = "https://rr1---sn-x.googlevideo.com/videoplayback?itag=140";
const PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?key=k";

beforeEach(() => {
  resetUpstreamState();
  enableEgress();
});

afterEach(() => {
  disableEgress();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("youtubeFetch", () => {
  it("is plain fetch when the proxy is not configured", async () => {
    disableEgress();
    const network = stubNetwork(() => new Response("direct"));
    const init = { headers: { Range: "bytes=0-1" } };

    const response = await youtubeFetch(MEDIA_URL, init);

    expect(await response.text()).toBe("direct");
    expect(network.proxy()).toHaveLength(0);
    expect(network.calls).toEqual([{ url: MEDIA_URL, init }]);
  });

  it("sends googlevideo through /stream, with the upstream status and bytes", async () => {
    const network = stubNetwork(
      () =>
        new Response(new Uint8Array([7, 8]), {
          headers: {
            "X-Egress-Upstream-Status": "206",
            "content-range": "bytes 0-1/50",
          },
        }),
    );

    const response = await youtubeFetch(MEDIA_URL, {
      headers: new Headers({ Range: "bytes=0-1", "User-Agent": "ua" }),
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-1/50");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([7, 8]),
    );
    expect(network.direct()).toHaveLength(0);
    const [call] = network.proxy();
    expect(call.url).toBe(`${EGRESS_TEST_URL}/stream`);
    expect(proxyPayload(call)).toEqual({
      url: MEDIA_URL,
      headers: { range: "bytes=0-1", "user-agent": "ua" },
      nonce: expect.any(String),
    });
  });

  it("sends a youtubei POST through /fetch with its body and headers", async () => {
    const body = JSON.stringify({ videoId: "abc" });
    const network = stubNetwork(() =>
      Response.json({
        ok: true,
        status: 200,
        url: PLAYER_URL,
        headers: { "content-type": "application/json" },
        encoding: "utf8",
        body: '{"playabilityStatus":{"status":"OK"}}',
      }),
    );

    const response = await youtubeFetch(PLAYER_URL, {
      method: "POST",
      headers: new Headers({
        "Content-Type": "application/json",
        "X-YouTube-Client-Name": "5",
        Cookie: "CONSENT=YES+1",
      }),
      body,
    });

    expect(await response.json()).toEqual({
      playabilityStatus: { status: "OK" },
    });
    expect(network.direct()).toHaveLength(0);
    const [call] = network.proxy();
    expect(call.url).toBe(`${EGRESS_TEST_URL}/fetch`);
    expect(proxyPayload(call)).toEqual({
      url: PLAYER_URL,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-youtube-client-name": "5",
        cookie: "CONSENT=YES+1",
      },
      body,
      nonce: expect.any(String),
    });
  });

  it("sends a watch page GET (a URL object) through /fetch", async () => {
    const network = stubNetwork(() =>
      Response.json({
        ok: true,
        status: 200,
        url: "https://www.youtube.com/watch?v=abc",
        headers: {},
        encoding: "utf8",
        body: "<html></html>",
      }),
    );

    const response = await youtubeFetch(
      new URL("https://www.youtube.com/watch?v=abc"),
      { headers: { "Accept-Language": "en-us" } },
    );

    expect(await response.text()).toBe("<html></html>");
    expect(proxyPayload(network.proxy()[0])).toMatchObject({
      url: "https://www.youtube.com/watch?v=abc",
      method: "GET",
      headers: { "accept-language": "en-us" },
    });
    expect(proxyPayload(network.proxy()[0])).not.toHaveProperty("body");
  });

  it("fetches any other host directly", async () => {
    const network = stubNetwork(() => new Response("script"));

    const response = await youtubeFetch("https://example.com/x", {
      headers: { Cookie: "a=b" },
    });

    expect(await response.text()).toBe("script");
    expect(network.proxy()).toHaveLength(0);
    expect(network.direct().map((call) => call.url)).toEqual([
      "https://example.com/x",
    ]);
  });

  it("throws a network-style TypeError, never a Response, when the proxy fails", async () => {
    stubNetwork(
      () => proxyError(424, "vpn_unavailable", "VPN is down").response,
    );

    const error = await youtubeFetch(PLAYER_URL, {
      method: "POST",
      body: "{}",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain("vpn_unavailable");
    expect((error as Error).cause).toMatchObject({
      name: "EgressError",
      kind: "transient",
    });
  });

  it("throws the same for a failed /stream and for an unreachable proxy", async () => {
    stubNetwork(() => proxyError(429, "rate_limited").response);
    await expect(youtubeFetch(MEDIA_URL)).rejects.toBeInstanceOf(TypeError);

    stubNetwork(() => new TypeError("connection reset"));
    await expect(youtubeFetch(PLAYER_URL)).rejects.toBeInstanceOf(TypeError);
  });

  it("passes the caller's abort signal to the proxy call", async () => {
    const network = stubNetwork(() => new Response("never read"));
    const controller = new AbortController();

    await youtubeFetch(PLAYER_URL, {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    }).catch(() => {});
    controller.abort();

    const [call] = network.proxy();
    expect(call.init?.signal).toBeInstanceOf(AbortSignal);
    expect(call.init?.signal?.aborted).toBe(true);
  });

  it("rejects what the proxy cannot carry instead of leaking it direct", async () => {
    const network = stubNetwork(() => new Response("direct"));

    await expect(
      youtubeFetch(PLAYER_URL, { method: "POST", body: new Uint8Array(1) }),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      youtubeFetch(PLAYER_URL, { method: "DELETE" }),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      youtubeFetch(MEDIA_URL, { method: "HEAD" }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(network.calls).toHaveLength(0);
  });
});
