import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { kickMember } from "@/services/server.service";
import { executeAuditLog, executeBroadcast, executeInvalidation } from "@/services/service-helpers";
import { NextResponse } from "next/server";

// PATCH /api/servers/:id/members/:userId — update a member's role
// DEPRECATED for RBAC system. Role updates handled in PUT /api/servers/:id/members/:userId/roles
export async function PATCH(
  _request: Request,
  { params: _params }: { params: Promise<{ id: string; userId: string }> }
) {
  return apiError("Deprecated. Use /api/servers/:id/members/:userId/roles", 400);
}

// DELETE /api/servers/:id/members/:userId — kick a member
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId: actorId } = authResult;

  const { id: serverId, userId: targetUserId } = await params;
  const db = getDB();

  try {
    const result = await kickMember(db, serverId, actorId, targetUserId);

    // Execute side effects
    await executeInvalidation(result.cacheKeysToInvalidate);
    await executeBroadcast(result.broadcast);
    await executeAuditLog(db, result.auditLog);

    return apiSuccess({ kicked: true });
  } catch (e) {
    if (e instanceof ServiceError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}
