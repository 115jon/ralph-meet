import { createFileRoute } from "@tanstack/react-router";

import { apiError, getBucket } from "@/lib/api-helpers";
import { PROFILE_ASSET_PREFIX } from "@/lib/profile-assets";

const DANGEROUS_CONTENT_TYPES = new Set([
  "text/html",
  "text/xml",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/javascript",
  "text/javascript",
  "application/x-httpd-php",
]);

function getSplatPath(params: { _splat?: string } | undefined): string {
  return params?._splat ?? "";
}

const GET = async ({ request, params }: any) => {
  const splatPath = getSplatPath(params as { _splat?: string });
  const key = `${PROFILE_ASSET_PREFIX}/${splatPath}`;
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

  const object = await bucket.get(key, hasValidRange ? { range: rangeOption } : undefined);

  if (!object) {
    return apiError("Profile asset not found", 404);
  }

  let contentType = object.httpMetadata?.contentType || "application/octet-stream";
  if (DANGEROUS_CONTENT_TYPES.has(contentType)) {
    contentType = "application/octet-stream";
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", contentType);
  headers.set("Content-Disposition", "inline");
  headers.set("Accept-Ranges", "bytes");
  headers.set("ETag", object.etag);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");

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
      const invalidRangeHeaders = new Headers();
      invalidRangeHeaders.set("Content-Range", `bytes */${object.size}`);
      invalidRangeHeaders.set("X-Content-Type-Options", "nosniff");
      invalidRangeHeaders.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
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

export const Route = createFileRoute("/api/profile-assets/$")({
  server: {
    handlers: {
      GET,
    },
  },
});
