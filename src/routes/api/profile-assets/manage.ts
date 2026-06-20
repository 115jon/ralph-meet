import { createFileRoute } from "@tanstack/react-router";

import {
  type ProfileAssetKind,
  getProfileAssetStorageKey,
  getProfileAssetStoragePrefix,
  getProfileAssetUrl,
  isProfileAssetKind,
} from "@/lib/profile-assets";
import { apiError, apiSuccess, broadcastToAll, getBucket, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheDel, CacheKey } from "@/lib/cache";
import { logger } from "@/lib/logger";
import {
  MAX_PROFILE_BANNER_SIZE,
  MAX_PROFILE_NAMEPLATE_SIZE,
  validateProfileBannerBuffer,
  validateProfileNameplateBuffer,
} from "@/lib/profile-asset-validation";
import { checkRateLimitDO, RATE_LIMITS } from "@/lib/rate-limit";
import { clearProfileAsset, updateProfileAsset } from "@/services/user.service";

async function listExistingAssetKeys(kind: ProfileAssetKind, userId: string): Promise<string[]> {
  const bucket = getBucket();
  const listed = await bucket.list({ prefix: getProfileAssetStoragePrefix(kind, userId) });
  return listed.objects.map((object: { key: string }) => object.key);
}

async function deleteAssetKeys(keys: string[]) {
  if (keys.length === 0) return;
  await getBucket().delete(keys);
}

async function invalidateProfileCaches(userId: string, serverIds: string[]) {
  await cacheDel(CacheKey.userProfile(userId));
  await cacheDel(CacheKey.userServers(userId));

  if (serverIds.length === 0) return;
  await Promise.all(serverIds.map((serverId) => cacheDel(CacheKey.serverMembers(serverId))));
}

async function broadcastProfileUpdate(
  userId: string,
  result: Awaited<ReturnType<typeof updateProfileAsset>> | Awaited<ReturnType<typeof clearProfileAsset>>,
) {
  await broadcastToAll("USER_PROFILE_UPDATE", {
    user_id: userId,
    username: result.username,
    banner_url: result.user.banner_url,
    banner_content_type: result.user.banner_content_type,
    nameplate_url: result.user.nameplate_url,
    nameplate_content_type: result.user.nameplate_content_type,
    updated_at: result.updatedAt,
  });
}

const POST = async ({ request }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const rl = await checkRateLimitDO(userId, "profile-asset-upload", RATE_LIMITS.FILE_UPLOAD);
  if (rl) return rl;

  const formData = await request.formData();
  const kindValue = formData.get("kind");
  const file = formData.get("file") as File | null;

  if (!isProfileAssetKind(kindValue)) {
    return apiError("Invalid profile asset kind", 400);
  }

  if (!file) {
    return apiError("No file provided", 400);
  }

  const maxSize = kindValue === "banner" ? MAX_PROFILE_BANNER_SIZE : MAX_PROFILE_NAMEPLATE_SIZE;
  if (file.size > maxSize) {
    return apiError(
      kindValue === "banner"
        ? "Banner too large (max 8MB)"
        : "Nameplate too large (max 25MB)",
      413,
    );
  }

  const buffer = await file.arrayBuffer();
  const validation = kindValue === "banner"
    ? validateProfileBannerBuffer(buffer)
    : validateProfileNameplateBuffer(buffer);

  if (!validation.ok) {
    logger.security("profile_asset_upload_invalid_magic_bytes", {
      userId,
      kind: kindValue,
      filename: file.name,
      declared_type: file.type,
    });
    return apiError(validation.error, 415);
  }

  const key = getProfileAssetStorageKey(kindValue, userId, validation.ext);
  const url = getProfileAssetUrl(kindValue, userId, validation.ext);
  const existingKeys = await listExistingAssetKeys(kindValue, userId);

  await getBucket().put(key, buffer, {
    httpMetadata: { contentType: validation.mimeType },
  });

  let result: Awaited<ReturnType<typeof updateProfileAsset>>;
  try {
    result = await updateProfileAsset(getDB(), userId, kindValue, {
      url,
      contentType: validation.mimeType,
    });
  } catch (error) {
    try {
      await deleteAssetKeys([key]);
    } catch (cleanupError) {
      logger.error("profile_asset_upload_cleanup_failed", {
        userId,
        kind: kindValue,
        key,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
    throw error;
  }

  const staleKeys = existingKeys.filter((existingKey: string) => existingKey !== key);
  if (staleKeys.length > 0) {
    try {
      await deleteAssetKeys(staleKeys);
    } catch (cleanupError) {
      logger.error("profile_asset_old_asset_cleanup_failed", {
        userId,
        kind: kindValue,
        key,
        staleKeys,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
  }

  await invalidateProfileCaches(userId, result.serverIds);
  await broadcastProfileUpdate(userId, result);

  logger.info("profile_asset_uploaded", {
    userId,
    kind: kindValue,
    key,
    contentType: validation.mimeType,
    sizeBytes: file.size,
  });

  return apiSuccess({
    kind: kindValue,
    url: kindValue === "banner" ? result.user.banner_url : result.user.nameplate_url,
    content_type: validation.mimeType,
    updated_at: result.updatedAt,
  }, 201);
};

const DELETE = async ({ request }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  let body: { kind?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  if (!isProfileAssetKind(body.kind)) {
    return apiError("Invalid profile asset kind", 400);
  }

  const existingKeys = await listExistingAssetKeys(body.kind, userId);
  const result = await clearProfileAsset(getDB(), userId, body.kind);

  if (existingKeys.length > 0) {
    try {
      await deleteAssetKeys(existingKeys);
    } catch (cleanupError) {
      logger.error("profile_asset_delete_cleanup_failed", {
        userId,
        kind: body.kind,
        existingKeys,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
  }

  await invalidateProfileCaches(userId, result.serverIds);
  await broadcastProfileUpdate(userId, result);

  logger.info("profile_asset_deleted", {
    userId,
    kind: body.kind,
  });

  return apiSuccess({
    ok: true,
    kind: body.kind,
    updated_at: result.updatedAt,
  });
};

export const Route = createFileRoute("/api/profile-assets/manage")({
  server: {
    handlers: {
      POST,
      DELETE,
    },
  },
});
