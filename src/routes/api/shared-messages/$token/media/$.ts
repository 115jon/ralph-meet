import { apiError, getBucket, getDB } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { isPlayableVideo } from "@/lib/media";
import { getPublicMessageShare } from "@/services/message-share.service";
import { createFileRoute } from "@tanstack/react-router";

const DANGEROUS_CONTENT_TYPES = new Set([
  "text/html",
  "text/xml",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/javascript",
  "text/javascript",
]);

function parseRange(rangeHeader: string | null): {
  rangeOption?: { offset?: number; length?: number; suffix?: number };
  reqStart?: number;
  reqEnd?: number;
  reqSuffix?: number;
} {
  if (!rangeHeader) return {};

  const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return {};

  const start = match[1];
  const end = match[2];
  if (!start && end) {
    const reqSuffix = parseInt(end, 10);
    return { rangeOption: { suffix: reqSuffix }, reqSuffix };
  }
  if (start && !end) {
    const reqStart = parseInt(start, 10);
    return { rangeOption: { offset: reqStart }, reqStart };
  }
  if (start && end) {
    const reqStart = parseInt(start, 10);
    const reqEnd = parseInt(end, 10);
    return { rangeOption: { offset: reqStart, length: reqEnd - reqStart + 1 }, reqStart, reqEnd };
  }

  return {};
}

const GET = async ({ request, params }: any) => {
  const { token, _splat } = params as { token: string; _splat?: string };
  const key = `attachments/${_splat ?? ""}`;

  try {
    const share = await getPublicMessageShare(getDB(), token, new Date(), { incrementView: false });
    const attachment = share.snapshot.attachments.find((item) => item.file_key === key);
    const isAllowedMedia = attachment?.content_type?.startsWith("image/") || isPlayableVideo(attachment?.content_type);
    if (!attachment || !isAllowedMedia) {
      return apiError("File not found", 404);
    }

    const rangeHeader = request.headers.get("Range");
    const { rangeOption, reqStart, reqEnd, reqSuffix } = parseRange(rangeHeader);
    const object = await getBucket().get(key, rangeOption ? { range: rangeOption } : undefined);
    if (!object) return apiError("File not found", 404);

    let contentType = object.httpMetadata?.contentType || attachment.content_type || "application/octet-stream";
    if (DANGEROUS_CONTENT_TYPES.has(contentType) || !(contentType.startsWith("image/") || isPlayableVideo(contentType))) {
      contentType = "application/octet-stream";
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Content-Type", contentType);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Content-Disposition", `inline; filename="${attachment.filename.replace(/"/g, "")}"`);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; script-src 'none';");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    headers.set("X-Robots-Tag", "noindex, nofollow");

    let status = 200;
    if (rangeHeader !== null) {
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
        const h = new Headers(headers);
        h.set("Content-Range", `bytes */${object.size}`);
        return new Response(null, { status: 416, headers: h });
      }

      if ("range" in object && (object as any).range) {
        const r = (object as any).range;
        if (typeof r.offset === "number") offset = r.offset;
        if (typeof r.length === "number") length = r.length;
      }

      headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
      headers.set("Content-Length", length.toString());
    } else {
      headers.set("Content-Length", object.size.toString());
      headers.set("Cache-Control", contentType.startsWith("video/") ? "no-store" : "public, max-age=86400");
    }

    if (request.method === "HEAD") {
      return new Response(null, { headers });
    }

    return new Response(object.body as ReadableStream, { status, headers });
  } catch (error) {
    if (error instanceof ServiceError) {
      return apiError(error.message, error.status, error.code);
    }
    throw error;
  }
};

export const Route = createFileRoute("/api/shared-messages/$token/media/$")({
  server: {
    handlers: {
      GET,
    },
  },
});
