import { apiError, apiSuccess, broadcastToAll, getDB, requireAuth } from "@/lib/api-helpers";
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
    return apiError("Invalid invite", 404);
  }

  // Check expiry
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return apiError("Invite expired", 410);
  }

  // Check max uses
  if (invite.max_uses && invite.uses >= invite.max_uses) {
    return apiError("Invite has reached max uses", 410);
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
    return apiSuccess({ already_member: true, server });
  }

  // Check if user is banned from this server
  const banned = await db.prepare(
    `SELECT 1 FROM server_bans WHERE server_id = ? AND user_id = ?`
  ).bind(invite.server_id, userId).first();

  if (banned) {
    return apiError("You are banned from this server", 403);
  }

  // Ensure user exists in D1
  const { username, avatar } = await ensureUser(userId);
  const now = new Date().toISOString();

  // Get the @everyone role id to assign it to the new member
  const everyoneRole = await db.prepare(
    `SELECT id FROM roles WHERE server_id = ? AND is_default = 1`
  ).bind(invite.server_id).first() as { id: string };

  // Atomic: join server + assign @everyone role + increment invite uses
  await db.batch([
    db.prepare(
      `INSERT INTO server_members (server_id, user_id, joined_at)
         VALUES (?, ?, ?)`
    ).bind(invite.server_id, userId, now),
    db.prepare(
      `INSERT INTO member_roles (server_id, user_id, role_id)
         VALUES (?, ?, ?)`
    ).bind(invite.server_id, userId, everyoneRole.id),
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
    roles: [everyoneRole], // The client will need the full role object ideally, but passing ID is enough for now
  });

  return apiSuccess({ joined: true, server }, 201);
}
