import { createFileRoute } from '@tanstack/react-router';

import { apiSuccess, apiError, broadcastToAll, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheDel, CacheKey } from "@/lib/cache";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/require-permission";

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

  const { channels, categories } = parsed.data;
  const db = getDB();

  // Build batch statements
  const statements = [];

  if (channels?.length) {
    for (const ch of channels) {
      statements.push(
        db.prepare(
          `UPDATE channels SET position = ?, category_id = ? WHERE id = ? AND server_id = ?`
        ).bind(ch.position, ch.category_id, ch.id, serverId)
      );
    }
  }

  if (categories?.length) {
    for (const cat of categories) {
      statements.push(
        db.prepare(
          `UPDATE categories SET rank = ? WHERE id = ? AND server_id = ?`
        ).bind(cat.rank, cat.id, serverId)
      );
    }
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }

  // Invalidate cache and broadcast
  await cacheDel(CacheKey.serverChannels(serverId));
  await broadcastToAll("CHANNEL_UPDATE", { server_id: serverId });

  return apiSuccess({ reordered: true });
}


export const Route = createFileRoute('/api/servers/$id/channels/reorder')({
  server: {
    handlers: {
      PATCH,
    }
  }
});
