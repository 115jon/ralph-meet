import { createFileRoute } from "@tanstack/react-router";

import {
  apiError,
  apiSuccess,
  getBucket,
  getDB,
  requireAuth,
} from "@/lib/api-helpers";
import { cacheFetch, cacheDel, CacheKey, CacheTTL } from "@/lib/cache";
import { listServerSoundboardSounds } from "@/services/soundboard.service";
import { getUserPermissions } from "@/lib/require-permission";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getSoundboardUploadUrl } from "@/lib/voice/soundboard-media";
import { logger } from "@/lib/logger";
import {
  recordR2CleanupFailure,
  retryR2Cleanup,
} from "@/services/r2-cleanup.service";

// GET /api/servers/:id/soundboard — list server soundboard clips
export const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId } = params;

  const db = getDB();
  const member = await db
    .prepare(`SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`)
    .bind(serverId, userId)
    .first();

  if (!member) {
    return apiError("Not a member", 403);
  }

  const sounds = await cacheFetch(
    CacheKey.serverSoundboard(serverId),
    CacheTTL.SERVER_SOUNDBOARD,
    () => listServerSoundboardSounds(db, serverId),
  );

  return apiSuccess(
    sounds.map((sound) => ({
      ...sound,
      file_url: getSoundboardUploadUrl(sound.id),
    })),
  );
};

// DELETE /api/servers/:id/soundboard?soundId=XYZ
const DELETE = async ({ request, params }: any) => {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) return authResult;
    const { userId } = authResult;
    const { id: serverId } = params;

    const url = new URL(request.url);
    const soundId = url.searchParams.get("soundId");
    if (!soundId) return apiError("Missing soundId", 400);

    const db = getDB();

    // Get member info to check if admin/owner
    const member = await db
      .prepare(
        `
        SELECT s.owner_id
        FROM server_members m 
        JOIN servers s ON m.server_id = s.id
        WHERE m.server_id = ? AND m.user_id = ?
      `,
      )
      .bind(serverId, userId)
      .first<{ owner_id: string }>();

    if (!member) return apiError("Not a member", 403);

    const userPerms = (await getUserPermissions(serverId, userId)) ?? 0;
    const isOwner = member.owner_id === userId;
    const canManageServer =
      isOwner || hasPermission(userPerms, PERMISSIONS.MANAGE_SERVER);

    await retryR2Cleanup(db, getBucket());

    // Find the attachment
    const attachment = await db
      .prepare(
        `SELECT user_id, file_key FROM attachments WHERE id = ? AND soundboard_server_id = ?`,
      )
      .bind(soundId, serverId)
      .first<{ user_id: string; file_key: string }>();

    if (!attachment) return apiError("Sound not found", 404);

    if (attachment.user_id !== userId && !canManageServer) {
      return apiError("Missing permissions to delete this sound", 403);
    }

    await db
      .prepare(
        `DELETE FROM attachments WHERE id = ? AND soundboard_server_id = ?`,
      )
      .bind(soundId, serverId)
      .run();

    try {
      await getBucket().delete(attachment.file_key);
    } catch (error) {
      logger.error("soundboard_delete_cleanup_failed", {
        soundId,
        serverId,
        fileKey: attachment.file_key,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await recordR2CleanupFailure(db, attachment.file_key, error);
      } catch (queueError) {
        logger.error("soundboard_delete_cleanup_record_failed", {
          soundId,
          serverId,
          fileKey: attachment.file_key,
          error:
            queueError instanceof Error
              ? queueError.message
              : String(queueError),
        });
      }
    }

    await cacheDel(CacheKey.serverSoundboard(serverId));

    return apiSuccess({ deleted: true });
  } catch (err: unknown) {
    logger.error("DELETE soundboard error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return apiError("Internal server error", 500);
  }
};

export { DELETE };

// PATCH /api/servers/:id/soundboard?soundId=XYZ
const PATCH = async ({ request, params }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId } = params;

  const url = new URL(request.url);
  const soundId = url.searchParams.get("soundId");
  if (!soundId) return apiError("Missing soundId", 400);

  const body = await request.json();
  const { sound_name, sound_emoji, sound_volume } = body;

  const db = getDB();

  // Get member info to check if admin/owner
  const member = await db
    .prepare(
      `
      SELECT s.owner_id
      FROM server_members m 
      JOIN servers s ON m.server_id = s.id
      WHERE m.server_id = ? AND m.user_id = ?
    `,
    )
    .bind(serverId, userId)
    .first<{ owner_id: string }>();

  if (!member) return apiError("Not a member", 403);

  const userPerms = (await getUserPermissions(serverId, userId)) ?? 0;
  const isOwner = member.owner_id === userId;
  const canManageServer =
    isOwner || hasPermission(userPerms, PERMISSIONS.MANAGE_SERVER);

  const attachment = await db
    .prepare(
      `SELECT user_id FROM attachments WHERE id = ? AND soundboard_server_id = ?`,
    )
    .bind(soundId, serverId)
    .first<{ user_id: string }>();

  if (!attachment) return apiError("Sound not found", 404);

  if (attachment.user_id !== userId && !canManageServer) {
    return apiError("Missing permissions to edit this sound", 403);
  }

  try {
    await db
      .prepare(
        `
      UPDATE attachments 
      SET sound_name = COALESCE(?, sound_name), 
          sound_emoji = ?, 
          sound_volume = COALESCE(?, sound_volume)
      WHERE id = ? AND soundboard_server_id = ?
    `,
      )
      .bind(
        sound_name ?? null,
        sound_emoji ?? null,
        sound_volume ?? null,
        soundId,
        serverId,
      )
      .run();

    await cacheDel(CacheKey.serverSoundboard(serverId));

    return apiSuccess({ updated: true });
  } catch (err: any) {
    console.error("PATCH soundboard error:", err.stack || err);
    return apiError("Internal server error", 500);
  }
};

export const Route = createFileRoute("/api/servers/$id/soundboard")({
  server: {
    handlers: {
      GET,
      PATCH,
      DELETE,
    },
  },
});
