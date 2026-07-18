import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { validateBody } from "@/lib/validate-body";
import { updateMemberRoles } from "@/services/role.service";
import {
  executeAuditLog,
  executeBroadcast,
  executeInvalidation,
} from "@/services/service-helpers";

export const memberRolesBodySchema = z
  .object({
    roleIds: z.array(z.string()).optional(),
  })
  .passthrough();

// PUT /api/servers/:id/members/:userId/roles — update a member's roles
const PUT = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId: requesterId } = authResult;
  const { id: serverId, userId: targetUserId } = params;

  const bodyResult = await validateBody(
    request,
    memberRolesBodySchema,
    request,
  );
  if (bodyResult instanceof Response) return bodyResult;
  const body = bodyResult;
  if (!Array.isArray(body.roleIds)) {
    return apiError("Invalid roleIds array", 400);
  }

  const db = getDB();

  try {
    const result = await updateMemberRoles(
      db,
      serverId,
      targetUserId,
      requesterId,
      body.roleIds,
    );
    await executeInvalidation(result.cacheKeysToInvalidate);
    await executeBroadcast(result.broadcast);
    await executeAuditLog(db, result.auditLog);
    return apiSuccess(result.roles);
  } catch (e) {
    if (e instanceof ServiceError) {
      return apiError(e.message, e.status, e.code);
    }
    throw e;
  }
};

export const Route = createFileRoute("/api/servers/$id/members/$userId/roles")({
  server: {
    handlers: {
      PUT,
    },
  },
});
