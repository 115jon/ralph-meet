import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, genId, getBucket, getDB, requireActiveVoiceChannelSession, requireAuth } from "@/lib/api-helpers";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/permissions";
import { checkRateLimitDO, RATE_LIMITS } from "@/lib/rate-limit";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { requireChannelPermission } from "@/lib/require-permission";
import {
  buildExternalVoiceStatusMediaFileKey,
  MAX_VOICE_STATUS_MEDIA_RECENTS,
  MAX_VOICE_STATUS_MEDIA_UPLOAD_BYTES,
  buildVoiceStatusMediaStorageKey,
  getVoiceStatusMediaUploadContentType,
} from "@/lib/voice-status-media";
import { sanitizeVoiceChannelStatusMedia } from "@/lib/voice-channel-status";
import {
  createOrReuseExternalVoiceStatusMediaAsset,
  createVoiceStatusMediaAsset,
  listRecentVoiceStatusMediaAssets,
} from "@/services/voice-status-media.service";
import type { VoiceChannelStatusMedia } from "@/lib/types";

function extensionForVoiceStatusMedia(contentType: VoiceChannelStatusMedia["preview_content_type"]): string {
  switch (contentType) {
    case "image/gif":
      return "gif";
    case "image/apng":
      return "apng";
    case "image/webp":
      return "webp";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
  }
}

function sanitizeUploadFilename(filename: string): string {
  const sanitized = filename
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  return sanitized || "voice-status-media";
}

function parseDimensionField(value: FormDataEntryValue | null): number {
  const parsed = typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

async function requireVoiceStatusMediaAccess(request: Request, channelId: string) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  if (!accessResult.serverId) {
    return apiError("Voice status media is only available for server voice channels", 400, undefined, request);
  }

  const permissionResult = await requireChannelPermission(
    accessResult.serverId,
    channelId,
    userId,
    PERMISSIONS.CONNECT,
    "You do not have permission to manage this voice channel status",
  );
  if (permissionResult instanceof Response) return permissionResult;

  const activeVoiceSessionResult = await requireActiveVoiceChannelSession(
    request,
    userId,
    channelId,
    accessResult.serverId,
    "You must be actively connected to this voice channel to manage its media status.",
  );
  if (activeVoiceSessionResult instanceof Response) return activeVoiceSessionResult;

  return {
    userId,
    serverId: accessResult.serverId,
  };
}

const GET = async ({ request, params }: any) => {
  const { id: channelId } = params;
  const access = await requireVoiceStatusMediaAccess(request, channelId);
  if (access instanceof Response) return access;

  const items = await listRecentVoiceStatusMediaAssets(getDB(), access.serverId, MAX_VOICE_STATUS_MEDIA_RECENTS);
  return apiSuccess({ items }, 200, request);
};

const POST = async ({ request, params }: any) => {
  const { id: channelId } = params;
  const access = await requireVoiceStatusMediaAccess(request, channelId);
  if (access instanceof Response) return access;

  const rl = await checkRateLimitDO(access.userId, "voice-status-media-upload", RATE_LIMITS.FILE_UPLOAD);
  if (rl) return rl;

  const contentTypeHeader = request.headers.get("content-type") ?? "";

  if (contentTypeHeader.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return apiError("No media file provided", 400, undefined, request);
    }

    if (file.size > MAX_VOICE_STATUS_MEDIA_UPLOAD_BYTES) {
      return apiError("Voice status media must be 25 MB or smaller.", 413, undefined, request);
    }

    const contentType = getVoiceStatusMediaUploadContentType(file);
    if (!contentType) {
      return apiError("Only GIF, PNG, JPG, WEBP, MP4, and WEBM files are supported.", 415, undefined, request);
    }

    const filename = sanitizeUploadFilename(file.name);
    const previewWidth = parseDimensionField(formData.get("preview_width"));
    const previewHeight = parseDimensionField(formData.get("preview_height"));
    const assetId = genId();
    const fileKey = buildVoiceStatusMediaStorageKey(access.serverId, assetId, filename);
    const buffer = await file.arrayBuffer();
    const bucket = getBucket();

    await bucket.put(fileKey, buffer, {
      httpMetadata: { contentType },
    });

    try {
      const item = await createVoiceStatusMediaAsset(getDB(), {
        assetId,
        fileKey,
        serverId: access.serverId,
        channelId,
        userId: access.userId,
        filename,
        contentType,
        previewWidth,
        previewHeight,
        sizeBytes: file.size,
      });

      return apiSuccess({ item }, 201, request);
    } catch (error) {
      try {
        await bucket.delete(fileKey);
      } catch (cleanupError) {
        logger.error("voice_status_media_upload_cleanup_failed", {
          userId: access.userId,
          channelId,
          fileKey,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }

      throw error;
    }
  }

  const body = await request.json();
  const media = sanitizeVoiceChannelStatusMedia((body as { media?: unknown }).media);
  if (!media) {
    return apiError("No valid media was provided.", 400, undefined, request);
  }

  const assetId = genId();
  const filename = sanitizeUploadFilename(
    `${media.provider || "media"}-${assetId}.${extensionForVoiceStatusMedia(media.preview_content_type)}`,
  );
  const item = await createOrReuseExternalVoiceStatusMediaAsset(getDB(), {
    assetId,
    fileKey: buildExternalVoiceStatusMediaFileKey(media.preview_url),
    serverId: access.serverId,
    channelId,
    userId: access.userId,
    filename,
    contentType: media.preview_content_type,
    previewWidth: media.preview_width,
    previewHeight: media.preview_height,
    sizeBytes: 0,
  });

  return apiSuccess({
    item: {
      ...item,
      media: {
        ...media,
        id: item.id,
      },
    },
  }, 201, request);
};

export const Route = createFileRoute("/api/channels/$id/voice-status-media")({
  server: {
    handlers: {
      GET,
      POST,
    },
  },
});
