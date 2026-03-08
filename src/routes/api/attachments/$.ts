import { apiError, getBucket, requireAuth } from "@/lib/api-helpers";
import { createFileRoute } from '@tanstack/react-router';

// Content types that should NEVER be served as their declared type.
// These are re-typed to application/octet-stream to force download
// and prevent the browser from interpreting them as executable content.
const DANGEROUS_CONTENT_TYPES = new Set([
  "text/html", "text/xml", "application/xhtml+xml",
  "image/svg+xml",  // SVGs can contain embedded scripts
  "application/javascript", "text/javascript",
  "application/x-httpd-php",
]);


// GET /api/attachments/{channelId}/{attachmentId}/{filename}
// R2 key = attachments/{channelId}/{attachmentId}/{filename}
const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { _splat } = params as { _splat?: string };
  const splatPath = _splat || "";
  const key = `attachments/${splatPath}`;
  const bucket = getBucket();

  // ── Range request support ──────────────────────────────────────────
  const rangeHeader = request.headers.get("Range");
  let rangeOption: any = undefined;
  let reqStart: number | undefined;
  let reqEnd: number | undefined;
  let reqSuffix: number | undefined;

  if (rangeHeader) {
    const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/);
    if (match) {
      const s = match[1];
      const e = match[2];
      if (!s && e) {
        reqSuffix = parseInt(e, 10);
        rangeOption = { suffix: reqSuffix };
      } else if (s && !e) {
        reqStart = parseInt(s, 10);
        rangeOption = { offset: reqStart };
      } else if (s && e) {
        reqStart = parseInt(s, 10);
        reqEnd = parseInt(e, 10);
        rangeOption = { offset: reqStart, length: reqEnd - reqStart + 1 };
      }
    }
  }

  const object = await bucket.get(key, rangeOption ? { range: rangeOption } : undefined);

  if (!object) {
    return apiError("File not found", 404);
  }

  let contentType = object.httpMetadata?.contentType || "application/octet-stream";
  const pathParts = splatPath.split("/");
  const filename = pathParts[pathParts.length - 1] || "download";

  // ── Security: neutralize dangerous content types ──────────────────
  if (DANGEROUS_CONTENT_TYPES.has(contentType)) {
    contentType = "application/octet-stream";
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", contentType);
  // Always use "attachment" — embedded <video>/<img> tags ignore Content-Disposition
  // entirely (they just consume the bytes), so inline playback still works. This only
  // affects top-level navigation (download clicks), matching Discord's CDN behavior.
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  headers.set("Accept-Ranges", "bytes");

  let status = 200;

  if (rangeHeader !== null) {
    status = 206;
    // Partial responses MUST NOT be cached aggressively. CEF/Chromium will try
    // to satisfy future Range requests from its HTTP cache — but the cached 206
    // only covers the original byte range, so a subsequent request for a
    // different range triggers ERR_REQUEST_RANGE_NOT_SATISFIABLE internally
    // without ever hitting the network.
    headers.set("Cache-Control", "no-store");

    let offset = reqStart ?? 0;
    let length = object.size;

    if (reqSuffix !== undefined) {
      offset = Math.max(0, object.size - reqSuffix);
      length = Math.min(reqSuffix, object.size);
    } else {
      if (reqEnd !== undefined) {
        length = Math.min(reqEnd - offset + 1, object.size - offset);
      } else {
        length = object.size - offset;
      }
    }

    if (offset >= object.size || length <= 0) {
      const h = new Headers();
      h.set("Content-Range", `bytes */${object.size}`);
      h.set("X-Content-Type-Options", "nosniff");
      h.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; script-src 'none';");
      h.set("X-Frame-Options", "DENY");
      h.set("Referrer-Policy", "no-referrer");
      h.set("Cross-Origin-Resource-Policy", "cross-origin");
      return new Response(null, { status: 416, headers: h });
    }

    // Miniflare might populate `object.range`, use it as source of truth
    if ("range" in object && (object as any).range) {
      const r = (object as any).range;
      if (typeof r.offset === "number") offset = r.offset;
      if (typeof r.length === "number") length = r.length;
    }

    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", length.toString());
  } else {
    // Media types (video/audio) need range-request support for seeking.
    // In Tauri/CEF, a cached 200 with `immutable` prevents the browser from
    // issuing fresh Range requests, so scrubbing/seeking breaks (always goes
    // back to the beginning). Use `no-store` for media to ensure every seek
    // hits the server with a proper Range header. Images and other static
    // assets keep the long cache since they don't need seeking.
    const isMedia = contentType.startsWith("video/") || contentType.startsWith("audio/");
    headers.set("Cache-Control", isMedia ? "no-store" : "public, max-age=31536000, immutable");
    headers.set("Content-Length", object.size.toString());
  }

  // ── Defense-in-depth security headers ─────────────────────────────
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; script-src 'none';");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");

  return new Response(object.body as ReadableStream, {
    status,
    headers,
  });
}



export const Route = createFileRoute('/api/attachments/$')({
  server: {
    handlers: {
      GET,
    }
  }
});
