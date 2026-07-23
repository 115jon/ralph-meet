import { createFileRoute } from "@tanstack/react-router";
import { waitUntil } from "cloudflare:workers";

import {
  apiError,
  apiSuccess,
  broadcastToChannel,
  broadcastToServerMembers,
  broadcastToUser,
  genId,
  getBucket,
  getDB,
  getEnv,
  requireAuth,
} from "@/lib/api-helpers";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { requireChannelAccess } from "@/lib/require-channel-access";
import { getUserChannelPermissions } from "@/lib/require-permission";
import { ServiceError } from "@/lib/service-error";
import { logger } from "@/lib/logger";
import { validateBody } from "@/lib/validate-body";
import { z } from "zod";
import {
  createMessage,
  deleteMessage,
  editMessage,
  getDMRecipients,
  listMessages,
  normalizeMessageLimit,
  refreshMessageEmbeds,
} from "@/services/message.service";
import {
  scheduleMessagePostprocessing,
  scheduleR2Cleanup,
} from "@/lib/background-tasks";
import { recordR2CleanupFailure } from "@/services/r2-cleanup.service";

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
  content: z.string().max(4000).default(""),
  reply_to_id: z.string().optional(),
  nonce: z.string().optional(),
  attachment_ids: z.array(z.string()).optional(),
  nsfw_attachment_ids: z.array(z.string()).optional(),
});

// POST /api/channels/:id/messages — send a message
export const POST = async ({ request, params }: any) => {
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
  const revision = Number(message.content_revision ?? 1);
  const postprocessingTask = {
    messageId,
    channelId,
    revision,
    notify: true,
  } as const;
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

  scheduleMessagePostprocessing(getEnv(), postprocessingTask, waitUntil, {
    outboxRecorded: true,
  });

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
    if (messageIds.length === 0 || messageIds.length > 50) {
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

  if (body.content !== undefined && body.content.length > 4000) {
    return apiError("Message content is too long", 400);
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
          `SELECT author_id, content_revision
           FROM messages WHERE id = ? AND channel_id = ?`,
        )
        .bind(body.message_id, channelId)
        .first()) as { author_id: string; content_revision: number } | null;
      if (!msg) return apiError("Message not found", 404);
      if (msg.author_id !== userId) return apiError("Not your message", 403);

      const cleared = await db
        .prepare(
          `UPDATE messages
           SET embeds = ?, content_revision = content_revision + 1
           WHERE id = ? AND channel_id = ?
           RETURNING content_revision`,
        )
        .bind(JSON.stringify(body.embeds), body.message_id, channelId)
        .first<{ content_revision: number }>();
      if (!cleared) return apiError("Message not found", 404);

      const update = {
        id: body.message_id,
        channel_id: channelId,
        content_revision: Number(cleared.content_revision),
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
    const postprocessingTask = {
      messageId: update.id,
      channelId,
      revision: update.content_revision,
      notify: false,
    } as const;
    const { serverId: editServerId } = accessResult as {
      serverId: string | null;
    };
    if (editServerId) {
      await broadcastToServerMembers(editServerId, "MESSAGE_UPDATE", update);
    } else {
      await broadcastToChannel(channelId, "MESSAGE_UPDATE", update);
    }
    scheduleMessagePostprocessing(getEnv(), postprocessingTask, waitUntil, {
      outboxRecorded: true,
    });
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
        try {
          scheduleR2Cleanup(getEnv(), fileKey, waitUntil);
        } catch (scheduleError) {
          logger.error("message_attachment_delete_cleanup_schedule_failed", {
            channelId,
            messageId: body.message_id,
            fileKey,
            error:
              scheduleError instanceof Error
                ? scheduleError.message
                : String(scheduleError),
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
