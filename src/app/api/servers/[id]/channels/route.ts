import { broadcastToAll, genId, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheDel, cacheFetch, CacheKey, CacheTTL } from "@/lib/cache";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/require-permission";
import { CreateChannelSchema, sanitizeChannelName } from "@/lib/validations";
import { NextResponse } from "next/server";
import { z } from "zod";

// GET /api/servers/:id/channels — list channels in a server
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id: serverId } = await params;

  const db = getDB();

  // Verify membership (not cached — security check must always hit D1)
  const member = await db.prepare(
    `SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`
  ).bind(serverId, userId).first();

  if (!member) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  // Cache-aside: channels + categories for this server
  const data = await cacheFetch(
    CacheKey.serverChannels(serverId),
    CacheTTL.SERVER_CHANNELS,
    async () => {
      const [catResult, chanResult] = await Promise.all([
        db.prepare(
          `SELECT * FROM categories WHERE server_id = ? ORDER BY rank ASC`
        ).bind(serverId).all(),
        db.prepare(
          `SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC`
        ).bind(serverId).all(),
      ]);
      return { categories: catResult.results, channels: chanResult.results };
    }
  );

  return NextResponse.json(data);
}

// POST /api/servers/:id/channels — create a channel
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id: serverId } = await params;

  const db = getDB();

  // Verify membership (requires MANAGE_CHANNELS)
  const permResult = await requirePermission(
    serverId, userId, PERMISSIONS.MANAGE_CHANNELS,
    "Insufficient permissions (MANAGE_CHANNELS required)"
  );
  if (permResult instanceof NextResponse) return permResult;

  let body;
  try {
    const rawBody = await request.json();
    body = CreateChannelSchema.parse(rawBody);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const channelId = genId();
  const now = new Date().toISOString();
  const channelType = body.channel_type || "text";
  const sanitizedName = sanitizeChannelName(body.name, channelType as "text" | "voice" | "dm", true);

  if (!sanitizedName) {
    return NextResponse.json({ error: "Invalid channel name" }, { status: 400 });
  }

  // Get next position
  const posRow = await db.prepare(
    `SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM channels WHERE server_id = ?`
  ).bind(serverId).first() as { next_pos: number } | null;

  await db.prepare(
    `INSERT INTO channels (id, server_id, name, description, channel_type, category_id, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    channelId, serverId, sanitizedName, body.description ?? null,
    channelType, body.category_id ?? null, posRow?.next_pos ?? 0, now
  ).run();

  // ── Cache invalidation & Broadcast ──
  // Channel list for this server changed
  await cacheDel(CacheKey.serverChannels(serverId));

  // Notify all clients to refresh channel lists for this server
  await broadcastToAll("CHANNEL_UPDATE", { server_id: serverId });

  const channel = {
    id: channelId,
    server_id: serverId,
    name: sanitizedName,
    description: body.description ?? null,
    channel_type: channelType,
    category_id: body.category_id ?? null,
    position: posRow?.next_pos ?? 0,
    created_at: now,
  };

  return NextResponse.json(channel, { status: 201 });
}
