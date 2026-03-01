import { createFileRoute } from '@tanstack/react-router';

import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/require-permission";
import { ServiceError } from "@/lib/service-error";
import { deleteCategory } from "@/services/category.service";
import { executeBroadcast, executeInvalidation } from "@/services/service-helpers";


// DELETE /api/servers/:id/categories/:categoryId — delete a category
const DELETE = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId, categoryId } = params;

  const permResult = await requirePermission(serverId, userId, PERMISSIONS.MANAGE_CATEGORIES);
  if (permResult instanceof Response) return permResult;

  const db = getDB();

  try {
    const result = await deleteCategory(db, serverId, userId, categoryId);

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


export const Route = createFileRoute('/api/servers/$id/categories/$categoryId')({
  server: {
    handlers: {
      DELETE,
    }
  }
});
