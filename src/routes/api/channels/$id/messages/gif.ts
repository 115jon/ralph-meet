import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, genId, getBucket, getDB, requireAuth } from "@/lib/api-helpers";
import { MAX_GIF_UPLOAD_BYTES } from "@/lib/gif-picker";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { checkRateLimitDO, RATE_LIMITS } from "@/lib/rate-limit";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { getUserPermissions } from "@/lib/require-permission";

interface GifUploadBody {
  source_url: string;
  filename?: string;
  content_type?: string;
}

function sanitizeGifFilename(filename: string | undefined, contentType: string): string {
  const fallbackExt = contentType === "video/mp4" ? "mp4" : "gif";
  const trimmed = (filename || `gif.${fallbackExt}`).trim();
  const withoutUnsafe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (withoutUnsafe.includes(".")) return withoutUnsafe;
  return `${withoutUnsafe}.${fallbackExt}`;
}

const POST = async ({ params, request }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: channelId } = params;

  const rl = await checkRateLimitDO(userId, "file-upload", RATE_LIMITS.FILE_UPLOAD);
  if (rl) return rl;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  const { serverId } = accessResult as { serverId: string | null };
  if (serverId) {
    const perms = await getUserPermissions(serverId, userId);
    if (perms === null || !hasPermission(perms, PERMISSIONS.ATTACH_FILES)) {
      return apiError("You do not have permission to upload GIFs", 403);
    }
  }

  const body = await request.json() as GifUploadBody;
  if (!body.source_url) {
    return apiError("source_url required", 400);
  }

  const contentType = body.content_type === "video/mp4" ? "video/mp4" : "image/gif";
  const sourceRes = await fetch(body.source_url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RalphMeet/1.0; +https://ralph.dev)",
    },
  });
  if (!sourceRes.ok) {
    return apiError(`Failed to fetch GIF source (${sourceRes.status})`, 502);
  }

  const arrayBuffer = await sourceRes.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_GIF_UPLOAD_BYTES) {
    return apiError("GIF too large to upload", 413);
  }

  const db = getDB();
  const bucket = getBucket();
  const attachmentId = genId();
  const now = new Date().toISOString();
  const filename = sanitizeGifFilename(body.filename, contentType);
  const key = `attachments/${channelId}/${attachmentId}/${filename}`;

  await bucket.put(key, arrayBuffer, {
    httpMetadata: { contentType },
  });

  await db.prepare(
    `INSERT INTO attachments (id, message_id, filename, file_key, content_type, size_bytes, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(attachmentId, null, filename, key, contentType, arrayBuffer.byteLength, userId, now).run();

  return apiSuccess({
    id: attachmentId,
    file_url: `/api/${key}`,
    file_name: filename,
    file_size: arrayBuffer.byteLength,
    content_type: contentType,
  }, 201);
};

export const Route = createFileRoute('/api/channels/$id/messages/gif')({
  server: {
    handlers: {
      POST,
    }
  }
});
