import { createFileRoute } from '@tanstack/react-router';

import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/require-permission";
import { ServiceError } from "@/lib/service-error";
import { UpdateServerSchema } from "@/lib/validations";
import { deleteServer, updateServer } from "@/services/server.service";
import { executeAuditLog, executeBroadcast, executeInvalidation } from "@/services/service-helpers";


// PATCH /api/servers/:id/settings — update server settings
const PATCH = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: serverId } = params;

  const raw = await request.json();
  const parsed = UpdateServerSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const db = getDB();

  // Verify RBAC: requires MANAGE_SERVER permission
  const permResult = await requirePermission(
    serverId, userId, PERMISSIONS.MANAGE_SERVER,
    "Insufficient permissions (MANAGE_SERVER required)"
  );
  if (permResult instanceof Response) return permResult;

  try {
    const result = await updateServer(db, serverId, userId, parsed.data);

    // Execute side effects
    await executeInvalidation(result.cacheKeysToInvalidate);
    if (result.broadcast) await executeBroadcast(result.broadcast);
    if (result.auditLog) await executeAuditLog(db, result.auditLog);

    return apiSuccess(result.data.server);
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}

// DELETE /api/servers/:id/settings — delete a server (owner only)
const DELETE = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: serverId } = params;
  const db = getDB();

  try {
    const result = await deleteServer(db, serverId, userId);

    // Execute side effects
    await executeInvalidation(result.cacheKeysToInvalidate);
    await executeBroadcast(result.broadcast);

    return apiSuccess({ deleted: true });
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}


export const Route = createFileRoute('/api/servers/$id/settings')({
  server: {
    handlers: {
      PATCH,
      DELETE,
    }
  }
});
