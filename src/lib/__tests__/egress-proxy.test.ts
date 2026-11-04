import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EGRESS_PROXY_CIRCUIT,
  EgressDisabledError,
  EgressError,
  createEgressNonce,
  egressEnabled,
  egressFetch,
  egressProviderName,
  egressResolve,
  egressStream,
  guardedEgressFetch,
  signEgressBody,
} from "../egress-proxy";
import {
  UpstreamBlockedError,
  resetUpstreamState,
  upstreamGuard,
} from "../upstream-guard";
import {
  EGRESS_TEST_SECRET,
  EGRESS_TEST_URL,
  hmacHex,
  proxyError,
  toEnvelope,
} from "./egress-fakes";

const config = { EGRESS_PROXY_SECRET: EGRESS_TEST_SECRET };

type Reply = Response | Error;

/** Queue proxy answers (the last one repeats); every request is recorded. */
function stubProxy(...replies: Reply[]) {
  const queue = [...replies];
  const requests: Array<{
    url: string;
    method?: string;
    headers: Headers;
    body: string;
  }> = [];
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: input.toString(),
        method: init?.method,
        headers: new Headers(init?.headers),
        body: String(init?.body ?? ""),
      });
      const next = queue.length > 1 ? queue.shift()! : queue[0]!;
      if (next instanceof Error) throw next;
      return next.clone();
    },
  );
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return { requests, fetchMock };
}

function upstreamEnvelope(
  status: number,
  body: string,
  headers: Record<string, string> = {},
) {
  return toEnvelope(new Response(body, { status, headers }), "https://u.test/");
}

