import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheFetch, CacheKey, CacheTTL } from "@/lib/cache";
import { PERMISSIONS } from "@/lib/permissions";
import { getVisibleChannels, requirePermission } from "@/lib/require-permission";
import { ServiceError } from "@/lib/service-error";
import { CreateChannelSchema } from "@/lib/validations";
import { createChannel, listServerChannels } from "@/services/channel.service";
import { executeAuditLog, executeBroadcast, executeInvalidation } from "@/services/service-helpers";

import { z } from "zod";

// GET /api/servers/:id/channels — list channels in a server
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId } = await params;

  const db = getDB();

  // Verify membership
  const member = await db.prepare(
    `SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`
  ).bind(serverId, userId).first();

  if (!member) {
    return apiError("Not a member", 403);
  }

  // Cache-aside
  const data = await cacheFetch(
    CacheKey.serverChannels(serverId),
    CacheTTL.SERVER_CHANNELS,
    () => listServerChannels(db, serverId)
  );

  const visibleChannels = await getVisibleChannels(serverId, userId, data.channels);

  return apiSuccess({
    categories: data.categories,
    channels: visibleChannels,
  });
}

// POST /api/servers/:id/channels — create a channel
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId } = await params;

  const db = getDB();

  const permResult = await requirePermission(
    serverId, userId, PERMISSIONS.MANAGE_CHANNELS,
    "Insufficient permissions (MANAGE_CHANNELS required)"
  );
  if (permResult instanceof Response) return permResult;

  let body;
  try {
    const rawBody = await request.json();
    body = CreateChannelSchema.parse(rawBody);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: err.issues[0].message }, { status: 400 });
    }
    return apiError("Invalid request body", 400);
  }

  try {
    const result = await createChannel(db, serverId, userId, body);

    await executeInvalidation(result.cacheKeysToInvalidate);
    await executeBroadcast(result.broadcast);
    await executeAuditLog(db, result.auditLog);

    return apiSuccess(result.channel, 201);
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}
