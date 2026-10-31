import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheFetch, CacheKey, CacheTTL } from "@/lib/cache";
import { PERMISSIONS } from "@/lib/permissions";
import {
  getVisibleChannels,
  requirePermission,
} from "@/lib/require-permission";
import { safeParse } from "@/lib/schema";
import { ServiceError } from "@/lib/service-error";
import { CreateChannelSchema } from "@/lib/validations";
import { createChannel, listServerChannels } from "@/services/channel.service";
import {
  executeAuditLog,
  executeBroadcast,
  executeInvalidation,
} from "@/services/service-helpers";

// GET /api/servers/:id/channels — list channels in a server
const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId } = params;

  const db = getDB();

  // Verify membership
  const member = await db
    .prepare(`SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`)
    .bind(serverId, userId)
    .first();

  if (!member) {
    return apiError("Not a member", 403);
  }

  // Cache-aside
  const data = await cacheFetch(
    CacheKey.serverChannels(serverId),
    CacheTTL.SERVER_CHANNELS,
    () => listServerChannels(db, serverId),
  );

  const visibleChannels = await getVisibleChannels(
    serverId,
    userId,
    data.channels,
  );

  return apiSuccess({
    categories: data.categories,
    channels: visibleChannels,
  });
};

// POST /api/servers/:id/channels — create a channel
const POST = async ({ request, params }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId } = params;

  const db = getDB();

  const permResult = await requirePermission(
    serverId,
    userId,
    PERMISSIONS.MANAGE_CHANNELS,
    "Insufficient permissions (MANAGE_CHANNELS required)",
  );
  if (permResult instanceof Response) return permResult;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }
  const parsed = safeParse(CreateChannelSchema, rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const body = parsed.data;

  try {
    const result = await createChannel(db, serverId, userId, body);

    await executeInvalidation(result.cacheKeysToInvalidate);
    await executeBroadcast(result.broadcast);
    await executeAuditLog(db, result.auditLog);

    return apiSuccess(result.channel, 201);
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json(
        { error: e.message, code: e.code },
        { status: e.status },
      );
    }
    throw e;
  }
};

export const Route = createFileRoute("/api/servers/$id/channels")({
  server: {
    handlers: {
      GET,
      POST,
    },
  },
});
