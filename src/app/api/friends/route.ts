import { broadcastToUser, getDB, requireAuth } from "@/lib/api-helpers";
import { NextResponse } from "next/server";

// Relationship types:
// 0 = friend, 1 = blocked, 2 = pending_incoming, 3 = pending_outgoing

// GET /api/friends — list all relationships for the authenticated user
export async function GET() {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const db = getDB();

  const { results } = await db.prepare(
    `SELECT r.target_user_id, r.type, r.created_at,
            u.username, u.avatar_url, u.status, u.custom_status
     FROM relationships r
     JOIN users u ON u.id = r.target_user_id
     WHERE r.user_id = ?
     ORDER BY r.created_at DESC`
  ).bind(userId).all();

  const relationships = (results ?? []).map((row: Record<string, unknown>) => ({
    user: {
      id: row.target_user_id,
      username: row.username,
      avatar_url: row.avatar_url,
      status: row.status,
      custom_status: row.custom_status,
    },
    type: row.type as number,
    created_at: row.created_at,
  }));

  return NextResponse.json(relationships);
}

// POST /api/friends — send a friend request
export async function POST(request: Request) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const db = getDB();
  const body = await request.json() as { username: string };

  if (!body.username?.trim()) {
    return NextResponse.json({ error: "Username is required" }, { status: 400 });
  }

  // Find target user
  const target = await db.prepare(
    `SELECT id, username, avatar_url, status, custom_status FROM users WHERE username = ?`
  ).bind(body.username.trim()).first();

  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (target.id === userId) {
    return NextResponse.json({ error: "Cannot friend yourself" }, { status: 400 });
  }

  // Check existing relationship
  const existing = await db.prepare(
    `SELECT type FROM relationships WHERE user_id = ? AND target_user_id = ?`
  ).bind(userId, target.id).first() as { type: number } | null;

  if (existing) {
    if (existing.type === 0) {
      return NextResponse.json({ error: "Already friends" }, { status: 409 });
    }
    if (existing.type === 1) {
      return NextResponse.json({ error: "User is blocked" }, { status: 409 });
    }
    if (existing.type === 3) {
      return NextResponse.json({ error: "Request already sent" }, { status: 409 });
    }
    if (existing.type === 2) {
      // They sent us a request — accept it (mutual friend)
      const now = new Date().toISOString();
      await db.batch([
        db.prepare(
          `UPDATE relationships SET type = 0, updated_at = ? WHERE user_id = ? AND target_user_id = ?`
        ).bind(now, userId, target.id),
        db.prepare(
          `UPDATE relationships SET type = 0, updated_at = ? WHERE user_id = ? AND target_user_id = ?`
        ).bind(now, target.id as string, userId),
      ]);
      return NextResponse.json({
        user: { id: target.id, username: target.username, avatar_url: target.avatar_url, status: target.status, custom_status: target.custom_status },
        type: 0,
      });
    }
  }

  // Create pending relationship (outgoing for us, incoming for them)
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO relationships (user_id, target_user_id, type, created_at, updated_at)
       VALUES (?, ?, 3, ?, ?)`
    ).bind(userId, target.id as string, now, now),
    db.prepare(
      `INSERT INTO relationships (user_id, target_user_id, type, created_at, updated_at)
       VALUES (?, ?, 2, ?, ?)`
    ).bind(target.id as string, userId, now, now),
  ]);

  // Fetch current user details for the broadcast to target
  const currentUser = await db.prepare(
    `SELECT id, username, avatar_url, status, custom_status FROM users WHERE id = ?`
  ).bind(userId).first();

  // Broadcast to target (user B gets relationship type 2: pending incoming from A)
  await broadcastToUser(target.id as string, "RELATIONSHIP_ADD", {
    user: currentUser,
    type: 2,
    created_at: now
  });

  // Broadcast to self (optional but good for multi-device sync: user A gets type 3: pending outgoing to B)
  await broadcastToUser(userId, "RELATIONSHIP_ADD", {
    user: target,
    type: 3,
    created_at: now
  });

  return NextResponse.json({
    user: { id: target.id, username: target.username, avatar_url: target.avatar_url, status: target.status, custom_status: target.custom_status },
    type: 3,
  }, { status: 201 });
}

// PUT /api/friends — accept or block a relationship
export async function PUT(request: Request) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const db = getDB();
  const body = await request.json() as { target_user_id: string; action: "accept" | "block" };

  if (!body.target_user_id || !body.action) {
    return NextResponse.json({ error: "target_user_id and action are required" }, { status: 400 });
  }

  const now = new Date().toISOString();

  if (body.action === "accept") {
    // Verify there's a pending incoming request
    const pending = await db.prepare(
      `SELECT 1 FROM relationships WHERE user_id = ? AND target_user_id = ? AND type = 2`
    ).bind(userId, body.target_user_id).first();

    if (!pending) {
      return NextResponse.json({ error: "No pending request" }, { status: 404 });
    }

    await db.batch([
      db.prepare(
        `UPDATE relationships SET type = 0, updated_at = ? WHERE user_id = ? AND target_user_id = ?`
      ).bind(now, userId, body.target_user_id),
      db.prepare(
        `UPDATE relationships SET type = 0, updated_at = ? WHERE user_id = ? AND target_user_id = ?`
      ).bind(now, body.target_user_id, userId),
    ]);

    // Fetch info for broadcast
    const userA = await db.prepare(`SELECT id, username, avatar_url, status, custom_status FROM users WHERE id = ?`).bind(userId).first();
    const userB = await db.prepare(`SELECT id, username, avatar_url, status, custom_status FROM users WHERE id = ?`).bind(body.target_user_id).first();

    await broadcastToUser(userId, "RELATIONSHIP_ADD", { user: userB, type: 0, created_at: now });
    await broadcastToUser(body.target_user_id, "RELATIONSHIP_ADD", { user: userA, type: 0, created_at: now });

    return NextResponse.json({ success: true, type: 0 });
  }

  if (body.action === "block") {
    await db.batch([
      db.prepare(
        `INSERT OR REPLACE INTO relationships (user_id, target_user_id, type, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?)`
      ).bind(userId, body.target_user_id, now, now),
      db.prepare(
        `DELETE FROM relationships WHERE user_id = ? AND target_user_id = ?`
      ).bind(body.target_user_id, userId),
    ]);

    // Fetch info for broadcast
    const userB = await db.prepare(`SELECT id, username, avatar_url, status, custom_status FROM users WHERE id = ?`).bind(body.target_user_id).first();

    // Broadcast removal/block
    await broadcastToUser(userId, "RELATIONSHIP_ADD", {
      user: userB,
      type: 1,
      created_at: now
    });
    await broadcastToUser(body.target_user_id, "RELATIONSHIP_REMOVE", { user_id: userId });

    return NextResponse.json({ success: true, type: 1 });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// DELETE /api/friends — remove a friend or cancel/reject a request
export async function DELETE(request: Request) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const db = getDB();
  const body = await request.json() as { target_user_id: string };

  if (!body.target_user_id) {
    return NextResponse.json({ error: "target_user_id is required" }, { status: 400 });
  }

  // Delete both sides of the relationship
  await db.batch([
    db.prepare(
      `DELETE FROM relationships WHERE user_id = ? AND target_user_id = ?`
    ).bind(userId, body.target_user_id),
    db.prepare(
      `DELETE FROM relationships WHERE user_id = ? AND target_user_id = ?`
    ).bind(body.target_user_id, userId),
  ]);

  // Broadcast removal to both
  await broadcastToUser(userId, "RELATIONSHIP_REMOVE", { user_id: body.target_user_id });
  await broadcastToUser(body.target_user_id, "RELATIONSHIP_REMOVE", { user_id: userId });

  return NextResponse.json({ success: true });
}
