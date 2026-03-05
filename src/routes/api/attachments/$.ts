import { createFileRoute } from '@tanstack/react-router';

import { apiError, getBucket, requireAuth } from "@/lib/api-helpers";


// ── Content types that are safe to render inline ────────────────────────
// Everything else is forced to download (Content-Disposition: attachment)
// This prevents XSS from uploaded HTML/SVG and script execution.
const SAFE_INLINE_TYPES = new Set([
  // Images (safe to render — browser sandboxes these)
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp",
  // Video (safe to render)
  "video/mp4", "video/webm", "video/quicktime",
  // Audio (safe to render)
  "audio/mpeg", "audio/mp3", "audio/ogg", "audio/wav", "audio/webm", "audio/flac",
  "audio/aac", "audio/mp4",
  // PDF (rendered in browser's sandboxed viewer)
  "application/pdf",
]);

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
  const object = await bucket.get(key);

  if (!object) {
    return apiError("File not found", 404);
  }

  let contentType = object.httpMetadata?.contentType || "application/octet-stream";
  const pathParts = splatPath.split("/");
  const filename = pathParts[pathParts.length - 1] || "download";

  // ── Security: neutralize dangerous content types ──────────────────
  // If the content type would cause script execution, force it to octet-stream.
  // This is how Discord prevents stored XSS — even if someone uploads an .html
  // file, the browser will download it instead of executing it.
  if (DANGEROUS_CONTENT_TYPES.has(contentType)) {
    contentType = "application/octet-stream";
  }

  // Determine if file is safe to render inline (images, video, audio, PDF)
  const isInline = SAFE_INLINE_TYPES.has(contentType);

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Content-Disposition", `${isInline ? "inline" : "attachment"}; filename="${filename}"`);

  // ── Defense-in-depth security headers ─────────────────────────────
  // These headers protect against MIME sniffing, clickjacking, and
  // script injection even if a dangerous file somehow gets served inline.

  // Prevent browser from guessing MIME type differently than what we declare
  headers.set("X-Content-Type-Options", "nosniff");

  // Block all script execution in the served content — even if content-type
  // was somehow wrong, the browser won't execute scripts
  headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");

  // Prevent the file from being rendered in an iframe on another site
  headers.set("X-Frame-Options", "DENY");

  // Restrict referrer leaking
  headers.set("Referrer-Policy", "no-referrer");

  // Prevent cross-origin embedding
  headers.set("Cross-Origin-Resource-Policy", "same-origin");

  return new Response(object.body as ReadableStream, {
    status: 200,
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
