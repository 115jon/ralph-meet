import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, genId, getBucket, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheDel, CacheKey } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { checkRateLimitDO, RATE_LIMITS } from "@/lib/rate-limit";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { getUserPermissions } from "@/lib/require-permission";


const DEFAULT_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;
const SOUNDBOARD_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
const SOUNDBOARD_AUDIO_TYPES_BY_EXTENSION: Record<string, string> = {
  aac: "audio/aac",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/opus",
  wav: "audio/wav",
  weba: "audio/webm",
};

function getFileExtension(filename: string) {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function inferSoundboardContentType(file: File) {
  if (file.type.startsWith("audio/")) return file.type;
  return SOUNDBOARD_AUDIO_TYPES_BY_EXTENSION[getFileExtension(file.name)] ?? null;
}

// POST /api/channels/:id/messages/upload — upload file attachment
const POST = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: channelId } = params;

  // Rate limit: file upload limits (global DO limit)
  const rl = await checkRateLimitDO(userId, "file-upload", RATE_LIMITS.FILE_UPLOAD);
  if (rl) return rl;

  // Verify channel access
  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  // Enforce ATTACH_FILES permission for server channels
  const { serverId } = accessResult as { serverId: string | null };
  if (serverId) {
    const perms = await getUserPermissions(serverId, userId);
    if (perms === null || !hasPermission(perms, PERMISSIONS.ATTACH_FILES)) {
      return apiError("You do not have permission to upload files", 403);
    }
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const messageId = formData.get("message_id") as string | null;
  const purpose = formData.get("purpose") as string | null;
  const isSoundboardUpload = purpose === "soundboard";

  if (!file) {
    return apiError("No file provided", 400);
  }

  if (isSoundboardUpload && !serverId) {
    return apiError("Soundboard uploads require a server channel", 400);
  }

  const uploadLimit = isSoundboardUpload ? SOUNDBOARD_UPLOAD_LIMIT_BYTES : DEFAULT_UPLOAD_LIMIT_BYTES;
  if (file.size > uploadLimit) {
    return apiError(`File too large (max ${uploadLimit / 1024 / 1024}MB)`, 413);
  }

  // Accept any MIME type — security is enforced at the serving layer
  const contentType = isSoundboardUpload
    ? inferSoundboardContentType(file)
    : file.type || "application/octet-stream";

  if (!contentType) {
    return apiError("Only audio files can be uploaded to the soundboard", 400);
  }

  const db = getDB();
  const bucket = getBucket();
  const attachmentId = genId();
  const now = new Date().toISOString();

  const key = `attachments/${channelId}/${attachmentId}/${file.name}`;

  // Upload to R2
  await bucket.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType },
  });

  // Insert into the attachments table
  await db.prepare(
    `INSERT INTO attachments (id, message_id, soundboard_server_id, filename, file_key, content_type, size_bytes, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    attachmentId,
    messageId,
    isSoundboardUpload ? serverId : null,
    file.name,
    key,
    contentType,
    file.size,
    userId,
    now
  ).run();

  logger.info("file_uploaded", {
    userId,
    channelId,
    attachmentId,
    filename: file.name,
    contentType,
    sizeBytes: file.size,
  });

  if (isSoundboardUpload && serverId) {
    await cacheDel(CacheKey.serverSoundboard(serverId));
  }

  return apiSuccess({
    id: attachmentId,
    file_url: `/api/${key}`,
    file_name: file.name,
    file_size: file.size,
    content_type: contentType,
  }, 201);
}


export const Route = createFileRoute('/api/channels/$id/messages/upload')({
  server: {
    handlers: {
      POST,
    }
  }
});
