// Test doubles for the house egress proxy. `stubTikTokNetwork` stands in for
// the whole network: requests to the proxy are checked (signature, timestamp,
// nonce, allowlisted headers) and answered from the `egress` route table
// wrapped in the proxy's envelope; everything else comes from `direct`.
import { createHmac } from "node:crypto";
import { env } from "cloudflare:workers";
import { vi } from "vitest";

export const EGRESS_TEST_SECRET = "egress-test-secret-not-real";
export const EGRESS_TEST_URL = "https://egress.115jon.com";

const workerEnv = env as unknown as Record<string, unknown>;

export function enableEgress(secret = EGRESS_TEST_SECRET): void {
  workerEnv.EGRESS_PROXY_SECRET = secret;
  delete workerEnv.EGRESS_PROXY_URL;
}

export function disableEgress(): void {
  delete workerEnv.EGRESS_PROXY_SECRET;
  delete workerEnv.EGRESS_PROXY_URL;
}

export function hmacHex(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret)
    .update(`${timestamp}\n${body}`)
    .digest("hex");
}

/** A proxy answer sent as-is (an error, or a hand-built envelope). */
export class RawProxyReply {
  constructor(readonly response: Response) {}
}

export function proxyError(
  status: number,
  error: string,
  message = error,
  headers: Record<string, string> = {},
): RawProxyReply {
  return new RawProxyReply(
    new Response(JSON.stringify({ ok: false, error, message }), {
      status,
      headers: { "content-type": "application/json", ...headers },
    }),
  );
}

const FORWARDED = ["content-type", "cache-control", "location", "retry-after"];

/** What the proxy sends for an upstream answer. */
export async function toEnvelope(
  upstream: Response,
  url: string,
  encoding: "utf8" | "base64" = "utf8",
): Promise<Response> {
  const bytes = new Uint8Array(await upstream.arrayBuffer());
  const headers: Record<string, string> = {};
  for (const name of FORWARDED) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  return Response.json({
    ok: true,
    status: upstream.status,
    url,
    headers,
    encoding,
    body:
      encoding === "base64"
        ? Buffer.from(bytes).toString("base64")
        : new TextDecoder().decode(bytes),
    bytes: bytes.length,
    cached: false,
    dropped_headers: [],
  });
}

export type Route = (
  url: string,
  init?: RequestInit,
) => Response | RawProxyReply | Promise<Response | RawProxyReply>;

export interface Routes {
  shortLink?: Route;
  player?: Route;
  page?: Route;
  tikwm?: Route;
}

type Network = "direct" | "egress";

function pick(routes: Routes, url: string): Route | undefined {
  if (url.includes("/t/") || url.includes("vm.tiktok.com")) {
    return routes.shortLink;
  }
  if (url.includes("/player/api/v1/items")) return routes.player;
  if (url.includes("tikwm.com/api/")) return routes.tikwm;
  if (/tiktok\.com\/@[^/]+\/(video|photo)\//.test(url)) return routes.page;
  return undefined;
}

/** A TikTok request that reached a network, as the upstream would see it. */
export interface RecordedCall {
  network: Network;
  url: string;
  method: string;
  /** Headers the proxy was asked to forward (egress only). */
  headers?: Record<string, string>;
}

export function stubTikTokNetwork(tables: {
  direct?: Routes;
  egress?: Routes;
  /** Answer every proxy call with this instead of the egress routes. */
  proxyOverride?: () => Response | Promise<Response>;
}) {
  const calls: RecordedCall[] = [];
  const proxyRequests: Array<{ path: string; body: string }> = [];

  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();

      if (url.startsWith(EGRESS_TEST_URL)) {
        const path = new URL(url).pathname;
        const body = String(init?.body ?? "");
        proxyRequests.push({ path, body });
        if (tables.proxyOverride) return tables.proxyOverride();

        const headers = new Headers(init?.headers);
        const timestamp = headers.get("X-Egress-Timestamp") ?? "";
        const signature = headers.get("X-Egress-Signature") ?? "";
        const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
        if (
          signature !== hmacHex(EGRESS_TEST_SECRET, timestamp, body) ||
          !(skew <= 60)
        ) {
          return proxyError(401, "bad_signature", "bad signature").response;
        }
        const payload = JSON.parse(body) as {
          url: string;
          method?: string;
          headers?: Record<string, string>;
          nonce?: string;
        };
        if (!/^[0-9a-f]{32}$/.test(payload.nonce ?? "")) {
          return proxyError(400, "bad_request", "nonce").response;
        }
        calls.push({
          network: "egress",
          url: payload.url,
          method: path === "/resolve" ? "RESOLVE" : (payload.method ?? "GET"),
          headers: payload.headers,
        });
        const route = tables.egress && pick(tables.egress, payload.url);
        if (!route) {
          return proxyError(403, "host_not_allowed", payload.url).response;
        }
        const answer = await route(payload.url);
        if (answer instanceof RawProxyReply) return answer.response.clone();
        if (path === "/resolve") {
          return Response.json({
            ok: true,
            url: answer.url || payload.url,
            status: answer.status,
            hops: 1,
          });
        }
        return toEnvelope(answer, payload.url);
      }

      calls.push({
        network: "direct",
        url,
        method: init?.method ?? "GET",
      });
      const route = tables.direct && pick(tables.direct, url);
      if (!route) return new Response("unexpected", { status: 418 });
      const answer = await route(url, init);
      if (answer instanceof RawProxyReply) return answer.response;
      return answer;
    },
  );
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

  return {
    calls,
    proxyRequests,
    fetchMock,
    count: (network: Network, fragment = "") =>
      calls.filter(
        (call) => call.network === network && call.url.includes(fragment),
      ).length,
  };
}

/** A response whose `url` is where a followed redirect ended. */
export function redirectedTo(url: string): Response {
  const response = new Response(null, { status: 200 });
  Object.defineProperty(response, "url", { value: url });
  return response;
}
