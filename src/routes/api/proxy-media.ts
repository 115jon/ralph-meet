import { createFileRoute } from "@tanstack/react-router";
import { cacheFetch } from "@/lib/cache";
import { clog } from "@/lib/console-logger";
import { fetchTikTokProxyMetadata } from "@/lib/share-preview-proxy";
import type { EmbedInfo } from "@/lib/types";
import { extractAndProcessEmbeds } from "@/services/embed-fetcher";

const log = clog("proxy-media");

const ALLOWED_HOSTS = new Set([
  "video.twimg.com",
  "pbs.twimg.com",
  "vxtwitter.com",
  "static.klipy.com",
  "tenor.com",
  "media.tenor.com",
]);

const X_SOURCE_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "fxtwitter.com",
  "d.fxtwitter.com",
  "fixupx.com",
  "d.fixupx.com",
  "vxtwitter.com",
  "d.vxtwitter.com",
  "fixvx.com",
  "d.fixvx.com",
]);

const TIKTOK_REFRESH_TTL = 50 * 60;
const X_REFRESH_TTL = 20 * 60;

interface RefreshableMediaCandidate {
  type: "image" | "video";
  url: string;
  thumbnailUrl?: string;
}

export function isAllowedMediaUrl(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const hostname = url.hostname.toLowerCase();
  if (ALLOWED_HOSTS.has(hostname)) return true;

  if (hostname === "vxtwitter.com") {
    return url.pathname.startsWith("/tvid/");
  }

  return (
    hostname.endsWith(".klipy.com") ||
    hostname.endsWith(".tenor.com") ||
    hostname === "api16-normal-useast5.tiktokv.us" ||
    hostname.endsWith(".tiktokv.us") ||
    hostname.endsWith(".tiktokcdn-us.com") ||
    hostname.endsWith(".tiktokcdn.com") ||
    hostname.includes("tiktok.com")
  );
}

async function makeSyntheticRangeResponse(upstream: Response, range: string): Promise<Response | null> {
  if (upstream.status !== 200) return null;

  const match = range.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  const contentLength = Number(upstream.headers.get("Content-Length"));
  if (!Number.isFinite(contentLength) || contentLength <= 0) return null;

  const startText = match[1];
  const endText = match[2];
  let start: number;
  let end: number;

  if (!startText && endText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, contentLength - suffixLength);
    end = contentLength - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : contentLength - 1;
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= contentLength
  ) {
    const headers = new Headers();
    headers.set("Content-Range", `bytes */${contentLength}`);
    headers.set("Accept-Ranges", "bytes");
    return new Response(null, { status: 416, headers });
  }

  end = Math.min(end, contentLength - 1);
  const bytes = new Uint8Array(await upstream.arrayBuffer());
  const sliced = bytes.slice(start, end + 1);
  const headers = buildProxyHeaders(upstream.headers, upstream.url);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Range", `bytes ${start}-${end}/${contentLength}`);
  headers.set("Content-Length", sliced.byteLength.toString());
  headers.set("Cache-Control", "no-store");

  return new Response(sliced, {
    status: 206,
    statusText: "Partial Content",
    headers,
  });
}

