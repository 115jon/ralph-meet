import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, genId, getBucket, getDB, requireAuth } from "@/lib/api-helpers";
import { logger } from "@/lib/logger";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { checkRateLimitDO, RATE_LIMITS } from "@/lib/rate-limit";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { getUserPermissions } from "@/lib/require-permission";


// Discord-style file type allowlist
// These are the MIME types that are allowed for upload.
// Anything not on this list is rejected.
const ALLOWED_MIME_TYPES = new Set([
  // Images
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/tiff",
  "image/svg+xml",
  // Video
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/mpeg",
  // Audio
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/flac",
  "audio/aac",
  "audio/x-m4a",
  "audio/mp4",
  // Documents
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  // Archives
  "application/zip",
  "application/x-zip-compressed",
  "application/gzip",
  "application/x-gzip",
  "application/x-tar",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  // Microsoft Office
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Other common formats
  "application/json",
  "application/xml",
  "application/octet-stream", // Generic binary (for unknown file types)
]);

// File extensions that are always blocked regardless of MIME type
const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".com", ".msi", ".scr", ".pif",
  ".vbs", ".vbe", ".js", ".jse", ".ws", ".wsf", ".wsc", ".wsh",
  ".ps1", ".ps1xml", ".ps2", ".ps2xml", ".psc1", ".psc2",
  ".msh", ".msh1", ".msh2", ".mshxml", ".msh1xml", ".msh2xml",
  ".cpl", ".inf", ".reg", ".rgs", ".sct", ".shb", ".shs",
  ".lnk", ".dll", ".sys", ".drv", ".ocx",
  ".hta", ".htm", ".html", // Prevent stored XSS
  ".app", ".action", ".command", // macOS
  ".sh", ".csh", ".bash", ".zsh", // Unix shells
]);

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.slice(lastDot).toLowerCase();
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

  if (!file) {
    return apiError("No file provided", 400);
  }

  // Size limit: 25MB
  if (file.size > 25 * 1024 * 1024) {
    return apiError("File too large (max 25MB)", 413);
  }

  // ── File type validation ─────────────────────────────────────────
  const ext = getFileExtension(file.name);
  if (BLOCKED_EXTENSIONS.has(ext)) {
    logger.security("upload_blocked_extension", {
      userId,
      channelId,
      filename: file.name,
      extension: ext,
    });
    return apiError(`File type "${ext}" is not allowed`, 415);
  }

  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED_MIME_TYPES.has(contentType)) {
    logger.security("upload_blocked_mime", {
      userId,
      channelId,
      filename: file.name,
      content_type: contentType,
    });
    return apiError(`File type "${contentType}" is not allowed`, 415);
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
    `INSERT INTO attachments (id, message_id, filename, file_key, content_type, size_bytes, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(attachmentId, messageId, file.name, key, contentType, file.size, userId, now).run();

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
