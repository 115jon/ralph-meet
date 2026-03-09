import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, broadcastToChannel, broadcastToServerMembers, broadcastToUser, genId, getDB, requireAuth } from "@/lib/api-helpers";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { getUserChannelPermissions } from "@/lib/require-permission";
import { ServiceError } from "@/lib/service-error";
import {
  createMessage,
  deleteMessage,
  editMessage,
  generateMessageNotifications,
  getDMRecipients,
  listMessages
} from "@/services/message.service";


// GET /api/channels/:id/messages — get message history (paginated)
const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId } = params;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);

  const db = getDB();

  try {
    const result = await listMessages(db, channelId, userId, {
      limit,
      before: url.searchParams.get("before"),
      after: url.searchParams.get("after"),
      around: url.searchParams.get("around"),
    });

    if (result.mode === 'around') {
      return apiSuccess({ messages: result.messages, hasMoreBefore: result.hasMoreBefore, hasMoreAfter: result.hasMoreAfter });
    }
    if (result.mode === 'after') {
      return apiSuccess({ messages: result.messages, hasMoreAfter: result.hasMoreAfter });
    }
    return apiSuccess(result.messages);
  } catch (e) {
    if (e instanceof ServiceError) {
      return apiError(e.message, e.status, e.code);
    }
    throw e;
  }
}

// POST /api/channels/:id/messages — send a message
const POST = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId } = params;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  // Enforce SEND_MESSAGES permission for server channels
  const { serverId } = accessResult as { serverId: string | null };
  if (serverId) {
    const perms = await getUserChannelPermissions(serverId, channelId, userId);
    if (perms === null || !hasPermission(perms, PERMISSIONS.SEND_MESSAGES)) {
      return apiError("You do not have permission to send messages in this channel", 403);
    }
  }

  // Rate limit
  const rl = checkRateLimit(userId, "message-send", RATE_LIMITS.MESSAGE_SEND);
  if (rl) return rl;

  const body = await request.json() as {
    content: string;
    reply_to_id?: string;
    nonce?: string;
    attachment_ids?: string[];
  };

  const hasContent = body.content?.trim();
  const hasAttachments = body.attachment_ids && body.attachment_ids.length > 0;

  if (!hasContent && !hasAttachments) {
    return apiError("Content or attachments required", 400);
  }

  const db = getDB();
  const messageId = genId();

  const message = await createMessage(db, channelId, userId, messageId, body);

  // Broadcast MESSAGE_CREATE to all server members (server channels) or recipients (DMs)
  if (serverId) {
    await broadcastToServerMembers(serverId, "MESSAGE_CREATE", message);
  } else {
    // DM: broadcast to channel subscribers (sender) + each recipient
    await broadcastToChannel(channelId, "MESSAGE_CREATE", message);
    const recipients = await getDMRecipients(db, channelId, userId);
    for (const recipientId of recipients) {
      await broadcastToUser(recipientId, "MESSAGE_CREATE", message);
    }
  }

  // Notification generation
  try {
    const author = message.author as { id: unknown; username: string; avatar_url: unknown };
    const notifBroadcasts = await generateMessageNotifications(db, genId, {
      channelId,
      messageId,
      authorId: userId,
      authorUsername: author.username,
      authorAvatarUrl: (author.avatar_url as string) ?? null,
      content: (message.content as string) ?? "",
      replyToId: body.reply_to_id,
    });
    for (const nb of notifBroadcasts) {
      await broadcastToUser(nb.userId, nb.event, nb.data);
    }
  } catch (e) {
    console.error("[notifications] Failed to create notifications:", e);
  }

  return apiSuccess(message, 201);
}

// PATCH /api/channels/:id/messages — edit a message
const PATCH = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId } = params;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  const body = await request.json() as { message_id: string; content: string };

  if (!body.message_id || !body.content?.trim()) {
    return apiError("message_id and content required", 400);
  }

  const db = getDB();

  try {
    const update = await editMessage(db, channelId, userId, body.message_id, body.content);
    const { serverId: editServerId } = accessResult as { serverId: string | null };
    if (editServerId) {
      await broadcastToServerMembers(editServerId, "MESSAGE_UPDATE", update);
    } else {
      await broadcastToChannel(channelId, "MESSAGE_UPDATE", update);
    }
    return apiSuccess(update);
  } catch (e) {
    if (e instanceof ServiceError) {
      return apiError(e.message, e.status, e.code);
    }
    throw e;
  }
}

// DELETE /api/channels/:id/messages — delete a message
const DELETE = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId } = params;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  const body = await request.json() as { message_id: string };

  if (!body.message_id) {
    return apiError("message_id required", 400);
  }

  const db = getDB();

  // Check moderator permission for non-own messages
  const { serverId } = accessResult as { serverId: string | null };
  let hasModPerm = false;
  if (serverId) {
    const perms = await getUserChannelPermissions(serverId, channelId, userId);
    hasModPerm = perms !== null && hasPermission(perms, PERMISSIONS.MANAGE_MESSAGES);
  }

  try {
    await deleteMessage(db, channelId, body.message_id, userId, hasModPerm);

    if (serverId) {
      await broadcastToServerMembers(serverId, "MESSAGE_DELETE", {
        id: body.message_id,
        channel_id: channelId,
      });
    } else {
      await broadcastToChannel(channelId, "MESSAGE_DELETE", {
        id: body.message_id,
        channel_id: channelId,
      });
    }

    return apiSuccess({ deleted: true });
  } catch (e) {
    if (e instanceof ServiceError) {
      return apiError(e.message, e.status, e.code);
    }
    throw e;
  }
}


export const Route = createFileRoute('/api/channels/$id/messages')({
  server: {
    handlers: {
      GET,
      POST,
      PATCH,
      DELETE,
    }
  }
});
