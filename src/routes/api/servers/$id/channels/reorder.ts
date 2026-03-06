import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/require-permission";
import { ServiceError } from "@/lib/service-error";
import { reorderChannels } from "@/services/channel.service";
import { executeBroadcast, executeInvalidation } from "@/services/service-helpers";

import { z } from "zod";

const ReorderSchema = z.object({
  channels: z.array(z.object({
    id: z.string(),
    position: z.number().int().min(0),
    category_id: z.string().nullable(),
  })).optional(),
  categories: z.array(z.object({
    id: z.string(),
    rank: z.number().int().min(0),
  })).optional(),
}).refine(d => (d.channels?.length ?? 0) + (d.categories?.length ?? 0) > 0, {
  message: "Must provide at least one channel or category to reorder",
});

// PATCH /api/servers/:id/channels/reorder — batch update positions
const PATCH = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId } = params;

  // Require MANAGE_CHANNELS permission
  const permResult = await requirePermission(serverId, userId, PERMISSIONS.MANAGE_CHANNELS);
  if (permResult instanceof Response) return permResult;

  const raw = await request.json();
  const parsed = ReorderSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const db = getDB();

  try {
    const result = await reorderChannels(db, serverId, parsed.data);
    await executeInvalidation(result.cacheKeysToInvalidate);
    await executeBroadcast(result.broadcast);
    return apiSuccess({ reordered: true });
  } catch (e) {
    if (e instanceof ServiceError) {
      return apiError(e.message, e.status, e.code);
    }
    throw e;
  }
}


export const Route = createFileRoute('/api/servers/$id/channels/reorder')({
  server: {
    handlers: {
      PATCH,
    }
  }
});
