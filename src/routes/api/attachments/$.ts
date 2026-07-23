import { apiError, getBucket, getDB, requireAuth } from "@/lib/api-helpers";
import { requireChannelAccess } from "@/lib/require-channel-access";
import {
  getR2ObjectRangeBounds,
  resolveR2ByteRangeHeader,
  toR2GetOptions,
} from "@/lib/r2-range";
import { createFileRoute } from "@tanstack/react-router";

// Content types that should NEVER be served as their declared type.
// These are re-typed to application/octet-stream to force download
// and prevent the browser from interpreting them as executable content.
const DANGEROUS_CONTENT_TYPES = new Set([
  "text/html",
  "text/xml",
  "application/xhtml+xml",
  "image/svg+xml", // SVGs can contain embedded scripts
  "application/javascript",
  "text/javascript",
  "application/x-httpd-php",
]);

// GET /api/attachments/{channelId}/{attachmentId}/{filename}
// R2 key = attachments/{channelId}/{attachmentId}/{filename}
export const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { _splat } = params as { _splat?: string };
  const splatPath = _splat || "";
  const pathParts = splatPath.split("/");
  if (pathParts.length !== 3 || pathParts.some((part: string) => !part)) {
    return apiError("File not found", 404);
  }

  const [channelId, attachmentId, requestedFilename] = pathParts;
  const accessResult = await requireChannelAccess(authResult.userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  const attachment = await getDB()
    .prepare(
      `SELECT a.file_key, a.filename, m.channel_id
       FROM attachments a
       JOIN messages m ON m.id = a.message_id
       WHERE a.id = ? AND m.channel_id = ?
       LIMIT 1`,
    )
    .bind(attachmentId, channelId)
    .first<{
      file_key: string;
      filename: string;
      channel_id: string;
    }>();

  const requestedKey = `attachments/${channelId}/${attachmentId}/${requestedFilename}`;
  if (
    !attachment ||
    attachment.channel_id !== channelId ||
    attachment.file_key !== requestedKey
  ) {
    return apiError("File not found", 404);
  }

  const key = attachment.file_key;
  const bucket = getBucket();

  // ── Range request support ──────────────────────────────────────────
  const rangeHeader = request.headers.get("Range");
  const metadata = await bucket.head(key);
  if (!metadata) {
    return apiError("File not found", 404);
  }

  const parsedRange = resolveR2ByteRangeHeader(rangeHeader, metadata.size);
  if (parsedRange.requested && parsedRange.invalid) {
    const h = new Headers();
    h.set("Content-Range", `bytes */${metadata.size}`);
    h.set("X-Content-Type-Options", "nosniff");
    h.set(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; script-src 'none';",
    );
    h.set("X-Frame-Options", "DENY");
    h.set("Referrer-Policy", "no-referrer");
    h.set("Cross-Origin-Resource-Policy", "cross-origin");
    return new Response(null, { status: 416, headers: h });
  }

  const object = await bucket.get(key, toR2GetOptions(parsedRange.range));

  if (!object) {
    return apiError("File not found", 404);
  }

  let contentType =
    object.httpMetadata?.contentType || "application/octet-stream";
  const filename =
    attachment.filename
      .split("")
      .map((character: string) => {
        const code = character.charCodeAt(0);
        return code < 32 ||
          code === 127 ||
          character === '"' ||
          character === "\\"
          ? "_"
          : character;
      })
      .join("") || "download";

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

  if (parsedRange.requested) {
    status = 206;
    // Partial responses MUST NOT be cached aggressively. CEF/Chromium will try
    // to satisfy future Range requests from its HTTP cache — but the cached 206
    // only covers the original byte range, so a subsequent request for a
    // different range triggers ERR_REQUEST_RANGE_NOT_SATISFIABLE internally
    // without ever hitting the network.
    headers.set("Cache-Control", "no-store");

    let offset = parsedRange.offset ?? 0;
    let length = parsedRange.length ?? metadata.size - offset;

    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      offset >= metadata.size ||
      length <= 0 ||
      offset + length > metadata.size
    ) {
      const h = new Headers();
      h.set("Content-Range", `bytes */${metadata.size}`);
      h.set("X-Content-Type-Options", "nosniff");
      h.set(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; script-src 'none';",
      );
      h.set("X-Frame-Options", "DENY");
      h.set("Referrer-Policy", "no-referrer");
      h.set("Cross-Origin-Resource-Policy", "cross-origin");
      return new Response(null, { status: 416, headers: h });
    }

    // Miniflare might populate `object.range`, use it as source of truth
    const objectRange = getR2ObjectRangeBounds(object.range);
    if (objectRange.offset !== undefined) offset = objectRange.offset;
    if (objectRange.length !== undefined) length = objectRange.length;

    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      offset >= metadata.size ||
      length <= 0 ||
      offset + length > metadata.size
    ) {
      const h = new Headers();
      h.set("Content-Range", `bytes */${metadata.size}`);
      return new Response(null, { status: 416, headers: h });
    }

    headers.set(
      "Content-Range",
      `bytes ${offset}-${offset + length - 1}/${metadata.size}`,
    );
    headers.set("Content-Length", length.toString());
  } else {
    // Media types (video/audio) need range-request support for seeking.
    // In Tauri/CEF, a cached 200 with `immutable` prevents the browser from
    // issuing fresh Range requests, so scrubbing/seeking breaks (always goes
    // back to the beginning). Use `no-store` for media to ensure every seek
    // hits the server with a proper Range header. Images and other static
    // assets keep the long cache since they don't need seeking.
    const isMedia =
      contentType.startsWith("video/") || contentType.startsWith("audio/");
    headers.set(
      "Cache-Control",
      isMedia ? "no-store" : "private, max-age=31536000, immutable",
    );
    headers.set("Content-Length", metadata.size.toString());
  }

  // ── Defense-in-depth security headers ─────────────────────────────
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; script-src 'none';",
  );
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  // Vary: Origin ensures the browser keeps separate cache entries for CORS and no-CORS requests
  // to the same URL. Without this, an <img> load (no-CORS, no ACAO header stored) can prevent
  // a subsequent fetch() (CORS mode) from seeing the Access-Control-Allow-Origin header.
  headers.set("Vary", "Origin");

  return new Response(object.body as ReadableStream, {
    status,
    headers,
  });
};

export const Route = createFileRoute("/api/attachments/$")({
  server: {
    handlers: {
      GET,
    },
  },
});
