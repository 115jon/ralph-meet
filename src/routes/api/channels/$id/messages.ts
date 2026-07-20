import { createFileRoute } from "@tanstack/react-router";

import {
  apiError,
  apiSuccess,
  broadcastToChannel,
  broadcastToServerMembers,
  broadcastToUser,
  genId,
  getBucket,
  getDB,
  requireAuth,
} from "@/lib/api-helpers";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { getUserChannelPermissions } from "@/lib/require-permission";
import { ServiceError } from "@/lib/service-error";
import { logger } from "@/lib/logger";
import { clog } from "@/lib/console-logger";
import { validateBody } from "@/lib/validate-body";
import { z } from "zod";
import {
  createMessage,
  deleteMessage,
  editMessage,
  generateMessageNotifications,
  getDMRecipients,
  listMessages,
  normalizeMessageLimit,
  refreshMessageEmbeds,
} from "@/services/message.service";
import {
  recordR2CleanupFailure,
  retryR2Cleanup,
} from "@/services/r2-cleanup.service";

const embedLog = clog("embed");
const notifLog = clog("notifications");

// GET /api/channels/:id/messages — get message history (paginated)
export const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId } = params;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  const url = new URL(request.url);
  const limit = normalizeMessageLimit(url.searchParams.get("limit"));

  const db = getDB();

  try {
    const result = await listMessages(db, channelId, userId, {
      limit,
      before: url.searchParams.get("before"),
      after: url.searchParams.get("after"),
      around: url.searchParams.get("around"),
    });

    if (result.mode === "around") {
      return apiSuccess({
        messages: result.messages,
        hasMoreBefore: result.hasMoreBefore,
        hasMoreAfter: result.hasMoreAfter,
      });
    }
    if (result.mode === "after") {
      return apiSuccess({
        messages: result.messages,
        hasMoreAfter: result.hasMoreAfter,
      });
    }
    return apiSuccess({
      messages: result.messages,
      hasMoreBefore: result.hasMoreBefore,
      hasMoreAfter: result.hasMoreAfter,
    });
  } catch (e) {
    if (e instanceof ServiceError) {
      return apiError(e.message, e.status, e.code);
    }
    throw e;
  }
};

// Permissive schema: validates structure only (types + shape), not business
// rules. The content-or-attachments requirement is enforced separately below,
// exactly as before, so existing clients are unaffected.
const messageCreateSchema = z.object({
  content: z.string().default(""),
  reply_to_id: z.string().optional(),
  nonce: z.string().optional(),
  attachment_ids: z.array(z.string()).optional(),
  nsfw_attachment_ids: z.array(z.string()).optional(),
});

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
      return apiError(
        "You do not have permission to send messages in this channel",
        403,
      );
    }
  }

  // Rate limit
  const rl = checkRateLimit(userId, "message-send", RATE_LIMITS.MESSAGE_SEND);
  if (rl) return rl;

  const bodyResult = await validateBody(request, messageCreateSchema, request);
  if (bodyResult instanceof Response) return bodyResult;
  const body = bodyResult;

  const hasContent = body.content?.trim();
  const hasAttachments = body.attachment_ids && body.attachment_ids.length > 0;

  if (!hasContent && !hasAttachments) {
    return apiError("Content or attachments required", 400);
  }

  const db = getDB();
  const messageId = genId();

  const message = await createMessage(db, channelId, userId, messageId, body);

  // Broadcast MESSAGE_CREATE immediately (without embeds) — Discord-style
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

  // Asynchronously resolve embeds and deliver via MESSAGE_UPDATE
  // (still within request lifecycle since Workers can't fire-and-forget)
  try {
    const { extractAndProcessEmbeds } =
      await import("@/services/embed-fetcher");
    const contentToScan = body.content ?? "";
    embedLog.info(
      `Scanning content for URLs: "${contentToScan.substring(0, 200)}"`,
    );
    const embeds = await extractAndProcessEmbeds(contentToScan);
    embedLog.info(
      `Resolved ${embeds.length} embed(s) for message ${messageId}`,
    );
    if (embeds.length > 0) {
      await db
        .prepare(`UPDATE messages SET embeds = ? WHERE id = ?`)
        .bind(JSON.stringify(embeds), messageId)
        .run();
      embedLog.info(`Saved embeds to DB for message ${messageId}`);

      const embedUpdate = { id: messageId, channel_id: channelId, embeds };
      if (serverId) {
        embedLog.info(`Broadcasting MESSAGE_UPDATE to server ${serverId}`);
        await broadcastToServerMembers(serverId, "MESSAGE_UPDATE", embedUpdate);
      } else {
        embedLog.info(`Broadcasting MESSAGE_UPDATE to channel ${channelId}`);
        await broadcastToChannel(channelId, "MESSAGE_UPDATE", embedUpdate);
        const recipients = await getDMRecipients(db, channelId, userId);
        for (const recipientId of recipients) {
          await broadcastToUser(recipientId, "MESSAGE_UPDATE", embedUpdate);
        }
      }
      embedLog.info(`MESSAGE_UPDATE broadcast complete`);
    }
  } catch (e) {
    embedLog.error("Async embed processing failed:", e);
  }

  // Notification generation
  try {
    const author = message.author as {
      id: unknown;
      username: string;
      display_name?: string | null;
      avatar_url: unknown;
    };
    const notifBroadcasts = await generateMessageNotifications(db, genId, {
      channelId,
      messageId,
      authorId: userId,
      authorUsername: author.username,
      authorDisplayName: author.display_name ?? null,
      authorAvatarUrl: (author.avatar_url as string) ?? null,
      content: (message.content as string) ?? "",
      replyToId: body.reply_to_id,
    });
    for (const nb of notifBroadcasts) {
      await broadcastToUser(nb.userId, nb.event, nb.data);
    }
  } catch (e) {
    notifLog.error("Failed to create notifications:", e);
  }

  return apiSuccess(message, 201);
};

