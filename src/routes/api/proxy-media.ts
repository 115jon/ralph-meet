import { createFileRoute } from "@tanstack/react-router";

const ALLOWED_HOSTS = new Set([
  "video.twimg.com",
  "pbs.twimg.com",
  "vxtwitter.com",
]);

function isAllowedMediaUrl(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return false;

  if (url.hostname.toLowerCase() === "vxtwitter.com") {
    return url.pathname.startsWith("/tvid/");
  }

  return true;
}

const GET = async ({ request }: { request: Request }) => {
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
  upstreamHeaders.set("User-Agent", "Mozilla/5.0");
  upstreamHeaders.set("Accept", request.headers.get("Accept") || "video/*,*/*;q=0.8");

  const range = request.headers.get("Range");
  if (range) {
    upstreamHeaders.set("Range", range);
  }

  const upstream = await fetch(mediaUrl.toString(), {
    headers: upstreamHeaders,
    redirect: "follow",
  });

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
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/octet-stream");
  }

  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("Referrer-Policy", "no-referrer");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
};

export const Route = createFileRoute("/api/proxy-media")({
  server: {
    handlers: {
      GET,
    },
  },
});
