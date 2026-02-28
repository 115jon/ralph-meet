import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/require-permission";
import { ServiceError } from "@/lib/service-error";
import { deleteCategory } from "@/services/category.service";
import { executeBroadcast, executeInvalidation } from "@/services/service-helpers";
import { NextResponse } from "next/server";

// DELETE /api/servers/:id/categories/:categoryId — delete a category
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; categoryId: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id: serverId, categoryId } = await params;

  const permResult = await requirePermission(serverId, userId, PERMISSIONS.MANAGE_CATEGORIES);
  if (permResult instanceof NextResponse) return permResult;

  const db = getDB();

  try {
    const result = await deleteCategory(db, serverId, userId, categoryId);

    await executeInvalidation(result.cacheKeysToInvalidate);
    await executeBroadcast(result.broadcast);

    return apiSuccess({ deleted: true });
  } catch (e) {
    if (e instanceof ServiceError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}
