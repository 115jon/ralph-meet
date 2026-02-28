import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { deleteRole, updateRole } from "@/services/role.service";
import { executeAuditLog, executeInvalidation } from "@/services/service-helpers";
import { NextResponse } from "next/server";

// PATCH /api/servers/:id/roles/:roleId — update a role
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; roleId: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id: serverId, roleId } = await params;

  const db = getDB();
  const updates = (await request.json()) as {
    name?: string;
    color?: string | null;
    permissions?: number;
    position?: number;
  };

  try {
    const result = await updateRole(db, serverId, roleId, userId, updates);

    await executeInvalidation(result.cacheKeysToInvalidate);
    if (result.auditLog) {
      await executeAuditLog(db, result.auditLog);
    }

    return apiSuccess({ updated: true });
  } catch (e) {
    if (e instanceof ServiceError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}

// DELETE /api/servers/:id/roles/:roleId — delete a role
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; roleId: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id: serverId, roleId } = await params;

  const db = getDB();

  try {
    const result = await deleteRole(db, serverId, roleId, userId);

    await executeInvalidation(result.cacheKeysToInvalidate);
    await executeAuditLog(db, result.auditLog);

    return apiSuccess({ deleted: true });
  } catch (e) {
    if (e instanceof ServiceError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}
