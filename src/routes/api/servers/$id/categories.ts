import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/require-permission";
import { ServiceError } from "@/lib/service-error";
import { CreateCategorySchema } from "@/lib/validations";
import { createCategory } from "@/services/category.service";
import { executeBroadcast, executeInvalidation } from "@/services/service-helpers";

import { z } from "zod";

// POST /api/servers/:id/categories — create a category
const POST = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId } = params;

  const permResult = await requirePermission(serverId, userId, PERMISSIONS.MANAGE_CATEGORIES);
  if (permResult instanceof Response) return permResult;

  let body;
  try {
    const rawBody = await request.json();
    body = CreateCategorySchema.parse(rawBody);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: err.issues[0].message }, { status: 400 });
    }
    return apiError("Invalid request body", 400);
  }

  const db = getDB();

  try {
    const result = await createCategory(db, serverId, userId, { name: body.name });

    await executeInvalidation(result.cacheKeysToInvalidate);
    if (result.broadcast) await executeBroadcast(result.broadcast);

    return apiSuccess(result.data, 201);
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}


export const Route = createFileRoute('/api/servers/$id/categories')({
  server: {
    handlers: {
      POST,
    }
  }
});
