import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, genId, getBucket, getDB, requireAuth } from "@/lib/api-helpers";
import { logger } from "@/lib/logger";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { checkRateLimitDO, RATE_LIMITS } from "@/lib/rate-limit";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { getUserPermissions } from "@/lib/require-permission";


// Discord-style: allow ANY file type to be uploaded.
// Security is enforced at the serving layer, not the upload layer.
// The only restriction is the 25MB size limit.

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

  if (!file) {
    return apiError("No file provided", 400);
  }

  // Size limit: 25MB (the only hard restriction, like Discord)
  if (file.size > 25 * 1024 * 1024) {
    return apiError("File too large (max 25MB)", 413);
  }

  // Accept any MIME type — security is enforced at the serving layer
  const contentType = file.type || "application/octet-stream";

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
    `INSERT INTO attachments (id, message_id, filename, file_key, content_type, size_bytes, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(attachmentId, messageId, file.name, key, contentType, file.size, userId, now).run();

  logger.info("file_uploaded", {
    userId,
    channelId,
    attachmentId,
    filename: file.name,
    contentType,
    sizeBytes: file.size,
  });

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
