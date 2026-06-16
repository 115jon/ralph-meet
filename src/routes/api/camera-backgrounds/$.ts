import { createFileRoute } from "@tanstack/react-router";

import { apiError, getBucket, getCorsHeaders, requireAuth } from "@/lib/api-helpers";
import { DELETE as deleteBackground, GET as listBackgrounds, POST as uploadBackground } from "../camera-backgrounds";

const BACKGROUND_PREFIX = "camera-backgrounds";
const DANGEROUS_CONTENT_TYPES = new Set([
  "text/html",
  "text/xml",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/javascript",
  "text/javascript",
]);

function setCorsHeaders(headers: Headers, request: Request) {
  for (const [key, value] of Object.entries(getCorsHeaders(request))) {
    headers.set(key, value);
  }
}

function getSplatPath(params: { _splat?: string } | undefined): string {
  return params?._splat ?? "";
}

const GET = async (context: any) => {
  const { request, params } = context;
  const splatPath = getSplatPath(params as { _splat?: string });
  if (!splatPath) return listBackgrounds(context);

  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const key = `${BACKGROUND_PREFIX}/${authResult.userId}/${splatPath}`;
  const object = await getBucket().get(key);

  if (!object) {
    return apiError("Background not found", 404, undefined, request);
  }

  let contentType = object.httpMetadata?.contentType || "application/octet-stream";
  if (DANGEROUS_CONTENT_TYPES.has(contentType)) {
    contentType = "application/octet-stream";
  }

  const filename = splatPath.split("/").pop() || "background";
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", contentType);
  headers.set("Content-Disposition", `inline; filename="${filename.replace(/"/g, "")}"`);
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  // Vary: Origin ensures the browser caches separate responses for CORS vs no-CORS requests.
  // Without this, the <img> tag (no-CORS, no ACAO in response) poisons the cache for the
  // subsequent fetch() call (CORS mode), which then sees no ACAO and gets blocked.
  headers.set("Vary", "Origin");
  headers.set("Content-Length", object.size.toString());
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; media-src 'none'; script-src 'none'; style-src 'unsafe-inline'");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  setCorsHeaders(headers, request);

  return new Response(object.body as ReadableStream, {
    status: 200,
    headers,
  });
};

const POST = async (context: any) => {
  const { request, params } = context;
  if (getSplatPath(params as { _splat?: string })) {
    return apiError("Background not found", 404, undefined, request);
  }

  return uploadBackground(context);
};

const DELETE = async (context: any) => {
  const { request, params } = context;
  if (getSplatPath(params as { _splat?: string })) {
    return apiError("Background not found", 404, undefined, request);
  }

  return deleteBackground(context);
};

export const Route = createFileRoute("/api/camera-backgrounds/$")({
  server: {
    handlers: {
      GET,
      POST,
      DELETE,
    },
  },
});
