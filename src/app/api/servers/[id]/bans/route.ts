import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { ServiceError } from "@/lib/service-error";
import { banUser, listBans, unbanUser } from "@/services/ban.service";
import { executeAuditLog, executeBroadcast, executeInvalidation } from "@/services/service-helpers";


// GET /api/servers/:id/bans — list banned users
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId } = await params;

  const db = getDB();

  try {
    const bans = await listBans(db, serverId, userId);
    return apiSuccess(bans);
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}

// POST /api/servers/:id/bans — ban a user
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId: actorId } = authResult;
  const { id: serverId } = await params;

  const rl = checkRateLimit(actorId, "ban", RATE_LIMITS.DEFAULT);
  if (rl) return rl;

  const body = (await request.json()) as { user_id: string; reason?: string };

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
    await executeBroadcast(result.broadcast);
    await executeAuditLog(db, result.auditLog);

    return apiSuccess({ banned: true, user_id: body.user_id }, 201);
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}

// DELETE /api/servers/:id/bans — unban a user
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId: actorId } = authResult;
  const { id: serverId } = await params;

  const body = (await request.json()) as { user_id: string };

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
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}
