import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { getUserChannelPermissions } from "@/lib/require-permission";
import { AddReactionSchema } from "@/lib/validations";
import { addReaction, removeReaction } from "@/services/message.service";
import { executeBroadcast } from "@/services/service-helpers";
import { NextResponse } from "next/server";

// PUT /api/channels/:id/reactions — add a reaction
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id: channelId } = await params;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof NextResponse) return accessResult;

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
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const db = getDB();
  const result = await addReaction(db, channelId, userId, parsed.data.message_id, parsed.data.emoji);
  await executeBroadcast(result.broadcast);

  return apiSuccess({ added: true });
}

// DELETE /api/channels/:id/reactions — remove a reaction
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id: channelId } = await params;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof NextResponse) return accessResult;

  const { serverId } = accessResult as { serverId: string | null };
  if (serverId) {
    const perms = await getUserChannelPermissions(serverId, channelId, userId);
    if (perms === null || !hasPermission(perms, PERMISSIONS.ADD_REACTIONS)) {
      return apiError("You do not have permission to manage reactions", 403);
    }
  }

  const rl = checkRateLimit(userId, "reaction", RATE_LIMITS.REACTION);
  if (rl) return rl;

  const body = await request.json();
  const parsed = AddReactionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const db = getDB();
  const result = await removeReaction(db, channelId, userId, parsed.data.message_id, parsed.data.emoji);
  await executeBroadcast(result.broadcast);

  return apiSuccess({ removed: true });
}
