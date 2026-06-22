import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheFetch, CacheKey, CacheTTL } from "@/lib/cache";
import { listServerSoundboardSounds } from "@/services/soundboard.service";

// GET /api/servers/:id/soundboard — list server soundboard clips
const GET = async ({ request, params }: any) => {
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
    () => listServerSoundboardSounds(db, serverId)
  );

  return apiSuccess(sounds);
};

// DELETE /api/servers/:id/soundboard?soundId=XYZ
const DELETE = async ({ request, params }: any) => {
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
    .prepare(`
      SELECT m.id, s.owner_id, 
        (SELECT json_group_array(json_object('permissions', r.permissions)) 
         FROM server_roles r 
         JOIN server_member_roles smr ON r.id = smr.role_id 
         WHERE smr.member_id = m.id) as roles
      FROM server_members m 
      JOIN servers s ON m.server_id = s.id
      WHERE m.server_id = ? AND m.user_id = ?
    `)
    .bind(serverId, userId)
    .first<any>();

  if (!member) return apiError("Not a member", 403);

  // Parse permissions
  const isOwner = member.owner_id === userId;
  let canManageServer = isOwner;
  if (!isOwner && member.roles) {
    try {
      const roles = JSON.parse(member.roles);
      // manage_server is usually 0x20 in discord-like bitfields, but let's just check if they are owner or if we should check 'manage_server' permission bit (32)
      canManageServer = roles.some((r: any) => (r.permissions & 32) === 32 || (r.permissions & 8) === 8); // 8 is administrator
    } catch {}
  }

  // Find the attachment
  const attachment = await db.prepare(
    `SELECT user_id FROM attachments WHERE id = ? AND soundboard_server_id = ?`
  ).bind(soundId, serverId).first<{user_id: string}>();

  if (!attachment) return apiError("Sound not found", 404);

  if (attachment.user_id !== userId && !canManageServer) {
    return apiError("Missing permissions to delete this sound", 403);
  }

  await db.prepare(`DELETE FROM attachments WHERE id = ? AND soundboard_server_id = ?`).bind(soundId, serverId).run();
  
  // Clear the cache
  const env = getEnv();
  if (env?.KV) {
    await env.KV.delete(CacheKey.serverSoundboard(serverId));
  }

  return apiSuccess({ deleted: true });
};

export const Route = createFileRoute("/api/servers/$id/soundboard")({
  server: {
    handlers: {
      GET,
      DELETE,
    },
  },
});
