import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, genId, getDB, requireAuth } from "@/lib/api-helpers";
import { MAX_GIF_UPLOAD_BYTES, type GifProvider } from "@/lib/gif-picker";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { checkRateLimitDO, RATE_LIMITS } from "@/lib/rate-limit";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { getUserPermissions } from "@/lib/require-permission";

interface GifUploadBody {
  source_url: string;
  filename?: string;
  content_type?: string;
  provider?: GifProvider;
  size_bytes?: number;
}

type HostedGifProvider = Exclude<GifProvider, "external">;

const PROVIDER_HOSTS = {
  klipy: ["static.klipy.com", "static1.klipy.com", "static2.klipy.com"],
  tenor: ["media.tenor.com", "media1.tenor.com", "tenor.com"],
} as const;

const EXTERNAL_MEDIA_HOSTS = new Set([
  "video.twimg.com",
  "pbs.twimg.com",
  "gif.fxtwitter.com",
  "vxtwitter.com",
]);

function sanitizeGifFilename(filename: string | undefined, contentType: string): string {
  const fallbackExt = contentType === "video/mp4" ? "mp4" : contentType === "image/apng" ? "apng" : contentType === "image/webp" ? "webp" : "gif";
  const trimmed = (filename || `gif.${fallbackExt}`).trim();
  const withoutUnsafe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (withoutUnsafe.includes(".")) return withoutUnsafe;
  return `${withoutUnsafe}.${fallbackExt}`;
}

function normalizeGifContentType(contentType: string | undefined): "image/gif" | "image/apng" | "image/webp" | "video/mp4" {
  const mime = contentType?.toLowerCase().split(";")[0].trim();
  if (mime === "image/apng") return "image/apng";
  if (mime === "image/webp") return "image/webp";
  if (mime === "video/mp4" || mime?.startsWith("video/")) return "video/mp4";
  return "image/gif";
}

function normalizeUploadProvider(provider: GifUploadBody["provider"]): GifProvider {
  if (provider === "tenor" || provider === "external") return provider;
  return "klipy";
}

function isAllowedProviderUrl(url: URL, provider: HostedGifProvider) {
  return PROVIDER_HOSTS[provider].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

function isAllowedLocalMediaUrl(url: URL, requestUrl: URL, rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith("/api/attachments/") || trimmed.startsWith("/api/proxy-media?")) return true;

  if (url.origin !== requestUrl.origin) return false;
  return url.pathname.startsWith("/api/attachments/") || url.pathname === "/api/proxy-media";
}

function isAllowedExternalMediaUrl(url: URL) {
  if (url.protocol !== "https:") return false;

  const hostname = url.hostname.toLowerCase();
  if (EXTERNAL_MEDIA_HOSTS.has(hostname)) return true;

  return (
    hostname === "api16-normal-useast5.tiktokv.us" ||
    hostname.endsWith(".tiktokv.us") ||
    hostname.endsWith(".tiktokcdn-us.com") ||
    hostname.endsWith(".tiktokcdn.com")
  );
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

  const requestUrl = new URL(request.url);
  const contentType = normalizeGifContentType(body.content_type);
  const provider = normalizeUploadProvider(body.provider);
  let parsedSourceUrl: URL;
  try {
    parsedSourceUrl = new URL(body.source_url, requestUrl);
  } catch {
    return apiError("Invalid GIF source URL", 400);
  }

  if (provider === "external" && !isAllowedLocalMediaUrl(parsedSourceUrl, requestUrl, body.source_url) && !isAllowedExternalMediaUrl(parsedSourceUrl)) {
    return apiError("GIF source host is not allowed for this provider", 400);
  }

  if (provider !== "external" && !isAllowedProviderUrl(parsedSourceUrl, provider)) {
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
