import { createFileRoute } from "@tanstack/react-router";
import { clog } from "@/lib/console-logger";

const log = clog("proxy-media");

const ALLOWED_HOSTS = new Set([
  "video.twimg.com",
  "pbs.twimg.com",
  "vxtwitter.com",
]);

function isAllowedMediaUrl(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const hostname = url.hostname.toLowerCase();
  if (ALLOWED_HOSTS.has(hostname)) return true;

  if (hostname === "vxtwitter.com") {
    return url.pathname.startsWith("/tvid/");
  }

  return (
    hostname === "api16-normal-useast5.tiktokv.us" ||
    hostname.endsWith(".tiktokv.us") ||
    hostname.endsWith(".tiktokcdn-us.com") ||
    hostname.endsWith(".tiktokcdn.com")
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
      if (hostname === "vxtwitter.com" && pathname.startsWith("/tvid/")) {
        return "video/mp4";
      }
      if (pathname.endsWith(".mp4") || pathname.includes("/mp4/") || pathname.includes("/avc1/")) {
        return "video/mp4";
      }
      if (pathname.includes("/video/") || pathname.includes("/aweme/v1/play/")) {
        return "video/mp4";
      }
      if (pathname.endsWith(".webm")) return "video/webm";
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

async function proxyMedia(request: Request, includeBody: boolean): Promise<Response> {
  const requestUrl = new URL(request.url);
  const mediaUrlParam = requestUrl.searchParams.get("url");

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
  }

  const range = request.headers.get("Range");
  if (range) {
    upstreamHeaders.set("Range", range);
  }

  const upstream = await fetch(mediaUrl.toString(), {
    method: includeBody ? "GET" : "HEAD",
    headers: upstreamHeaders,
    redirect: "follow",
  });

  if (hostname.includes("tiktok") && !upstream.ok) {
    log.warn("TikTok upstream failure", {
      status: upstream.status,
      statusText: upstream.statusText,
      method: includeBody ? "GET" : "HEAD",
      range,
      source: summarizeUrlForLog(mediaUrl),
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
