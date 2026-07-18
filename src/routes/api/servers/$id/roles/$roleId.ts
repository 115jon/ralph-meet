import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { validateBody } from "@/lib/validate-body";
import { deleteRole, updateRole } from "@/services/role.service";
import {
  executeAuditLog,
  executeInvalidation,
} from "@/services/service-helpers";

export const roleUpdateBodySchema = z
  .object({
    name: z.string().optional(),
    color: z.string().nullable().optional(),
    permissions: z.number().optional(),
    position: z.number().optional(),
  })
  .passthrough();

// PATCH /api/servers/:id/roles/:roleId — update a role
const PATCH = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId, roleId } = params;

  const db = getDB();
  const bodyResult = await validateBody(request, roleUpdateBodySchema, request);
  if (bodyResult instanceof Response) return bodyResult;
  const updates = bodyResult;

  try {
    const result = await updateRole(db, serverId, roleId, userId, updates);

    await executeInvalidation(result.cacheKeysToInvalidate);
    if (result.auditLog) {
      await executeAuditLog(db, result.auditLog);
    }

    return apiSuccess({ updated: true });
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

// DELETE /api/servers/:id/roles/:roleId — delete a role
const DELETE = async ({ request: _request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId, roleId } = params;

  const db = getDB();

  try {
    const result = await deleteRole(db, serverId, roleId, userId);

    await executeInvalidation(result.cacheKeysToInvalidate);
    await executeAuditLog(db, result.auditLog);

    return apiSuccess({ deleted: true });
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

export const Route = createFileRoute("/api/servers/$id/roles/$roleId")({
  server: {
    handlers: {
      PATCH,
      DELETE,
    },
  },
});