// PATCH /api/channels/:id/messages — edit a message
export const PATCH = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId } = params;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  const body = (await request.json()) as {
    message_id?: string;
    message_ids?: string[];
    refresh_embeds?: boolean;
    content?: string;
    embeds?: unknown[];
  };
  const db = getDB();

  if (body.refresh_embeds) {
    const messageIds =
      body.message_ids ?? (body.message_id ? [body.message_id] : []);
    if (messageIds.length === 0) {
      return apiError("message_ids required", 400);
    }

    const updates = await refreshMessageEmbeds(db, channelId, messageIds);
    const { serverId: refreshServerId } = accessResult as {
      serverId: string | null;
    };
    for (const update of updates) {
      if (refreshServerId) {
        await broadcastToServerMembers(
          refreshServerId,
          "MESSAGE_UPDATE",
          update,
        );
      } else {
        await broadcastToChannel(channelId, "MESSAGE_UPDATE", update);
      }
    }
    return apiSuccess({ updated: updates.length });
  }

  if (!body.message_id) {
    return apiError("message_id required", 400);
  }

  // Must provide either content or embeds update
  if (!body.content?.trim() && !Array.isArray(body.embeds)) {
    return apiError("content or embeds required", 400);
  }

  try {
    // If clearing embeds (no content change)
    if (Array.isArray(body.embeds) && !body.content?.trim()) {
      // Verify ownership
      const msg = (await db
        .prepare(
          `SELECT author_id FROM messages WHERE id = ? AND channel_id = ?`,
        )
        .bind(body.message_id, channelId)
        .first()) as { author_id: string } | null;
      if (!msg) return apiError("Message not found", 404);
      if (msg.author_id !== userId) return apiError("Not your message", 403);

      await db
        .prepare(`UPDATE messages SET embeds = ? WHERE id = ?`)
        .bind(JSON.stringify(body.embeds), body.message_id)
        .run();

      const update = {
        id: body.message_id,
        channel_id: channelId,
        embeds: body.embeds,
      };
      const { serverId: editServerId } = accessResult as {
        serverId: string | null;
      };
      if (editServerId) {
        await broadcastToServerMembers(editServerId, "MESSAGE_UPDATE", update);
      } else {
        await broadcastToChannel(channelId, "MESSAGE_UPDATE", update);
      }
      return apiSuccess(update);
    }

    // Normal content edit
    const update = await editMessage(
      db,
      channelId,
      userId,
      body.message_id,
      body.content!,
    );
    const { serverId: editServerId } = accessResult as {
      serverId: string | null;
    };
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
};

// DELETE /api/channels/:id/messages — delete a message
export const DELETE = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: channelId } = params;

  const accessResult = await requireChannelAccess(userId, channelId);
  if (accessResult instanceof Response) return accessResult;

  const body = (await request.json()) as { message_id: string };

  if (!body.message_id) {
    return apiError("message_id required", 400);
  }

  const db = getDB();

  // Check moderator permission for non-own messages
  const { serverId } = accessResult as { serverId: string | null };
  let hasModPerm = false;
  if (serverId) {
    const perms = await getUserChannelPermissions(serverId, channelId, userId);
    hasModPerm =
      perms !== null && hasPermission(perms, PERMISSIONS.MANAGE_MESSAGES);
  }

  try {
    const bucket = getBucket();
    await retryR2Cleanup(db, bucket);
    const fileKeys = await deleteMessage(
      db,
      channelId,
      body.message_id,
      userId,
      hasModPerm,
    );

    for (const fileKey of fileKeys) {
      try {
        await bucket.delete(fileKey);
      } catch (cleanupError) {
        logger.error("message_attachment_delete_cleanup_failed", {
          channelId,
          messageId: body.message_id,
          fileKey,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        });
        try {
          await recordR2CleanupFailure(db, fileKey, cleanupError);
        } catch (queueError) {
          logger.error("message_attachment_delete_cleanup_record_failed", {
            channelId,
            messageId: body.message_id,
            fileKey,
            error:
              queueError instanceof Error
                ? queueError.message
                : String(queueError),
          });
        }
      }
    }

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
};

export const Route = createFileRoute("/api/channels/$id/messages")({
  server: {
    handlers: {
      GET,
      POST,
      PATCH,
      DELETE,
    },
  },
});
