import { createFileRoute } from "@tanstack/react-router";
import { cacheFetch, cacheGet, cacheSet } from "@/lib/cache";
import { clog } from "@/lib/console-logger";
import { fetchInstagramOEmbedMetadata, fetchInstagramVideoMetadata, fetchTikTokProxyMetadata } from "@/lib/share-preview-proxy";
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
  "lh3.googleusercontent.com",
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
const TIKTOK_REFRESH_SAFETY_WINDOW = 5 * 60;
const X_REFRESH_TTL = 20 * 60;
const INSTAGRAM_REFRESH_TTL = 20 * 60;

interface RefreshableMediaCandidate {
  type: "image" | "video" | "audio";
  url: string;
  thumbnailUrl?: string;
}

interface ResolveRefreshedMediaOptions {
  forceRefresh?: boolean;
}

const TIKTOK_PROXY_RESPONSE_TTL = 5 * 60;

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
    hostname.endsWith(".googleusercontent.com") ||
    hostname.endsWith(".cdninstagram.com") ||
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
  if (
    normalized?.startsWith("video/")
    || normalized?.startsWith("image/")
    || normalized?.startsWith("audio/")
  ) {
    return contentType || normalized;
  }

  if (sourceUrl) {
    try {
      const parsedUrl = new URL(sourceUrl);
      const hostname = parsedUrl.hostname.toLowerCase();
      const pathname = parsedUrl.pathname.toLowerCase();
      const mimeType = parsedUrl.searchParams.get("mime_type")?.toLowerCase();
      if (mimeType?.startsWith("audio/") || mimeType?.startsWith("video/")) {
        return mimeType;
      }
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
      if (pathname.endsWith(".mp3")) return "audio/mpeg";
      if (pathname.endsWith(".m4a")) return "audio/mp4";
      if (pathname.endsWith(".aac")) return "audio/aac";
      if (pathname.endsWith(".wav")) return "audio/wav";
      if (pathname.endsWith(".oga") || pathname.endsWith(".opus")) return "audio/ogg";
      if (pathname.includes("/audio/")) return "audio/mpeg";
      if (pathname.endsWith(".webm")) return "video/webm";
      if (pathname.endsWith(".ogg")) return "video/ogg";
      if (pathname.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
      if (pathname.match(/\.(jpe?g|png|gif|webp)$/)) {
        const extension = pathname.split(".").pop();
        return extension === "jpg" ? "image/jpeg" : `image/${extension}`;
      }
      if (hostname.endsWith(".googleusercontent.com")) {
        return "image/jpeg";
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
      hostname.endsWith(".cdninstagram.com") ||
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

function normalizeRefreshableMediaLooseKey(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();

    if (
      hostname.endsWith(".tiktokcdn-us.com") ||
      hostname.endsWith(".tiktokcdn.com") ||
      hostname.endsWith(".tiktokv.us")
    ) {
      return parsed.pathname;
    }

    return normalizeRefreshableMediaKey(rawUrl);
  } catch {
    return rawUrl;
  }
}

function pushUniqueUrl(target: string[], seen: Set<string>, url?: string | null) {
  if (!url || seen.has(url)) return;
  seen.add(url);
  target.push(url);
}

export function pickRefreshedMediaUrls(candidates: RefreshableMediaCandidate[], requestUrl: string): string[] {
  if (candidates.length === 0) return [];

  const results: string[] = [];
  const seen = new Set<string>();
  const requestKey = normalizeRefreshableMediaKey(requestUrl);
  const requestLooseKey = normalizeRefreshableMediaLooseKey(requestUrl);

  for (const candidate of candidates) {
    if (normalizeRefreshableMediaKey(candidate.url) === requestKey) {
      pushUniqueUrl(results, seen, candidate.url);
    }
    if (candidate.thumbnailUrl && normalizeRefreshableMediaKey(candidate.thumbnailUrl) === requestKey) {
      pushUniqueUrl(results, seen, candidate.thumbnailUrl);
    }
  }

  if (requestLooseKey !== requestKey) {
    for (const candidate of candidates) {
      if (normalizeRefreshableMediaLooseKey(candidate.url) === requestLooseKey) {
        pushUniqueUrl(results, seen, candidate.url);
      }
      if (candidate.thumbnailUrl && normalizeRefreshableMediaLooseKey(candidate.thumbnailUrl) === requestLooseKey) {
        pushUniqueUrl(results, seen, candidate.thumbnailUrl);
      }
    }
  }

  const requestedType = inferMediaContentType(null, requestUrl);
  if (requestedType.startsWith("video/")) {
    for (const candidate of candidates) {
      if (candidate.type === "video") {
        pushUniqueUrl(results, seen, candidate.url);
      }
    }
    return results;
  }

  if (requestedType.startsWith("audio/")) {
    for (const candidate of candidates) {
      if (candidate.type === "audio") {
        pushUniqueUrl(results, seen, candidate.url);
      }
    }
    return results;
  }

  if (requestedType.startsWith("image/")) {
    for (const candidate of candidates) {
      if (candidate.type === "image") {
        pushUniqueUrl(results, seen, candidate.url);
      }
    }
    for (const candidate of candidates) {
      pushUniqueUrl(results, seen, candidate.thumbnailUrl);
    }
    return results;
  }

  for (const candidate of candidates) {
    pushUniqueUrl(results, seen, candidate.url);
    pushUniqueUrl(results, seen, candidate.thumbnailUrl);
  }

  return results;
}

export function pickRefreshedMediaUrl(candidates: RefreshableMediaCandidate[], requestUrl: string): string | null {
  return pickRefreshedMediaUrls(candidates, requestUrl)[0] ?? null;
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
  if (
    !contentType.startsWith("video/")
    && !contentType.startsWith("image/")
    && !contentType.startsWith("audio/")
  ) {
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

function readUrlExpiryEpochSeconds(rawUrl: string, queryKey: string): number | null {
  try {
    const parsed = new URL(rawUrl);
    const rawValue = parsed.searchParams.get(queryKey);
    if (!rawValue) return null;
    const parsedValue = Number(rawValue);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
  } catch {
    return null;
  }
}

function isTikTokUrlExpiringSoon(rawUrl: string): boolean {
  const expiry = readUrlExpiryEpochSeconds(rawUrl, "x-expires");
  if (!expiry) return false;
  return expiry - Math.floor(Date.now() / 1000) <= TIKTOK_REFRESH_SAFETY_WINDOW;
}

function getTikTokRefreshCacheTtl(candidates: RefreshableMediaCandidate[]): number {
  const expiries = candidates.flatMap((candidate) => {
    const nextExpiries = [
      readUrlExpiryEpochSeconds(candidate.url, "x-expires"),
      candidate.thumbnailUrl ? readUrlExpiryEpochSeconds(candidate.thumbnailUrl, "x-expires") : null,
    ].filter((value): value is number => value !== null);
    return nextExpiries;
  });

  if (expiries.length === 0) return TIKTOK_REFRESH_TTL;

  const earliestExpiry = Math.min(...expiries);
  const secondsUntilRefresh = earliestExpiry - Math.floor(Date.now() / 1000) - TIKTOK_REFRESH_SAFETY_WINDOW;
  return Math.max(60, Math.min(TIKTOK_REFRESH_TTL, secondsUntilRefresh));
}

function areTikTokRefreshCandidatesStillFresh(candidates: RefreshableMediaCandidate[]): boolean {
  if (candidates.length === 0) return false;
  return getTikTokRefreshCacheTtl(candidates) > 60;
}

function getTikTokProxyCacheControl(rawUrl: string, status: number, contentType?: string | null): string {
  if (status >= 400) return "no-store";
  if (contentType?.startsWith("video/")) return "no-store";

  const expiry = readUrlExpiryEpochSeconds(rawUrl, "x-expires");
  if (!expiry) {
    return "private, max-age=60";
  }

  const secondsUntilRefresh = expiry - Math.floor(Date.now() / 1000) - TIKTOK_REFRESH_SAFETY_WINDOW;
  const ttl = Math.max(30, Math.min(TIKTOK_PROXY_RESPONSE_TTL, secondsUntilRefresh));
  return `private, max-age=${ttl}`;
}

function isTikTokMediaUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return (
    hostname === "api16-normal-useast5.tiktokv.us" ||
    hostname.endsWith(".tiktokv.us") ||
    hostname.endsWith(".tiktokcdn-us.com") ||
    hostname.endsWith(".tiktokcdn.com")
  );
}

function isTikTokSourceUrl(url: URL): boolean {
  return url.hostname.toLowerCase().includes("tiktok.com");
}

function isXSourceUrl(url: URL): boolean {
  return X_SOURCE_HOSTS.has(url.hostname.toLowerCase());
}

function isInstagramSourceUrl(url: URL): boolean {
  return url.hostname.toLowerCase().includes("instagram.com");
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

function canonicalizeInstagramUrl(url: URL): string {
  const pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return `https://www.instagram.com${pathname}`;
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

function collectInstagramRefreshCandidates(metadata: Awaited<ReturnType<typeof fetchInstagramVideoMetadata>>): RefreshableMediaCandidate[] {
  if (!metadata) return [];

  const candidates: RefreshableMediaCandidate[] = [];
  const seen = new Set<string>();

  const push = (type: "image" | "video" | "audio", url?: string, thumbnailUrl?: string) => {
    if (!url) return;
    const dedupeKey = `${type}:${normalizeRefreshableMediaKey(url)}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    candidates.push({ type, url, thumbnailUrl });
  };

  for (const media of metadata.media ?? []) {
    push(media.type, media.url, media.thumbnailUrl);
  }

  if (metadata.videoUrl) {
    push("video", metadata.videoUrl, metadata.thumbnailUrl ?? undefined);
  }

  if (metadata.thumbnailUrl) {
    push("image", metadata.thumbnailUrl);
  }

  if (metadata.audio?.url) {
    push("audio", metadata.audio.url);
  }

  if (metadata.audio?.artworkUrl) {
    push("image", metadata.audio.artworkUrl);
  }

  return candidates;
}

function collectTikTokRefreshCandidates(metadata: Awaited<ReturnType<typeof fetchTikTokProxyMetadata>>): RefreshableMediaCandidate[] {
  if (!metadata) return [];

  const candidates: RefreshableMediaCandidate[] = [];
  const seen = new Set<string>();

  const push = (type: "image" | "video" | "audio", url?: string, thumbnailUrl?: string) => {
    if (!url) return;
    const dedupeKey = `${type}:${normalizeRefreshableMediaKey(url)}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    candidates.push({ type, url, thumbnailUrl });
  };

  for (const media of metadata.media ?? []) {
    push(media.type, media.url, media.thumbnailUrl);
  }

  if (metadata.videoUrl) {
    push("video", metadata.videoUrl, metadata.coverUrl ?? undefined);
  }

  if (metadata.coverUrl) {
    push("image", metadata.coverUrl);
  }

  if (metadata.authorAvatarUrl) {
    push("image", metadata.authorAvatarUrl);
  }

  if (metadata.audio?.url) {
    push("audio", metadata.audio.url);
  }

  if (metadata.audio?.artworkUrl) {
    push("image", metadata.audio.artworkUrl);
  }

  return candidates;
}

async function getTikTokRefreshCandidates(
  canonicalUrl: string,
  options?: ResolveRefreshedMediaOptions,
): Promise<RefreshableMediaCandidate[]> {
  const cacheKey = `v1:proxy-media:tiktok:${canonicalUrl}`;
  const cached = await cacheGet<RefreshableMediaCandidate[]>(cacheKey);

  if (cached !== null && (!options?.forceRefresh || areTikTokRefreshCandidatesStillFresh(cached))) {
    return cached;
  }

  const freshCandidates = collectTikTokRefreshCandidates(await fetchTikTokProxyMetadata(canonicalUrl));
  if (freshCandidates.length > 0) {
    cacheSet(cacheKey, freshCandidates, getTikTokRefreshCacheTtl(freshCandidates)).catch(() => {});
    return freshCandidates;
  }

  return cached ?? freshCandidates;
}

async function resolveRefreshedMediaUrl(
  sourceUrlText: string,
  requestUrl: string,
  options?: ResolveRefreshedMediaOptions,
): Promise<string | null> {
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(sourceUrlText);
  } catch {
    return null;
  }

  if (isTikTokSourceUrl(sourceUrl)) {
    const canonicalUrl = canonicalizeTikTokUrl(sourceUrl);
    const candidates = await getTikTokRefreshCandidates(canonicalUrl, options);
    return pickRefreshedMediaUrl(candidates, requestUrl);
  }

  if (isInstagramSourceUrl(sourceUrl)) {
    const canonicalUrl = canonicalizeInstagramUrl(sourceUrl);
    const cacheKey = `v1:proxy-media:instagram:${canonicalUrl}`;
    const candidates = await cacheFetch<RefreshableMediaCandidate[]>(
      cacheKey,
      INSTAGRAM_REFRESH_TTL,
      async () => {
        const video = await fetchInstagramVideoMetadata(canonicalUrl);
        const refreshed = await fetchInstagramOEmbedMetadata(canonicalUrl);
        const nextCandidates = collectInstagramRefreshCandidates(video);
        if (refreshed?.thumbnailUrl) {
          nextCandidates.push({
            type: "image",
            url: refreshed.thumbnailUrl,
          });
        }
        return nextCandidates;
      },
    );
    return pickRefreshedMediaUrl(candidates, requestUrl);
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

async function resolveRefreshedMediaUrls(
  sourceUrlText: string,
  requestUrl: string,
  options?: ResolveRefreshedMediaOptions,
): Promise<string[]> {
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(sourceUrlText);
  } catch {
    return [];
  }

  if (isTikTokSourceUrl(sourceUrl)) {
    const canonicalUrl = canonicalizeTikTokUrl(sourceUrl);
    const candidates = await getTikTokRefreshCandidates(canonicalUrl, options);
    return pickRefreshedMediaUrls(candidates, requestUrl);
  }

  const refreshedUrl = await resolveRefreshedMediaUrl(sourceUrlText, requestUrl, options);
  return refreshedUrl ? [refreshedUrl] : [];
}

export async function proxyMedia(request: Request, includeBody: boolean): Promise<Response> {
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

  const requestedContentType = inferMediaContentType(null, mediaUrl.toString());
  const isTikTokMediaRequest = isTikTokMediaUrl(mediaUrl);
  const isTikTokSourceRequest = isTikTokSourceUrl(mediaUrl);
  const isTikTokProxyRequest = isTikTokMediaRequest || isTikTokSourceRequest;
  let shouldStreamTikTokMedia = false;
  let hostname = mediaUrl.hostname.toLowerCase();
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
    method: includeBody || shouldStreamTikTokMedia ? "GET" : "HEAD",
    headers: upstreamHeaders,
    redirect: "follow",
  });

  let refreshedTikTokUrls: string[] = [];
  const attemptedTikTokUrls = new Set<string>();

  if (isTikTokProxyRequest) {
    const refreshSource = sourceUrlParam || mediaUrl.toString();
    refreshedTikTokUrls = await resolveRefreshedMediaUrls(refreshSource, mediaUrl.toString(), {
      forceRefresh: isTikTokMediaRequest && isTikTokUrlExpiringSoon(mediaUrl.toString()),
    });
    const resolvedUrl = refreshedTikTokUrls[0] ?? mediaUrl.toString();
    const resolvedContentType = inferMediaContentType(null, resolvedUrl);
    shouldStreamTikTokMedia =
      requestedContentType.startsWith("image/")
      || requestedContentType.startsWith("video/")
      || requestedContentType.startsWith("audio/")
      || resolvedContentType.startsWith("image/")
      || resolvedContentType.startsWith("video/")
      || resolvedContentType.startsWith("audio/");

    if (!shouldStreamTikTokMedia && (isTikTokMediaRequest || refreshedTikTokUrls.length > 0)) {
      return Response.redirect(resolvedUrl, 307);
    }

    mediaUrl = new URL(resolvedUrl);
    hostname = mediaUrl.hostname.toLowerCase();
  }

  attemptedTikTokUrls.add(mediaUrl.toString());
  let upstream = await fetchUpstream(mediaUrl.toString());

  if (!upstream.ok) {
    const refreshSource = sourceUrlParam || mediaUrl.toString();

    const candidateUrls = refreshedTikTokUrls.length > 0
      ? refreshedTikTokUrls
      : await resolveRefreshedMediaUrls(refreshSource, mediaUrl.toString());

    for (const candidateUrl of candidateUrls) {
      if (attemptedTikTokUrls.has(candidateUrl)) continue;
      attemptedTikTokUrls.add(candidateUrl);
      mediaUrl = new URL(candidateUrl);
      hostname = mediaUrl.hostname.toLowerCase();
      upstream = await fetchUpstream(candidateUrl);
      if (upstream.ok) break;
    }

    if (!upstream.ok && isTikTokProxyRequest) {
      const forcedRefreshUrls = await resolveRefreshedMediaUrls(refreshSource, mediaUrl.toString(), {
        forceRefresh: true,
      });

      for (const candidateUrl of forcedRefreshUrls) {
        if (attemptedTikTokUrls.has(candidateUrl)) continue;
        attemptedTikTokUrls.add(candidateUrl);
        mediaUrl = new URL(candidateUrl);
        hostname = mediaUrl.hostname.toLowerCase();
        upstream = await fetchUpstream(candidateUrl);
        if (upstream.ok) break;
      }
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
  if (isTikTokProxyRequest) {
    headers.set("Cache-Control", getTikTokProxyCacheControl(upstream.url || mediaUrl.toString(), upstream.status, headers.get("Content-Type")));
  } else if (range || headers.get("Content-Type")?.startsWith("video/")) {
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
