import { broadcastToAll, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheDel, CacheKey } from "@/lib/cache";
import { ensureUser } from "@/lib/ensure-user";
import { NextResponse } from "next/server";

// POST /api/invites/:code/join — accept an invite and join a server
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { code } = await params;
  const db = getDB();

  // Find the invite
  const invite = await db.prepare(
    `SELECT * FROM invites WHERE code = ?`
  ).bind(code).first() as {
    code: string;
    server_id: string;
    max_uses: number | null;
    uses: number;
    expires_at: string | null;
  } | null;

  if (!invite) {
    return NextResponse.json({ error: "Invalid invite" }, { status: 404 });
  }

  // Check expiry
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: "Invite expired" }, { status: 410 });
  }

  // Check max uses
  if (invite.max_uses && invite.uses >= invite.max_uses) {
    return NextResponse.json({ error: "Invite has reached max uses" }, { status: 410 });
  }

  // Check if already a member
  const existing = await db.prepare(
    `SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`
  ).bind(invite.server_id, userId).first();

  if (existing) {
    // Already a member, return the server info
    const server = await db.prepare(
      `SELECT * FROM servers WHERE id = ?`
    ).bind(invite.server_id).first();
    return NextResponse.json({ already_member: true, server });
  }

  // Ensure user exists in D1
  const { username, avatar } = await ensureUser(userId);
  const now = new Date().toISOString();

  // Atomic: join server + increment invite uses
  await db.batch([
    db.prepare(
      `INSERT INTO server_members (server_id, user_id, joined_at, role)
       VALUES (?, ?, ?, 0)`
    ).bind(invite.server_id, userId, now),
    db.prepare(
      `UPDATE invites SET uses = uses + 1 WHERE code = ?`
    ).bind(code),
  ]);

  // Get server info
  const server = await db.prepare(
    `SELECT * FROM servers WHERE id = ?`
  ).bind(invite.server_id).first();

  // ── Cache invalidation ──
  // New member joined → invalidate members list, user's server list, and invite cache
  await Promise.all([
    cacheDel(CacheKey.serverMembers(invite.server_id)),
    cacheDel(CacheKey.userServers(userId)),
    cacheDel(CacheKey.invite(code)),
  ]);

  // Broadcast GUILD_MEMBER_ADD to all connected clients
  await broadcastToAll("GUILD_MEMBER_ADD", {
    server_id: invite.server_id,
    user: {
      id: userId,
      username,
      avatar_url: avatar,
      status: "online",
    },
    role: 0,
  });

  return NextResponse.json({ joined: true, server }, { status: 201 });
}
