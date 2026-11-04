// ── youtube-fetch ───────────────────────────────────────────────────────────
// `fetch` for Listen Together's YouTube traffic. YouTube answers Cloudflare's
// shared IPs with LOGIN_REQUIRED ("confirm you're not a bot"), so when the
// house egress proxy is configured the Innertube / watch-page requests go
// through its VPN exit (`/fetch`). A googlevideo media URL is bound to the IP
// that resolved it, so the media bytes go through the same exit (`/stream`).
//
// With no `EGRESS_PROXY_SECRET` (local dev, Worker Previews) and for any other
// host, this is plain `fetch`.
//
// A proxy failure throws a `TypeError`, the shape of a failed network fetch,
// so the callers' existing `catch` blocks handle it. It is never a `Response`
// with a 429 or a "not a bot" payload, so an outage cannot look like a YouTube
// bot check (`YouTubeBotCheckError`) and does not trip the `youtube-player`
// circuit.

import { env } from "cloudflare:workers";
import {
  EgressError,
  egressEnabled,
  egressFetch,
  egressStream,
} from "@/lib/egress-proxy";

const YOUTUBE_API_HOSTS: ReadonlySet<string> = new Set([
  "www.youtube.com",
  "youtubei.googleapis.com",
]);

function isGooglevideoHost(hostname: string): boolean {
  return hostname.endsWith(".googlevideo.com");
}

function headersToRecord(
  headers: HeadersInit | undefined,
): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries());
}

function proxyFailure(error: unknown): Error {
  if (error instanceof EgressError) {
    return new TypeError(
      `YouTube egress proxy failed (${error.kind}${error.code ? `: ${error.code}` : ""}): ${error.message}`,
      { cause: error },
    );
  }
  return error instanceof Error ? error : new TypeError(String(error));
}

export async function youtubeFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!egressEnabled(env)) return fetch(input, init);

  const url = new URL(input);
  const hostname = url.hostname.toLowerCase();
  const isMedia = url.protocol === "https:" && isGooglevideoHost(hostname);
  const isApi = url.protocol === "https:" && YOUTUBE_API_HOSTS.has(hostname);
  if (!isMedia && !isApi) return fetch(input, init);

  const method = (init?.method ?? "GET").toUpperCase();
  const headers = headersToRecord(init?.headers);
  const signal = init?.signal ?? undefined;

  try {
    if (isMedia) {
      if (method !== "GET") {
        throw new TypeError(`Unsupported googlevideo method ${method}`);
      }
      return await egressStream(
        env,
        { url: url.toString(), headers },
        { signal },
      );
    }

    if (method !== "GET" && method !== "HEAD" && method !== "POST") {
      throw new TypeError(`Unsupported YouTube method ${method}`);
    }
    const body = init?.body;
    if (body != null && typeof body !== "string") {
      throw new TypeError("The egress proxy only takes string request bodies");
    }
    return await egressFetch(
      env,
      {
        url: url.toString(),
        method,
        headers,
        body: body ?? undefined,
      },
      { signal },
    );
  } catch (error) {
    throw proxyFailure(error);
  }
}
