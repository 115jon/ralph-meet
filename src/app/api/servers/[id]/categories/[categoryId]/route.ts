import { apiSuccess, apiError, broadcastToAll, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheDel, CacheKey } from "@/lib/cache";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/require-permission";
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

  const db = getDB();

  // 1. Verify membership (Requires MANAGE_CATEGORIES)
  const permResult = await requirePermission(serverId, userId, PERMISSIONS.MANAGE_CATEGORIES);
  if (permResult instanceof NextResponse) return permResult;

  // 2. Clear category_id from channels in this category (SET NULL)
  // Our D1 schema says REFERENCES categories(id) ON DELETE SET NULL,
  // but some SQLite versions/drivers need a manual update if pragmas aren't on.
  // We'll trust the schema but a manual update is safer if we want to be sure.
  await db.prepare(`UPDATE channels SET category_id = NULL WHERE category_id = ?`).bind(categoryId).run();

  // 3. Delete the category
  await db.prepare(`DELETE FROM categories WHERE id = ? AND server_id = ?`).bind(categoryId, serverId).run();

  // 4. Invalidate cache and broadcast
  await cacheDel(CacheKey.serverChannels(serverId));
  await broadcastToAll("CHANNEL_UPDATE", { server_id: serverId });

  return apiSuccess({ success: true });
}
