import { apiSuccess, apiError, broadcastToChannel, getDB, requireAuth } from "@/lib/api-helpers";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { getUserChannelPermissions } from "@/lib/require-permission";
import { AddReactionSchema } from "@/lib/validations";
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

  // Verify channel access
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

  // Rate limit: 20 reactions per minute
  const rl = checkRateLimit(userId, "reaction", RATE_LIMITS.REACTION);
  if (rl) return rl;

  const body = await request.json();
  const parsed = AddReactionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { message_id, emoji } = parsed.data;

  const db = getDB();
  const now = new Date().toISOString();

  // Upsert — ignore if already reacted
  await db.prepare(
    `INSERT INTO message_reactions (message_id, user_id, emoji, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (message_id, user_id, emoji) DO NOTHING`
  ).bind(message_id, userId, emoji, now).run();

  await broadcastToChannel(channelId, "REACTION_ADD", {
    message_id,
    channel_id: channelId,
    user_id: userId,
    emoji,
  });

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

  // Verify channel access
  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof NextResponse) return accessResult;

  // Enforce ADD_REACTIONS permission for server channels
  const { serverId } = accessResult as { serverId: string | null };
  if (serverId) {
    const perms = await getUserChannelPermissions(serverId, channelId, userId);
    if (perms === null || !hasPermission(perms, PERMISSIONS.ADD_REACTIONS)) {
      return apiError("You do not have permission to manage reactions", 403);
    }
  }

  // Rate limit: 20 reactions per minute
  const rl = checkRateLimit(userId, "reaction", RATE_LIMITS.REACTION);
  if (rl) return rl;

  const body = await request.json();
  const parsed = AddReactionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { message_id, emoji } = parsed.data;

  const db = getDB();

  await db.prepare(
    `DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?`
  ).bind(message_id, userId, emoji).run();

  await broadcastToChannel(channelId, "REACTION_REMOVE", {
    message_id,
    channel_id: channelId,
    user_id: userId,
    emoji,
  });

  return apiSuccess({ removed: true });
}
