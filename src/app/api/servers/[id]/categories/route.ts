import { broadcastToAll, genId, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheDel, CacheKey } from "@/lib/cache";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/require-permission";
import { CreateCategorySchema } from "@/lib/validations";
import { NextResponse } from "next/server";
import { z } from "zod";

// POST /api/servers/:id/categories — create a category
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id: serverId } = await params;

  const db = getDB();

  // Verify membership (Requires MANAGE_CATEGORIES)
  const permResult = await requirePermission(serverId, userId, PERMISSIONS.MANAGE_CATEGORIES);
  if (permResult instanceof NextResponse) return permResult;

  let body;
  try {
    const rawBody = await request.json();
    body = CreateCategorySchema.parse(rawBody);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const categoryId = genId();
  const name = body.name;

  // Get next rank
  const rankRow = await db.prepare(
    `SELECT COALESCE(MAX(rank), -1) + 1 as next_rank FROM categories WHERE server_id = ?`
  ).bind(serverId).first() as { next_rank: number } | null;

  await db.prepare(
    `INSERT INTO categories (id, server_id, name, rank)
     VALUES (?, ?, ?, ?)`
  ).bind(categoryId, serverId, name, rankRow?.next_rank ?? 0).run();

  // Invalidate cache and broadcast
  await cacheDel(CacheKey.serverChannels(serverId));
  await broadcastToAll("CHANNEL_UPDATE", { server_id: serverId });

  const category = {
    id: categoryId,
    server_id: serverId,
    name,
    rank: rankRow?.next_rank ?? 0,
  };

  return NextResponse.json(category, { status: 201 });
}
