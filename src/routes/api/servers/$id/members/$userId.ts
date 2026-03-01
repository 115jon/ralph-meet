import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { kickMember } from "@/services/server.service";
import { executeAuditLog, executeBroadcast, executeInvalidation } from "@/services/service-helpers";


// PATCH /api/servers/:id/members/:userId — update a member's role
// DEPRECATED for RBAC system. Role updates handled in PUT /api/servers/:id/members/:userId/roles
const PATCH = async ({ request, params }: any) => {
  return apiError("Deprecated. Use /api/servers/:id/members/:userId/roles", 400);
}

// DELETE /api/servers/:id/members/:userId — kick a member
const DELETE = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId: actorId } = authResult;

  const { id: serverId, userId: targetUserId } = params;
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
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}


export const Route = createFileRoute('/api/servers/$id/members/$userId')({
  server: {
    handlers: {
      PATCH,
      DELETE,
    }
  }
});
