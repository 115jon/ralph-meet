import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, genId, getDB, requireAuth } from "@/lib/api-helpers";
import { MAX_GIF_UPLOAD_BYTES } from "@/lib/gif-picker";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { checkRateLimitDO, RATE_LIMITS } from "@/lib/rate-limit";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { getUserPermissions } from "@/lib/require-permission";

interface GifUploadBody {
  source_url: string;
  filename?: string;
  content_type?: string;
  provider?: "klipy" | "tenor";
  size_bytes?: number;
}

const PROVIDER_HOSTS = {
  klipy: ["static.klipy.com", "static1.klipy.com", "static2.klipy.com"],
  tenor: ["media.tenor.com", "media1.tenor.com", "tenor.com"],
} as const;

function sanitizeGifFilename(filename: string | undefined, contentType: string): string {
  const fallbackExt = contentType === "video/mp4" ? "mp4" : "gif";
  const trimmed = (filename || `gif.${fallbackExt}`).trim();
  const withoutUnsafe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (withoutUnsafe.includes(".")) return withoutUnsafe;
  return `${withoutUnsafe}.${fallbackExt}`;
}

function isAllowedProviderUrl(url: URL, provider: "klipy" | "tenor") {
  return PROVIDER_HOSTS[provider].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
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
  const provider = body.provider === "tenor" ? "tenor" : "klipy";
  let parsedSourceUrl: URL;
  try {
    parsedSourceUrl = new URL(body.source_url);
  } catch {
    return apiError("Invalid GIF source URL", 400);
  }

  if (!isAllowedProviderUrl(parsedSourceUrl, provider)) {
    return apiError("GIF source host is not allowed for this provider", 400);
  }

  const reportedSize = Number(body.size_bytes ?? 0);
  if (Number.isFinite(reportedSize) && reportedSize > MAX_GIF_UPLOAD_BYTES) {
    return apiError("GIF too large to upload", 413);
  }

  const db = getDB();
  const attachmentId = genId();
  const now = new Date().toISOString();
  const filename = sanitizeGifFilename(body.filename, contentType);
  const key = body.source_url;
  const sizeBytes = Number.isFinite(reportedSize) && reportedSize > 0 ? Math.floor(reportedSize) : 0;

  await db.prepare(
    `INSERT INTO attachments (id, message_id, filename, file_key, content_type, size_bytes, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(attachmentId, null, filename, key, contentType, sizeBytes, userId, now).run();

  return apiSuccess({
    id: attachmentId,
    file_url: key,
    file_name: filename,
    file_size: sizeBytes,
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
