import { createFileRoute } from '@tanstack/react-router';

import { apiError, getBucket } from "@/lib/api-helpers";

// GET /api/avatars/{filename}
// Serves user avatars from R2 — publicly accessible (no auth)
// so they can be displayed in <img> tags without token issues.
const GET = async ({ request, params }: any) => {
  const { _splat } = params as { _splat?: string };
  const splatPath = _splat || "";
  const key = `avatars/${splatPath}`;

  const bucket = getBucket();
  const object = await bucket.get(key);

  if (!object) {
    return apiError("Avatar not found", 404);
  }

  const contentType = object.httpMetadata?.contentType || "image/png";

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  // Short cache since key is reused on update — rely on R2 ETag for revalidation
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.set("ETag", object.etag);
  // Security headers
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
  headers.set("Content-Disposition", "inline");

  return new Response(object.body as ReadableStream, {
    status: 200,
    headers,
  });
}

export const Route = createFileRoute('/api/avatars/$')({
  server: {
    handlers: {
      GET,
    }
  }
});
