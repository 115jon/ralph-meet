import { createFileRoute } from "@tanstack/react-router";

import { apiError, getBucket, getDB, requireAuth } from "@/lib/api-helpers";
import { getGeneratedEmojiAssetById } from "@/services/emoji.service";

const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const record = await getGeneratedEmojiAssetById(getDB(), params.id);
  if (!record || record.status !== "ready" || !record.fileKey) {
    return apiError("Emoji not found", 404, "EMOJI_NOT_FOUND", request);
  }

  const object = await getBucket().get(record.fileKey);
  if (!object) {
    return apiError("Emoji asset not found", 404, "EMOJI_ASSET_NOT_FOUND", request);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", record.content_type || object.httpMetadata?.contentType || "image/png");
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  headers.set("Content-Length", object.size.toString());
  headers.set("Content-Disposition", `inline; filename="${record.shortcode}.png"`);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; media-src 'self'; script-src 'none';");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("Vary", "Origin");

  return new Response(object.body as ReadableStream, {
    status: 200,
    headers,
  });
};

export const Route = createFileRoute("/api/emojis/assets/$id")({
  server: {
    handlers: {
      GET,
    },
  },
});
