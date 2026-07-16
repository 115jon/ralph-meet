import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { ServiceError } from "@/lib/service-error";
import { validateBody } from "@/lib/validate-body";
import { banUser, listBans, unbanUser } from "@/services/ban.service";
import {
  executeAuditLog,
  executeBroadcast,
  executeInvalidation,
} from "@/services/service-helpers";

export const banCreateBodySchema = z
  .object({
    user_id: z.string().optional(),
    reason: z.string().optional(),
  })
  .passthrough();

export const banDeleteBodySchema = z
  .object({
    user_id: z.string().optional(),
  })
  .passthrough();

// GET /api/servers/:id/bans — list banned users
const GET = async ({ request: _request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId } = params;

  const db = getDB();

  try {
    const bans = await listBans(db, serverId, userId);
    return apiSuccess(bans);
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

// POST /api/servers/:id/bans — ban a user
const POST = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId: actorId } = authResult;
  const { id: serverId } = params;

  const rl = checkRateLimit(actorId, "ban", RATE_LIMITS.DEFAULT);
  if (rl) return rl;

  const bodyResult = await validateBody(request, banCreateBodySchema, request);
  if (bodyResult instanceof Response) return bodyResult;
  const body = bodyResult;

  if (!body.user_id) {
    return Response.json({ error: "user_id is required" }, { status: 400 });
  }

  const db = getDB();

  try {
    const result = await banUser(db, serverId, actorId, {
      user_id: body.user_id,
      reason: body.reason,
    });

    await executeInvalidation(result.cacheKeysToInvalidate);
    for (const broadcast of result.broadcasts) {
      await executeBroadcast(broadcast);
    }
    await executeAuditLog(db, result.auditLog);

    return apiSuccess({ banned: true, user_id: body.user_id }, 201);
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

// DELETE /api/servers/:id/bans — unban a user
const DELETE = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId: actorId } = authResult;
  const { id: serverId } = params;

  const bodyResult = await validateBody(request, banDeleteBodySchema, request);
  if (bodyResult instanceof Response) return bodyResult;
  const body = bodyResult;

  if (!body.user_id) {
    return Response.json({ error: "user_id is required" }, { status: 400 });
  }

  const db = getDB();

  try {
    const result = await unbanUser(db, serverId, actorId, body.user_id);
    await executeAuditLog(db, result.auditLog);

    return apiSuccess({ unbanned: true, user_id: body.user_id });
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

export const Route = createFileRoute("/api/servers/$id/bans")({
  server: {
    handlers: {
      GET,
      POST,
      DELETE,
    },
  },
});
