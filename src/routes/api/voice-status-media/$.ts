import { createFileRoute } from "@tanstack/react-router";

import { apiError, getBucket, getCorsHeaders, getDB, requireAuth } from "@/lib/api-helpers";
import { getVoiceStatusMediaAssetById } from "@/services/voice-status-media.service";

const DANGEROUS_CONTENT_TYPES = new Set([
  "text/html",
  "text/xml",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/javascript",
  "text/javascript",
  "application/x-httpd-php",
]);

function parseAssetId(params: { _splat?: string } | undefined): string | null {
  const splat = params?._splat ?? "";
  const assetId = splat.split("/")[0]?.trim();
  return assetId || null;
}

const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const assetId = parseAssetId(params as { _splat?: string });
  if (!assetId) {
    return apiError("Voice status media not found", 404, undefined, request);
  }

  const asset = await getVoiceStatusMediaAssetById(getDB(), assetId);
  if (!asset) {
    return apiError("Voice status media not found", 404, undefined, request);
  }

  const member = await getDB()
    .prepare(`SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`)
    .bind(asset.server_id, userId)
    .first();

  if (!member) {
    return apiError("Voice status media not found", 404, undefined, request);
  }

  const bucket = getBucket();
  const rangeHeader = request.headers.get("Range");
  let hasValidRange = false;
  let rangeOption: any = undefined;
  let reqStart: number | undefined;
  let reqEnd: number | undefined;
  let reqSuffix: number | undefined;

  if (rangeHeader) {
    const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/);
    if (match) {
      const start = match[1];
      const end = match[2];
      if (!start && end) {
        const parsedSuffix = Number.parseInt(end, 10);
        if (Number.isFinite(parsedSuffix) && parsedSuffix > 0) {
          reqSuffix = parsedSuffix;
          rangeOption = { suffix: reqSuffix };
          hasValidRange = true;
        }
      } else if (start && !end) {
        const parsedStart = Number.parseInt(start, 10);
        if (Number.isFinite(parsedStart) && parsedStart >= 0) {
          reqStart = parsedStart;
          rangeOption = { offset: reqStart };
          hasValidRange = true;
        }
      } else if (start && end) {
        const parsedStart = Number.parseInt(start, 10);
        const parsedEnd = Number.parseInt(end, 10);
        if (
          Number.isFinite(parsedStart) &&
          Number.isFinite(parsedEnd) &&
          parsedStart >= 0 &&
          parsedEnd >= parsedStart
        ) {
          reqStart = parsedStart;
          reqEnd = parsedEnd;
          rangeOption = { offset: reqStart, length: reqEnd - reqStart + 1 };
          hasValidRange = true;
        }
      }
    }
  }

  const object = await bucket.get(asset.fileKey, hasValidRange ? { range: rangeOption } : undefined);
  if (!object) {
    return apiError("Voice status media not found", 404, undefined, request);
  }

  let contentType = object.httpMetadata?.contentType || asset.content_type || "application/octet-stream";
  if (DANGEROUS_CONTENT_TYPES.has(contentType)) {
    contentType = "application/octet-stream";
  }

  const headers = new Headers(getCorsHeaders(request));
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", contentType);
  headers.set("Content-Disposition", "inline");
  headers.set("Accept-Ranges", "bytes");
  headers.set("ETag", object.etag);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; script-src 'none';");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");

  let status = 200;

  if (hasValidRange) {
    status = 206;
    headers.set("Cache-Control", "no-store");

    let offset = reqStart ?? 0;
    let length = object.size;

    if (reqSuffix !== undefined) {
      offset = Math.max(0, object.size - reqSuffix);
      length = Math.min(reqSuffix, object.size);
    } else if (reqEnd !== undefined) {
      length = Math.min(reqEnd - offset + 1, object.size - offset);
    } else {
      length = object.size - offset;
    }

    if (offset >= object.size || length <= 0) {
      const invalidRangeHeaders = new Headers(getCorsHeaders(request));
      invalidRangeHeaders.set("Content-Range", `bytes */${object.size}`);
      invalidRangeHeaders.set("X-Content-Type-Options", "nosniff");
      invalidRangeHeaders.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; script-src 'none';");
      return new Response(null, { status: 416, headers: invalidRangeHeaders });
    }

    if ("range" in object && (object as any).range) {
      const range = (object as any).range;
      if (typeof range.offset === "number") offset = range.offset;
      if (typeof range.length === "number") length = range.length;
    }

    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", length.toString());
  } else {
    const isMedia = contentType.startsWith("video/") || contentType.startsWith("audio/");
    headers.set("Cache-Control", isMedia ? "no-store" : "public, max-age=0, must-revalidate");
    headers.set("Content-Length", object.size.toString());
  }

  return new Response(object.body as ReadableStream, {
    status,
    headers,
  });
};

export const Route = createFileRoute("/api/voice-status-media/$")({
  server: {
    handlers: {
      GET,
    },
  },
});
