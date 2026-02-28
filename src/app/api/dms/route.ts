import { apiError, apiSuccess, broadcastToUser, genId, getDB, requireAuth } from "@/lib/api-helpers";
import { NextResponse } from "next/server";

// GET /api/dms — list all DM channels for the authenticated user
export async function GET() {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const db = getDB();

  // Fetch DM channels with the other recipient's info
  const { results } = await db.prepare(
    `SELECT c.id, c.name, c.channel_type, c.created_at,
            other.user_id as other_user_id,
            u.username as other_username,
            u.avatar_url as other_avatar_url,
            u.status as other_status,
            u.custom_status as other_custom_status
     FROM dm_recipients me
     JOIN channels c ON c.id = me.channel_id AND c.channel_type = 'dm'
     JOIN dm_recipients other ON other.channel_id = c.id AND other.user_id != ?
     JOIN users u ON u.id = other.user_id
     WHERE me.user_id = ?
     ORDER BY c.created_at DESC`
  ).bind(userId, userId).all();

  const dms = (results ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    channel_type: "dm",
    name: row.other_username,
    created_at: row.created_at,
    recipient: {
      id: row.other_user_id,
      username: row.other_username,
      avatar_url: row.other_avatar_url,
      status: row.other_status,
      custom_status: row.other_custom_status,
    },
  }));

  return apiSuccess(dms);
}

// POST /api/dms — open or create a DM with a user
export async function POST(request: Request) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const db = getDB();
  const body = await request.json() as { target_user_id: string };

  if (!body.target_user_id) {
    return apiError("target_user_id is required", 400);
  }
  if (body.target_user_id === userId) {
    return apiError("Cannot DM yourself", 400);
  }

  // Check target user exists
  const target = await db.prepare(
    `SELECT id, username, avatar_url, status, custom_status FROM users WHERE id = ?`
  ).bind(body.target_user_id).first();

  if (!target) {
    return apiError("User not found", 404);
  }

  // Check if DM already exists between these two users
  const existing = await db.prepare(
    `SELECT c.id FROM dm_recipients a
     JOIN dm_recipients b ON a.channel_id = b.channel_id
     JOIN channels c ON c.id = a.channel_id AND c.channel_type = 'dm'
     WHERE a.user_id = ? AND b.user_id = ?`
  ).bind(userId, body.target_user_id).first();

  if (existing) {
    return apiSuccess({
      id: existing.id,
      channel_type: "dm",
      name: target.username,
      created_at: null,
      recipient: {
        id: target.id,
        username: target.username,
        avatar_url: target.avatar_url,
        status: target.status,
        custom_status: target.custom_status,
      },
    });
  }

  // Create new DM channel
  const channelId = genId();
  const now = new Date().toISOString();

  await db.batch([
    db.prepare(
      `INSERT INTO channels (id, server_id, name, channel_type, position, created_at)
       VALUES (?, NULL, ?, 'dm', 0, ?)`
    ).bind(channelId, `DM-${userId}-${body.target_user_id}`, now),
    db.prepare(
      `INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?)`
    ).bind(channelId, userId),
    db.prepare(
      `INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?)`
    ).bind(channelId, body.target_user_id),
  ]);

  // Fetch current user info to build the DM channel payload for the target
  const currentUser = await db.prepare(
    `SELECT id, username, avatar_url, status, custom_status FROM users WHERE id = ?`
  ).bind(userId).first();

  // Broadcast DM_CHANNEL_CREATE to the target user so their client adds it to the sidebar
  await broadcastToUser(body.target_user_id, "DM_CHANNEL_CREATE", {
    id: channelId,
    channel_type: "dm",
    name: currentUser?.username ?? "Unknown",
    created_at: now,
    recipient: {
      id: userId,
      username: currentUser?.username ?? "Unknown",
      avatar_url: currentUser?.avatar_url ?? null,
      status: currentUser?.status ?? "online",
      custom_status: currentUser?.custom_status ?? null,
    },
  });

  return apiSuccess({
    id: channelId,
    channel_type: "dm",
    name: target.username,
    created_at: now,
    recipient: {
      id: target.id,
      username: target.username,
      avatar_url: target.avatar_url,
      status: target.status,
      custom_status: target.custom_status,
    },
  }, 201);
}
