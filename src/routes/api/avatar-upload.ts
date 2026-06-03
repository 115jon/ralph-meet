import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, broadcastToAll, getBucket, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheDel, CacheKey } from "@/lib/cache";
import { MAX_IMAGE_SIZE, validateImageBuffer } from "@/lib/image-validation";
import { logger } from "@/lib/logger";
import { checkRateLimitDO, RATE_LIMITS } from "@/lib/rate-limit";
import { updateAvatarUrl } from "@/services/user.service";


// POST /api/avatar-upload — upload a user avatar to R2
const POST = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  // Rate limit
  const rl = await checkRateLimitDO(userId, "avatar-upload", RATE_LIMITS.FILE_UPLOAD);
  if (rl) return rl;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return apiError("No file provided", 400);
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

  // R2 key: avatars/{userId}.{ext} — overwrites previous avatar
  const key = `avatars/${userId}.${validation.ext}`;
  const avatarUrl = `/api/avatars/${userId}.${validation.ext}`;

  const bucket = getBucket();
  await bucket.put(key, buffer, {
    httpMetadata: { contentType: validation.mimeType },
  });

  // ── Update D1 + invalidate caches ───────────────────────────────
  const db = getDB();
  const result = await updateAvatarUrl(db, userId, avatarUrl);

  // ── Cache invalidation ──────────────────────────────────────────
  await cacheDel(CacheKey.userProfile(userId));
  if (result.serverIds.length) {
    await Promise.all(
      result.serverIds.map((sid) => cacheDel(CacheKey.serverMembers(sid)))
    );
  }

  // ── Broadcast to all connected clients ──────────────────────────
  await broadcastToAll("USER_PROFILE_UPDATE", {
    user_id: userId,
    username: result.username,
    avatar_url: result.avatarUrl,
    updated_at: result.updatedAt,
  });

  logger.info("Avatar uploaded", { userId, key });

  return apiSuccess({ url: result.avatarUrl }, 201);
}


export const Route = createFileRoute('/api/avatar-upload')({
  server: {
    handlers: {
      POST,
    }
  }
});
