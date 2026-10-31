import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/require-permission";
import { safeParse } from "@/lib/schema";
import { ServiceError } from "@/lib/service-error";
import { CreateCategorySchema } from "@/lib/validations";
import { createCategory } from "@/services/category.service";
import {
  executeBroadcast,
  executeInvalidation,
} from "@/services/service-helpers";

// POST /api/servers/:id/categories — create a category
const POST = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId } = params;

  const permResult = await requirePermission(
    serverId,
    userId,
    PERMISSIONS.MANAGE_CATEGORIES,
  );
  if (permResult instanceof Response) return permResult;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }
  const parsed = safeParse(CreateCategorySchema, rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const db = getDB();

  try {
    const result = await createCategory(db, serverId, userId, {
      name: body.name,
    });

    await executeInvalidation(result.cacheKeysToInvalidate);
    if (result.broadcast) await executeBroadcast(result.broadcast);

    return apiSuccess(result.data, 201);
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

export const Route = createFileRoute("/api/servers/$id/categories")({
  server: {
    handlers: {
      POST,
    },
  },
});
