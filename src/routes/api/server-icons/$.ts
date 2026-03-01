import { createFileRoute } from '@tanstack/react-router';

import { apiError, getBucket } from "@/lib/api-helpers";

// GET /api/server-icons/{filename}
// Serves server icons from R2 — publicly accessible (no auth)
// so they can be displayed in <img> tags without token issues.
const GET = async ({ request, params }: any) => {
  const { _splat } = params as { _splat?: string };
  const splatPath = _splat || "";
  const key = `server-icons/${splatPath}`;

  const bucket = getBucket();
  const object = await bucket.get(key);

  if (!object) {
    return apiError("Icon not found", 404);
  }

  const contentType = object.httpMetadata?.contentType || "image/png";

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  // Security headers — defense-in-depth against MIME sniffing and embedded scripts
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
  headers.set("Content-Disposition", "inline");

  return new Response(object.body as ReadableStream, {
    status: 200,
    headers,
  });
}

export const Route = createFileRoute('/api/server-icons/$')({
  server: {
    handlers: {
      GET,
    }
  }
});
