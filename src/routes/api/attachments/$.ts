import { createFileRoute } from '@tanstack/react-router';

import { apiError, getBucket, requireAuth } from "@/lib/api-helpers";


// GET /api/attachments/{channelId}/{attachmentId}/{filename}
// R2 key = attachments/{channelId}/{attachmentId}/{filename}
const GET = async ({ request, params }: any) => {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (token) {
    try {
      const { verifyToken } = await import("@clerk/backend");
      const { env } = await import("cloudflare:workers");
      const claims = await verifyToken(token, { secretKey: (env as any).CLERK_SECRET_KEY });
      if (!claims.sub) {
        return apiError("Unauthorized", 401);
      }
    } catch (e) {
      return apiError("Unauthorized", 401);
    }
  } else {
    const authResult = await requireAuth();
    if (authResult instanceof Response) return authResult;
  }

  const { _splat } = params as { _splat?: string };
  const splatPath = _splat || "";
  const key = `attachments/${splatPath}`;

  const bucket = getBucket();
  const object = await bucket.get(key);

  if (!object) {
    return apiError("File not found", 404);
  }

  const contentType = object.httpMetadata?.contentType || "application/octet-stream";
  const pathParts = splatPath.split("/");
  const filename = pathParts[pathParts.length - 1] || "download";
  const isInline = contentType.startsWith("image/") || contentType.startsWith("video/") || contentType === "application/pdf";

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Content-Disposition", `${isInline ? "inline" : "attachment"}; filename="${filename}"`);

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