beforeEach(() => {
  resetUpstreamState();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("signing", () => {
  it("signs ts + newline + body with HMAC-SHA256 as lowercase hex", async () => {
    const body = '{"url":"https://tikwm.com/api/","method":"GET","nonce":"ab"}';
    const signature = await signEgressBody("k3y", "1790000000", body);

    expect(signature).toBe(hmacHex("k3y", "1790000000", body));
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    // Any change to the timestamp or the body changes the signature.
    expect(await signEgressBody("k3y", "1790000001", body)).not.toBe(signature);
    expect(await signEgressBody("k3y", "1790000000", `${body} `)).not.toBe(
      signature,
    );
  });

  it("sends the exact contract: POST /fetch, JSON body, timestamp and signature headers", async () => {
    const proxy = stubProxy(await upstreamEnvelope(200, "{}"));
    const nowMs = 1_790_000_123_456;

    await egressFetch(
      config,
      {
        url: "https://www.tikwm.com/api/?url=x",
        method: "GET",
        headers: {
          "User-Agent": "ua",
          Accept: "application/json",
          "Accept-Language": "en-US",
          Referer: "https://www.tikwm.com/",
          // Not on the proxy's list: must not be sent.
          Origin: "https://www.tikwm.com",
          Cookie: "secret=1",
        },
      },
      { now: () => nowMs },
    );

    const [request] = proxy.requests;
    expect(request.url).toBe(`${EGRESS_TEST_URL}/fetch`);
    expect(request.method).toBe("POST");
    expect(request.headers.get("content-type")).toBe("application/json");
    const timestamp = request.headers.get("X-Egress-Timestamp");
    expect(timestamp).toBe("1790000123");
    expect(request.headers.get("X-Egress-Signature")).toBe(
      hmacHex(EGRESS_TEST_SECRET, timestamp!, request.body),
    );
    expect(JSON.parse(request.body)).toEqual({
      url: "https://www.tikwm.com/api/?url=x",
      method: "GET",
      headers: {
        "user-agent": "ua",
        accept: "application/json",
        "accept-language": "en-US",
        referer: "https://www.tikwm.com/",
      },
      nonce: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
    expect(request.body).not.toContain(EGRESS_TEST_SECRET);
  });

  it("uses a fresh nonce for every request", async () => {
    const proxy = stubProxy(await upstreamEnvelope(200, "{}"));
    await egressFetch(config, { url: "https://tikwm.com/api/" });
    await egressFetch(config, { url: "https://tikwm.com/api/" });

    const nonces = proxy.requests.map((r) => JSON.parse(r.body).nonce);
    expect(new Set(nonces).size).toBe(2);
    expect(createEgressNonce()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("honours a configured base URL and trims its trailing slash", async () => {
    const proxy = stubProxy(await upstreamEnvelope(200, "{}"));
    await egressFetch(
      { ...config, EGRESS_PROXY_URL: "https://egress.example.test/" },
      { url: "https://tikwm.com/api/" },
    );
    expect(proxy.requests[0].url).toBe("https://egress.example.test/fetch");
  });

  it("sends /resolve with url, headers and nonce, and returns where it ended", async () => {
    const proxy = stubProxy(
      Response.json({
        ok: true,
        url: "https://www.tiktok.com/@a/video/1",
        status: 200,
        hops: 2,
      }),
    );

    const result = await egressResolve(config, {
      url: "https://vm.tiktok.com/abc/",
      headers: { "User-Agent": "ua", Origin: "nope" },
    });

    expect(result).toEqual({
      url: "https://www.tiktok.com/@a/video/1",
      status: 200,
      hops: 2,
    });
    expect(proxy.requests[0].url).toBe(`${EGRESS_TEST_URL}/resolve`);
    expect(JSON.parse(proxy.requests[0].body)).toEqual({
      url: "https://vm.tiktok.com/abc/",
      headers: { "user-agent": "ua" },
      nonce: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
  });
});

describe("POST /fetch", () => {
  it("signs and sends the body and the YouTube headers", async () => {
    const proxy = stubProxy(await upstreamEnvelope(200, '{"ok":1}'));
    const body = '{"videoId":"abc"}';

    const response = await egressFetch(config, {
      url: "https://www.youtube.com/youtubei/v1/player?key=k",
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        Origin: "https://www.youtube.com",
        "X-YouTube-Client-Name": "5",
        "X-YouTube-Client-Version": "20.1",
        "X-Goog-Visitor-Id": "visitor",
        "Sec-Fetch-Mode": "navigate",
        Cookie: "CONSENT=YES+1",
        "X-Custom": "dropped",
      },
    });

    expect(await response.json()).toEqual({ ok: 1 });
    const [request] = proxy.requests;
    expect(request.url).toBe(`${EGRESS_TEST_URL}/fetch`);
    expect(request.headers.get("X-Egress-Signature")).toBe(
      hmacHex(
        EGRESS_TEST_SECRET,
        request.headers.get("X-Egress-Timestamp")!,
        request.body,
      ),
    );
    expect(JSON.parse(request.body)).toEqual({
      url: "https://www.youtube.com/youtubei/v1/player?key=k",
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://www.youtube.com",
        "x-youtube-client-name": "5",
        "x-youtube-client-version": "20.1",
        "x-goog-visitor-id": "visitor",
        "sec-fetch-mode": "navigate",
        cookie: "CONSENT=YES+1",
      },
      body,
      nonce: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
  });

  it("leaves `body` out of the payload for a GET", async () => {
    const proxy = stubProxy(await upstreamEnvelope(200, "{}"));
    await egressFetch(config, { url: "https://www.youtube.com/" });
    expect(JSON.parse(proxy.requests[0].body)).not.toHaveProperty("body");
  });

  it("stops waiting for the proxy when the caller's signal aborts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        init?.signal?.throwIfAborted();
        return upstreamEnvelope(200, "{}");
      }) as unknown as typeof fetch,
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      egressFetch(
        config,
        { url: "https://www.youtube.com/" },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ kind: "transient" });
  });
});

describe("POST /stream", () => {
  const streamRequest = {
    url: "https://rr1---sn-x.googlevideo.com/videoplayback?itag=140",
    headers: {
      "User-Agent": "ua",
      Range: "bytes=0-9",
      Accept: "*/*",
      "X-Custom": "dropped",
    },
  };

  function streamReply(
    status: number,
    body: BodyInit | null,
    headers: Record<string, string> = {},
  ) {
    return new Response(body, {
      status: 200,
      headers: { "X-Egress-Upstream-Status": String(status), ...headers },
    });
  }

  it("signs the request and passes the upstream status, headers and bytes through", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const proxy = stubProxy(
      streamReply(206, bytes, {
        "content-type": "audio/mp4",
        "content-length": "10",
        "content-range": "bytes 0-9/100",
        "accept-ranges": "bytes",
        etag: '"e"',
        "last-modified": "Wed, 01 Jan 2026 00:00:00 GMT",
        "set-cookie": "nope=1",
        "x-other": "dropped",
      }),
    );

    const response = await egressStream(config, streamRequest);

    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("audio/mp4");
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("content-range")).toBe("bytes 0-9/100");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("etag")).toBe('"e"');
    expect(response.headers.get("last-modified")).toBe(
      "Wed, 01 Jan 2026 00:00:00 GMT",
    );
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(response.headers.has("x-other")).toBe(false);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);

    const [request] = proxy.requests;
    expect(request.url).toBe(`${EGRESS_TEST_URL}/stream`);
    expect(request.method).toBe("POST");
    expect(request.headers.get("X-Egress-Signature")).toBe(
      hmacHex(
        EGRESS_TEST_SECRET,
        request.headers.get("X-Egress-Timestamp")!,
        request.body,
      ),
    );
    expect(JSON.parse(request.body)).toEqual({
      url: streamRequest.url,
      headers: { "user-agent": "ua", range: "bytes=0-9", accept: "*/*" },
      nonce: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
  });

  it("streams: the Response is available before the body ends", async () => {
    let finish!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        finish = () => {
          controller.enqueue(new Uint8Array([2]));
          controller.close();
        };
      },
    });
    stubProxy(streamReply(200, body));

    const response = await egressStream(config, streamRequest);
    const reader = response.body!.getReader();
    expect((await reader.read()).value).toEqual(new Uint8Array([1]));
    finish();
    expect((await reader.read()).value).toEqual(new Uint8Array([2]));
    expect((await reader.read()).done).toBe(true);
  });

  it("resolves an upstream 403 normally and drops the body of a 304", async () => {
    stubProxy(streamReply(403, "denied"));
    const refused = await egressStream(config, streamRequest);
    expect(refused.status).toBe(403);
    expect(await refused.text()).toBe("denied");

    stubProxy(streamReply(304, "ignored"));
    const notModified = await egressStream(config, streamRequest);
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");
  });

  it.each([
    [429, "backoff", "rate_limited"],
    [503, "backoff", "busy"],
    [424, "transient", "vpn_unavailable"],
    [401, "hard", "bad_signature"],
    [403, "hard", "host_not_allowed"],
    [413, "hard", "too_large"],
    [400, "hard", "bad_request"],
  ] as const)(
    "maps a proxy %i (%s) to an EgressError",
    async (status, kind, code) => {
      stubProxy(
        proxyError(status, code, `msg ${code}`, { "Retry-After": "9" })
          .response,
      );

      const error = await egressStream(config, streamRequest).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(EgressError);
      expect(error).toMatchObject({
        kind,
        code,
        status,
        message: `msg ${code}`,
        retryAfterSeconds: 9,
      });
    },
  );

  it("treats a non-JSON answer without the status header as transient", async () => {
    stubProxy(
      new Response("<html>Bad gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(egressStream(config, streamRequest)).rejects.toMatchObject({
      name: "EgressError",
      kind: "transient",
      status: 502,
    });
  });

  it("treats a 200 without the status header as transient", async () => {
    stubProxy(new Response("raw bytes", { status: 200 }));
    await expect(egressStream(config, streamRequest)).rejects.toMatchObject({
      kind: "transient",
    });
  });

  it("treats a bad upstream status header as transient", async () => {
    stubProxy(streamReply(200, "x", { "X-Egress-Upstream-Status": "abc" }));
    await expect(egressStream(config, streamRequest)).rejects.toMatchObject({
      kind: "transient",
    });
  });

  it("turns a network failure into a transient error", async () => {
    stubProxy(new TypeError("connection reset"));
    await expect(egressStream(config, streamRequest)).rejects.toMatchObject({
      kind: "transient",
      message: "connection reset",
    });
  });

  it("aborts when the caller's signal is already aborted", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        init?.signal?.throwIfAborted();
        return streamReply(200, "x");
      },
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const controller = new AbortController();
    controller.abort();

    await expect(
      egressStream(config, streamRequest, { signal: controller.signal }),
    ).rejects.toMatchObject({ kind: "transient" });
  });

  it("is disabled without a secret", async () => {
    await expect(egressStream({}, streamRequest)).rejects.toBeInstanceOf(
      EgressDisabledError,
    );
  });
});

