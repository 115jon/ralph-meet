import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { getUserChannelPermissions } from "@/lib/require-permission";
import { AddReactionSchema, RemoveReactionSchema } from "@/lib/validations";
import { addReaction, removeReaction } from "@/services/message.service";
import { executeBroadcast } from "@/services/service-helpers";

// PUT /api/channels/:id/reactions — add a reaction
export const PUT = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId } = params;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  // Enforce ADD_REACTIONS permission for server channels
  const { serverId } = accessResult as { serverId: string | null };
  if (serverId) {
    const perms = await getUserChannelPermissions(serverId, channelId, userId);
    if (perms === null || !hasPermission(perms, PERMISSIONS.ADD_REACTIONS)) {
      return apiError("You do not have permission to add reactions", 403);
    }
  }

  const rl = checkRateLimit(userId, "reaction", RATE_LIMITS.REACTION);
  if (rl) return rl;

  const body = await request.json();
  const parsed = AddReactionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const db = getDB();
  const result = await addReaction(
    db,
    channelId,
    userId,
    parsed.data.message_id,
    parsed.data.emoji,
  );
  await executeBroadcast(result.broadcast);

  return apiSuccess({ added: true });
};

// DELETE /api/channels/:id/reactions — remove a reaction
export const DELETE = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId } = params;

  const rl = checkRateLimit(userId, "reaction", RATE_LIMITS.REACTION);
  if (rl) return rl;

  const body = await request.json();
  const parsed = RemoveReactionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const targetUserId = parsed.data.target_user_id ?? userId;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  const { serverId } = accessResult as { serverId: string | null };
  if (serverId) {
    const perms = await getUserChannelPermissions(serverId, channelId, userId);
    const canManageMessages =
      perms !== null && hasPermission(perms, PERMISSIONS.MANAGE_MESSAGES);
    const canRemoveOwnReaction =
      perms !== null && hasPermission(perms, PERMISSIONS.ADD_REACTIONS);
    if (
      !canManageMessages &&
      (targetUserId !== userId || !canRemoveOwnReaction)
    ) {
      return apiError("You do not have permission to manage reactions", 403);
    }
  } else if (targetUserId !== userId) {
    return apiError("You do not have permission to manage reactions", 403);
  }

  const db = getDB();
  const result = await removeReaction(
    db,
    channelId,
    targetUserId,
    parsed.data.message_id,
    parsed.data.emoji,
  );
  if (result.broadcast) await executeBroadcast(result.broadcast);

  return apiSuccess({ removed: true });
};

export const Route = createFileRoute("/api/channels/$id/reactions")({
  server: {
    handlers: {
      PUT,
      DELETE,
    },
  },
});
