import { genId, getDB, requireAuth } from "@/lib/api-helpers";
import { NextResponse } from "next/server";

// POST /api/servers/:id/invites — create an invite link
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id: serverId } = await params;
  const body = await request.json() as { max_uses?: number; expires_hours?: number };

  const db = getDB();

  // Verify membership
  const member = await db.prepare(
    `SELECT role FROM server_members WHERE server_id = ? AND user_id = ?`
  ).bind(serverId, userId).first() as { role: number } | null;

  if (!member) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const code = genId().split("-")[0]; // Short invite code
  const now = new Date().toISOString();
  const expiresAt = body.expires_hours
    ? new Date(Date.now() + body.expires_hours * 3600000).toISOString()
    : null;

  await db.prepare(
    `INSERT INTO invites (code, server_id, inviter_id, max_uses, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(code, serverId, userId, body.max_uses ?? null, expiresAt, now).run();

  return NextResponse.json({ code, expires_at: expiresAt }, { status: 201 });
}

// GET /api/servers/:id/invites — list invites for a server
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id: serverId } = await params;
  const db = getDB();

  // Verify membership (moderator+)
  const member = await db.prepare(
    `SELECT role FROM server_members WHERE server_id = ? AND user_id = ?`
  ).bind(serverId, userId).first() as { role: number } | null;

  if (!member || member.role < 1) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Invites are admin-only, low traffic — skip caching, always hit D1
  const { results } = await db.prepare(
    `SELECT i.*, u.username as inviter_username
     FROM invites i
     LEFT JOIN users u ON u.id = i.inviter_id
     WHERE i.server_id = ?
     ORDER BY i.created_at DESC`
  ).bind(serverId).all();

  return NextResponse.json(results);
}