describe("envelope", () => {
  it("rebuilds a utf8 answer: the upstream's status, forwarded headers and body", async () => {
    stubProxy(
      await upstreamEnvelope(404, '{"msg":"nope"}', {
        "content-type": "application/json; charset=utf-8",
        "retry-after": "7",
      }),
    );

    const response = await egressFetch(config, { url: "https://tikwm.com/x" });

    // An upstream 404 is the caller's to judge, not an error of the proxy.
    expect(response.status).toBe(404);
    expect(response.ok).toBe(false);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("retry-after")).toBe("7");
    expect(await response.json()).toEqual({ msg: "nope" });
    expect(response.url).toBe("https://u.test/");
  });

  it("decodes a base64 body to the original bytes", async () => {
    const bytes = new Uint8Array([0, 255, 128, 10, 13, 200]);
    stubProxy(
      await toEnvelope(
        new Response(bytes, { headers: { "content-type": "video/mp4" } }),
        "https://www.tiktok.com/v.mp4",
        "base64",
      ),
    );

    const response = await egressFetch(config, {
      url: "https://www.tiktok.com/v.mp4",
    });

    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("keeps a redirect as a redirect, location included", async () => {
    stubProxy(
      await upstreamEnvelope(301, "", { location: "https://www.tiktok.com/a" }),
    );
    const response = await egressFetch(config, {
      url: "https://vm.tiktok.com/x",
      method: "HEAD",
    });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://www.tiktok.com/a");
  });

  it("builds a body-less response for a status that cannot carry one", async () => {
    stubProxy(
      Response.json({
        ok: true,
        status: 304,
        url: "https://u.test/",
        headers: {},
        encoding: "utf8",
        body: "",
        bytes: 0,
      }),
    );
    const response = await egressFetch(config, { url: "https://tikwm.com/x" });
    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });
});

describe("error mapping", () => {
  async function failure(reply: Response | Error): Promise<EgressError> {
    stubProxy(reply);
    const error = await egressFetch(config, {
      url: "https://tikwm.com/x",
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(EgressError);
    return error as EgressError;
  }

  it.each([
    [400, "bad_request"],
    [401, "unauthorized"],
    [403, "host_not_allowed"],
    [413, "payload_too_large"],
  ])("treats %i %s as a hard failure", async (status, code) => {
    const error = await failure(proxyError(status, code, "why").response);
    expect(error).toMatchObject({
      kind: "hard",
      status,
      code,
      message: "why",
    });
  });

  it("treats 429 and 503 as a backoff for Retry-After", async () => {
    expect(
      await failure(
        proxyError(429, "rate_limited", "slow down", { "Retry-After": "42" })
          .response,
      ),
    ).toMatchObject({ kind: "backoff", status: 429, retryAfterSeconds: 42 });
    expect(
      await failure(
        proxyError(503, "busy", "busy", { "Retry-After": "5" }).response,
      ),
    ).toMatchObject({ kind: "backoff", status: 503, retryAfterSeconds: 5 });
    // No Retry-After: the guard's own exponential backoff applies.
    expect(
      (await failure(proxyError(503, "busy").response)).retryAfterSeconds,
    ).toBeUndefined();
  });

  it.each([
    "upstream_timeout",
    "upstream_error",
    "upstream_too_large",
    "dns_failed",
    "too_many_redirects",
  ])("treats 424 %s as transient", async (code) => {
    expect(await failure(proxyError(424, code).response)).toMatchObject({
      kind: "transient",
      status: 424,
      code,
    });
  });

  it("treats a Cloudflare error page, a network error and a bad envelope as transient", async () => {
    expect(
      await failure(
        new Response("<html>error code: 1033</html>", {
          status: 530,
          headers: { "content-type": "text/html" },
        }),
      ),
    ).toMatchObject({ kind: "transient" });
    expect(
      await failure(new Response("<html>ok?</html>", { status: 200 })),
    ).toMatchObject({ kind: "transient" });
    expect(await failure(new TypeError("fetch failed"))).toMatchObject({
      kind: "transient",
      message: "fetch failed",
    });
    expect(
      await failure(Response.json({ ok: true, status: 200, body: "{}" })),
    ).toMatchObject({ kind: "transient" });
    expect(
      await failure(
        Response.json({ ok: true, status: 99, encoding: "utf8", body: "" }),
      ),
    ).toMatchObject({ kind: "transient" });
  });

  it("reports /resolve's refused redirect with the location it would not follow", async () => {
    stubProxy(
      new Response(
        JSON.stringify({
          ok: false,
          error: "redirect_not_allowed",
          message: "no",
          location: "https://evil.example/",
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      ),
    );
    const error = await egressResolve(config, {
      url: "https://vm.tiktok.com/x",
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      kind: "refused",
      code: "redirect_not_allowed",
      location: "https://evil.example/",
    });
  });
});

describe("disabled client", () => {
  it.each([{}, { EGRESS_PROXY_SECRET: "" }, { EGRESS_PROXY_SECRET: "  " }])(
    "is off without a secret and never touches the network",
    async (env) => {
      const proxy = stubProxy(await upstreamEnvelope(200, "{}"));
      expect(egressEnabled(env)).toBe(false);
      await expect(
        egressFetch(env, { url: "https://tikwm.com/x" }),
      ).rejects.toBeInstanceOf(EgressDisabledError);
      await expect(
        egressResolve(env, { url: "https://vm.tiktok.com/x" }),
      ).rejects.toBeInstanceOf(EgressDisabledError);
      expect(proxy.fetchMock).not.toHaveBeenCalled();
    },
  );

  it("is on with a secret", () => {
    expect(egressEnabled(config)).toBe(true);
  });
});

describe("guarded calls", () => {
  const request = {
    url: "https://www.tiktok.com/player/api/v1/items?item_ids=1",
  };

  it("pauses the whole proxy for Retry-After after a 429, without calling it again", async () => {
    const proxy = stubProxy(
      proxyError(429, "rate_limited", "slow", { "Retry-After": "90" }).response,
    );

    await expect(
      guardedEgressFetch(config, "tiktok-player-api", request),
    ).rejects.toMatchObject({ kind: "backoff" });
    const remaining = upstreamGuard.remainingMs(EGRESS_PROXY_CIRCUIT);
    expect(remaining).toBeGreaterThan(85_000);
    expect(remaining).toBeLessThanOrEqual(90_000);

    // Any provider is held back, and the proxy is not asked.
    await expect(
      guardedEgressFetch(config, "tikwm", request),
    ).rejects.toBeInstanceOf(UpstreamBlockedError);
    expect(proxy.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("logs a rejected request once and does not retry it in a loop", async () => {
    const proxy = stubProxy(proxyError(403, "host_not_allowed", "no").response);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    for (let attempt = 0; attempt < 5; attempt++) {
      await guardedEgressFetch(config, "tikwm", request).catch(() => {});
    }

    expect(proxy.fetchMock).toHaveBeenCalledTimes(1);
    const refusals = errors.mock.calls.filter((call) =>
      JSON.stringify(call).includes("The egress proxy refused a request"),
    );
    expect(refusals).toHaveLength(1);
    expect(JSON.stringify(refusals[0])).toContain("host_not_allowed");
    expect(JSON.stringify(errors.mock.calls)).not.toContain(EGRESS_TEST_SECRET);
    expect(upstreamGuard.remainingMs(EGRESS_PROXY_CIRCUIT)).toBeGreaterThan(
      5 * 60_000,
    );
  });

  it("counts 424s against the provider's own @egress circuit, not the proxy's", async () => {
    const proxy = stubProxy(proxyError(424, "upstream_timeout").response);

    for (let attempt = 0; attempt < 3; attempt++) {
      await guardedEgressFetch(config, "tikwm", request).catch(() => {});
    }
    await expect(
      guardedEgressFetch(config, "tikwm", request),
    ).rejects.toBeInstanceOf(UpstreamBlockedError);

    expect(proxy.fetchMock).toHaveBeenCalledTimes(3);
    expect(
      upstreamGuard.remainingMs(egressProviderName("tikwm")),
    ).toBeGreaterThan(0);
    expect(upstreamGuard.remainingMs(EGRESS_PROXY_CIRCUIT)).toBe(0);
  });

  it("opens only the @egress circuit when the upstream itself answers 429", async () => {
    stubProxy(await upstreamEnvelope(429, "", { "retry-after": "60" }));

    const response = await guardedEgressFetch(config, "tikwm", request);

    expect(response.status).toBe(429);
    expect(
      upstreamGuard.remainingMs(egressProviderName("tikwm")),
    ).toBeGreaterThan(55_000);
    expect(upstreamGuard.remainingMs("tikwm")).toBe(0);
    expect(upstreamGuard.remainingMs(EGRESS_PROXY_CIRCUIT)).toBe(0);
  });

  it("keeps the direct and proxy circuits of a provider apart", async () => {
    stubProxy(await upstreamEnvelope(200, "{}"));
    // The direct path is blocked ...
    upstreamGuard.trip("tiktok-player-api", 120);
    expect(upstreamGuard.remainingMs("tiktok-player-api")).toBeGreaterThan(0);

    // ... and the proxy path for the same provider still works.
    const response = await guardedEgressFetch(
      config,
      "tiktok-player-api",
      request,
    );
    expect(response.status).toBe(200);
  });
});