export function inferMediaContentType(contentType: string | null, sourceUrl?: string): string {
  const normalized = contentType?.split(";")[0].trim().toLowerCase();
  if (normalized?.startsWith("video/") || normalized?.startsWith("image/")) {
    return contentType || normalized;
  }

  if (sourceUrl) {
    try {
      const parsedUrl = new URL(sourceUrl);
      const hostname = parsedUrl.hostname.toLowerCase();
      const pathname = parsedUrl.pathname.toLowerCase();
      if (hostname === "video.twimg.com") {
        return "video/mp4";
      }
      if (
        hostname === "vxtwitter.com" &&
        pathname.startsWith("/tvid/") &&
        (pathname.includes("/vid/") ||
          pathname.includes("/amplify_video/") ||
          pathname.includes("/ext_tw_video/") ||
          pathname.includes("/tweet_video/"))
      ) {
        return "video/mp4";
      }
      if (pathname.endsWith(".mp4") || pathname.includes("/mp4/") || pathname.includes("/avc1/")) {
        return "video/mp4";
      }
      if (pathname.includes("/video/") || pathname.includes("/aweme/v1/play/")) {
        return "video/mp4";
      }
      if (pathname.endsWith(".webm")) return "video/webm";
      if (pathname.endsWith(".ogg")) return "video/ogg";
      if (pathname.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
      if (pathname.match(/\.(jpe?g|png|gif|webp)$/)) {
        const extension = pathname.split(".").pop();
        return extension === "jpg" ? "image/jpeg" : `image/${extension}`;
      }
    } catch {
      // Fall through to octet-stream.
    }
  }

  return "application/octet-stream";
}

export function normalizeRefreshableMediaKey(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();

    if (
      hostname === "video.twimg.com" ||
      hostname === "pbs.twimg.com" ||
      hostname.endsWith(".tiktokcdn-us.com") ||
      hostname.endsWith(".tiktokcdn.com") ||
      hostname.endsWith(".tiktokv.us")
    ) {
      return `${hostname}${parsed.pathname}`;
    }

    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function pickRefreshedMediaUrl(candidates: RefreshableMediaCandidate[], requestUrl: string): string | null {
  if (candidates.length === 0) return null;

  const requestKey = normalizeRefreshableMediaKey(requestUrl);
  for (const candidate of candidates) {
    if (normalizeRefreshableMediaKey(candidate.url) === requestKey) {
      return candidate.url;
    }
    if (candidate.thumbnailUrl && normalizeRefreshableMediaKey(candidate.thumbnailUrl) === requestKey) {
      return candidate.thumbnailUrl;
    }
  }

  const requestedType = inferMediaContentType(null, requestUrl);
  if (requestedType.startsWith("video/")) {
    return candidates.find((candidate) => candidate.type === "video")?.url ?? null;
  }
  if (requestedType.startsWith("image/")) {
    return candidates.find((candidate) => candidate.thumbnailUrl)?.thumbnailUrl
      ?? candidates.find((candidate) => candidate.type === "image")?.url
      ?? null;
  }

  return candidates[0]?.url ?? null;
}

function buildProxyHeaders(upstreamHeaders: Headers, sourceUrl?: string): Headers {
  const headers = new Headers();
  const passthroughHeaders = [
    "Accept-Ranges",
    "Cache-Control",
    "Content-Length",
    "Content-Range",
    "Content-Type",
    "ETag",
    "Last-Modified",
  ];

  for (const header of passthroughHeaders) {
    const value = upstreamHeaders.get(header);
    if (value) headers.set(header, value);
  }

  const contentType = inferMediaContentType(headers.get("Content-Type"), sourceUrl);
  headers.set("Content-Type", contentType);

  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("Referrer-Policy", "no-referrer");
  if (!contentType.startsWith("video/") && !contentType.startsWith("image/")) {
    headers.set("X-Content-Type-Options", "nosniff");
  }

  return headers;
}

function summarizeUrlForLog(value: string | URL) {
  try {
    const url = typeof value === "string" ? new URL(value) : value;
    return {
      protocol: url.protocol,
      hostname: url.hostname,
      pathname: url.pathname,
      queryKeys: Array.from(url.searchParams.keys()).slice(0, 12),
    };
  } catch {
    return { invalid: true };
  }
}

function isTikTokSourceUrl(url: URL): boolean {
  return url.hostname.toLowerCase().includes("tiktok.com");
}

function isXSourceUrl(url: URL): boolean {
  return X_SOURCE_HOSTS.has(url.hostname.toLowerCase());
}

function canonicalizeTikTokUrl(url: URL): string {
  return `https://www.tiktok.com${url.pathname}`;
}

function canonicalizeXUrl(url: URL): string {
  const parts = url.pathname.split("/").filter(Boolean);
  const statusIndex = parts.findIndex((part) => part === "status");
  if (statusIndex <= 0 || !parts[statusIndex + 1]) {
    return url.toString();
  }
  return `https://x.com/${parts[statusIndex - 1]}/status/${parts[statusIndex + 1]}`;
}

function collectXRefreshCandidates(embeds: EmbedInfo[]): RefreshableMediaCandidate[] {
  const candidates: RefreshableMediaCandidate[] = [];
  const seen = new Set<string>();

  const push = (type: "image" | "video", url?: string, thumbnailUrl?: string) => {
    if (!url) return;
    const dedupeKey = `${type}:${normalizeRefreshableMediaKey(url)}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    candidates.push({ type, url, thumbnailUrl });
  };

  for (const embed of embeds) {
    if (Array.isArray(embed.media) && embed.media.length > 0) {
      for (const media of embed.media) {
        push(media.type, media.url, media.thumbnailUrl ?? embed.thumbnail?.url);
      }
    } else if (embed.video?.url && embed.video.kind !== "player") {
      push("video", embed.video.url, embed.thumbnail?.url);
    }

    if (embed.thumbnail?.url) {
      push("image", embed.thumbnail.url);
    }

    for (const media of embed.referencedTweet?.media ?? []) {
      push(media.type, media.url, media.thumbnailUrl);
    }
  }

  return candidates;
}

async function resolveRefreshedMediaUrl(sourceUrlText: string, requestUrl: string): Promise<string | null> {
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(sourceUrlText);
  } catch {
    return null;
  }

  if (isTikTokSourceUrl(sourceUrl)) {
    const canonicalUrl = canonicalizeTikTokUrl(sourceUrl);
    const cacheKey = `v1:proxy-media:tiktok:${canonicalUrl}`;
    const metadata = await cacheFetch<{ videoUrl: string | null; coverUrl: string | null }>(
      cacheKey,
      TIKTOK_REFRESH_TTL,
      async () => {
        const refreshed = await fetchTikTokProxyMetadata(canonicalUrl);
        return {
          videoUrl: refreshed?.videoUrl ?? null,
          coverUrl: refreshed?.coverUrl ?? null,
        };
      }
    );
    // If the request URL is a player URL or explicit video request, prefer videoUrl.
    const isVideoRequest = 
      inferMediaContentType(null, requestUrl).startsWith("video/") || 
      requestUrl.includes("/player/");
    return isVideoRequest
      ? (metadata.videoUrl ?? metadata.coverUrl)
      : (metadata.coverUrl ?? metadata.videoUrl);
  }

  if (isXSourceUrl(sourceUrl)) {
    const canonicalUrl = canonicalizeXUrl(sourceUrl);
    const cacheKey = `v1:proxy-media:x:${canonicalUrl}`;
    const candidates = await cacheFetch<RefreshableMediaCandidate[]>(
      cacheKey,
      X_REFRESH_TTL,
      async () => collectXRefreshCandidates(await extractAndProcessEmbeds(canonicalUrl))
    );
    return pickRefreshedMediaUrl(candidates, requestUrl);
  }

  return null;
}

async function proxyMedia(request: Request, includeBody: boolean): Promise<Response> {
  const requestUrl = new URL(request.url);
  const mediaUrlParam = requestUrl.searchParams.get("url");
  const sourceUrlParam = requestUrl.searchParams.get("sourceUrl");

  if (!mediaUrlParam) {
    return new Response("Missing media URL", { status: 400 });
  }

  let mediaUrl: URL;
  try {
    mediaUrl = new URL(mediaUrlParam);
  } catch {
    return new Response("Invalid media URL", { status: 400 });
  }

  if (!isAllowedMediaUrl(mediaUrl)) {
    return new Response("Unsupported media URL", { status: 400 });
  }

  const upstreamHeaders = new Headers();
  upstreamHeaders.set(
    "User-Agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  );
  upstreamHeaders.set("Accept", request.headers.get("Accept") || "video/*,*/*;q=0.8");
  upstreamHeaders.set("Accept-Language", "en-US,en;q=0.9");

  const hostname = mediaUrl.hostname.toLowerCase();
  if (hostname.includes("tiktok")) {
    upstreamHeaders.set("Referer", "https://www.tiktok.com/");
    upstreamHeaders.set("Origin", "https://www.tiktok.com");
  } else if (hostname === "video.twimg.com" || hostname === "pbs.twimg.com") {
    upstreamHeaders.set("Referer", "https://x.com/");
    upstreamHeaders.set("Origin", "https://x.com");
  }

  const range = request.headers.get("Range");
  if (range) {
    upstreamHeaders.set("Range", range);
  }

  const fetchUpstream = (targetUrl: string) => fetch(targetUrl, {
    method: includeBody ? "GET" : "HEAD",
    headers: upstreamHeaders,
    redirect: "follow",
  });

  let upstream: Response | null = null;
  
  // For TikTok player URLs, directly resolve to the raw CDN URL first to avoid fetching HTML
  if (isTikTokSourceUrl(mediaUrl) && !mediaUrl.hostname.includes("tiktokcdn")) {
    const refreshedUrl = await resolveRefreshedMediaUrl(sourceUrlParam || mediaUrl.toString(), mediaUrl.toString());
    if (refreshedUrl) {
      upstream = await fetchUpstream(refreshedUrl);
    }
  }

  if (!upstream) {
    upstream = await fetchUpstream(mediaUrl.toString());
  }

  if (!upstream.ok && sourceUrlParam) {
    const refreshedUrl = await resolveRefreshedMediaUrl(sourceUrlParam, mediaUrl.toString());
    if (refreshedUrl && refreshedUrl !== mediaUrl.toString()) {
      upstream = await fetchUpstream(refreshedUrl);
    }
  }

  if ((hostname.includes("tiktok") || hostname === "video.twimg.com" || hostname === "pbs.twimg.com") && !upstream.ok) {
    log.warn("External media upstream failure", {
      status: upstream.status,
      statusText: upstream.statusText,
      method: includeBody ? "GET" : "HEAD",
      range,
      source: summarizeUrlForLog(mediaUrl),
      refreshSource: sourceUrlParam ? summarizeUrlForLog(sourceUrlParam) : null,
      finalUrl: upstream.url ? summarizeUrlForLog(upstream.url) : null,
      contentType: upstream.headers.get("Content-Type"),
      contentLength: upstream.headers.get("Content-Length"),
    });
  }

  if (includeBody && range) {
    const syntheticRange = await makeSyntheticRangeResponse(upstream.clone(), range);
    if (syntheticRange) return syntheticRange;
  }

  const headers = buildProxyHeaders(upstream.headers, upstream.url || mediaUrl.toString());
  if (range || headers.get("Content-Type")?.startsWith("video/")) {
    headers.set("Cache-Control", "no-store");
  }

  return new Response(includeBody ? upstream.body : null, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

const GET = async ({ request }: { request: Request }) => proxyMedia(request, true);
const HEAD = async ({ request }: { request: Request }) => proxyMedia(request, false);

export const Route = createFileRoute("/api/proxy-media")({
  server: {
    handlers: {
      GET,
      HEAD,
    },
  },
});
