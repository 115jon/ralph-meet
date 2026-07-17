import { createFileRoute } from "@tanstack/react-router";

import {
  apiError,
  apiSuccess,
  broadcastToUserServers,
  getBucket,
  getDB,
  requireAuth,
} from "@/lib/api-helpers";
import { cacheDel, CacheKey } from "@/lib/cache";
import { MAX_IMAGE_SIZE, validateImageBuffer } from "@/lib/image-validation";
import { logger } from "@/lib/logger";
import { checkRateLimitDO, RATE_LIMITS } from "@/lib/rate-limit";
import { updateAvatarUrl } from "@/services/user.service";
import {
  createUserAvatarUpload,
  deleteUserAvatarUpload,
  getAvatarUploadPruneList,
  listUserAvatarUploads,
  markUserAvatarUploadPendingDeletion,
  type UserAvatarUpload,
} from "@/services/user-avatar.service";
import { normalizeAvatarDisplay } from "@/lib/avatar-display";

// POST /api/avatar-upload — upload a user avatar to R2
const POST = async ({ request, params: _params }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  // Rate limit
  const rl = await checkRateLimitDO(
    userId,
    "avatar-upload",
    RATE_LIMITS.FILE_UPLOAD,
  );
  if (rl) return rl;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const avatarDisplayInput = formData.get("avatar_display");
  const avatarDisplayRaw =
    typeof avatarDisplayInput === "string" ? avatarDisplayInput : null;
  const avatarDisplay = avatarDisplayRaw
    ? normalizeAvatarDisplay(avatarDisplayRaw)
    : null;

  if (!file) {
    return apiError("No file provided", 400);
  }

  if (avatarDisplayRaw && !avatarDisplay) {
    return apiError("Invalid avatar display metadata", 400);
  }

  if (file.size > MAX_IMAGE_SIZE) {
    return apiError("Avatar too large (max 8MB)", 413);
  }

  // ── Magic byte validation ───────────────────────────────────────
  const buffer = await file.arrayBuffer();
  const validation = validateImageBuffer(buffer);

  if (!validation.ok) {
    logger.security("avatar_upload_invalid_magic_bytes", {
      userId,
      filename: file.name,
      declared_type: file.type,
    });
    return apiError(validation.error, 415);
  }

  const previousUser = await getDB()
    .prepare("SELECT avatar_url FROM users WHERE id = ?")
    .bind(userId)
    .first<{ avatar_url: string | null }>();
  const uploadId = crypto.randomUUID();
  const key = `avatars/${userId}/${uploadId}.${validation.ext}`;
  const avatarUrl = `/api/avatars/${userId}/${uploadId}.${validation.ext}`;

  const bucket = getBucket();
  await bucket.put(key, buffer, {
    httpMetadata: { contentType: validation.mimeType },
  });

  const upload: UserAvatarUpload = {
    id: uploadId,
    user_id: userId,
    file_key: key,
    avatar_url: avatarUrl,
    content_type: validation.mimeType,
    created_at: new Date().toISOString(),
  };

  const db = getDB();
  let result: Awaited<ReturnType<typeof updateAvatarUrl>>;
  try {
    await createUserAvatarUpload(db, upload);
    result = await updateAvatarUrl(db, userId, avatarUrl, avatarDisplay);
  } catch (error) {
    try {
      await db
        .prepare("DELETE FROM user_avatar_uploads WHERE id = ? AND user_id = ?")
        .bind(uploadId, userId)
        .run();
      await bucket.delete(key);
    } catch (cleanupError) {
      logger.error("avatar_upload_cleanup_failed", {
        userId,
        key,
        error:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
      });
    }
    throw error;
  }

  try {
    const allUploads = await listUserAvatarUploads(db, userId, 0, true);
    const staleUploads = getAvatarUploadPruneList(
      allUploads.filter((upload) => upload.pending_delete !== 1),
    );
    const pendingUploads = allUploads.filter(
      (upload) => upload.pending_delete === 1,
    );
    const markedUploads: UserAvatarUpload[] = [];
    for (const staleUpload of staleUploads) {
      if (
        await markUserAvatarUploadPendingDeletion(db, userId, staleUpload.id)
      ) {
        markedUploads.push({ ...staleUpload, pending_delete: 1 });
      }
    }
    const uploadsToDelete = [...pendingUploads, ...markedUploads];
    if (uploadsToDelete.length > 0) {
      await bucket.delete(uploadsToDelete.map((upload) => upload.file_key));
      for (const uploadToDelete of uploadsToDelete) {
        await deleteUserAvatarUpload(db, userId, uploadToDelete.id);
      }
    }
  } catch (cleanupError) {
    logger.error("avatar_upload_retention_cleanup_failed", {
      userId,
      error:
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError),
    });
  }

  const legacyAvatarPrefix = `/api/avatars/${userId}.`;
  const previousAvatarKey = previousUser?.avatar_url?.startsWith(
    legacyAvatarPrefix,
  )
    ? previousUser.avatar_url.replace(/^\/api\//, "")
    : null;
  if (previousAvatarKey && previousAvatarKey !== key) {
    try {
      await bucket.delete(previousAvatarKey);
    } catch (cleanupError) {
      logger.error("avatar_upload_legacy_cleanup_failed", {
        userId,
        key: previousAvatarKey,
        error:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
      });
    }
  }

  // ── Cache invalidation ──────────────────────────────────────────
  await cacheDel(CacheKey.userProfile(userId));
  if (result.serverIds.length) {
    await Promise.all(
      result.serverIds.map((sid) => cacheDel(CacheKey.serverMembers(sid))),
    );
  }

  // ── Broadcast to all connected clients ──────────────────────────
  await broadcastToUserServers(userId, "USER_PROFILE_UPDATE", {
    user_id: userId,
    username: result.username,
    avatar_url: result.avatarUrl,
    avatar_display: result.avatarDisplay,
    updated_at: result.updatedAt,
  });

  logger.info("Avatar uploaded", { userId, key });

  return apiSuccess(
    { url: result.avatarUrl, avatar_display: result.avatarDisplay },
    201,
  );
};

export const Route = createFileRoute("/api/avatar-upload")({
  server: {
    handlers: {
      POST,
    },
  },
});
