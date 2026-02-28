import { apiError, apiSuccess, genId, getDB, requireAuth } from "@/lib/api-helpers";
import { PERMISSIONS } from "@/lib/permissions";
import { checkRateLimitDO, RATE_LIMITS } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/require-permission";
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

  // Rate limit: 10 invites per 10 minutes (global DO token bucket)
  const rl = await checkRateLimitDO(userId, "invite-create", RATE_LIMITS.INVITE_CREATE);
  if (rl) return rl;

  const body = await request.json() as {
    channel_id?: string;
    max_uses?: number;
    max_age?: number; // seconds, 0 = never
    temporary?: boolean;
  };

  const db = getDB();

  // Check if invites are paused
  const server = await db.prepare(
    `SELECT invites_paused FROM servers WHERE id = ?`
  ).bind(serverId).first() as { invites_paused: number } | null;

  if (server?.invites_paused) {
    return apiError("Invites are currently paused for this server", 403);
  }

  // Verify membership (Requires CREATE_INVITE)
  const permResult = await requirePermission(serverId, userId, PERMISSIONS.CREATE_INVITE, "Insufficient permissions to create invites");
  if (permResult instanceof NextResponse) return permResult;

  // Validate channel belongs to this server (if provided)
  if (body.channel_id) {
    const channel = await db.prepare(
      `SELECT id FROM channels WHERE id = ? AND server_id = ?`
    ).bind(body.channel_id, serverId).first();

    if (!channel) {
      return apiError("Channel not found in this server", 404);
    }
  }

  const code = genId().split("-")[0]; // Short invite code
  const now = new Date().toISOString();

  // max_age in seconds: 0 or undefined = never expires
  const expiresAt = body.max_age && body.max_age > 0
    ? new Date(Date.now() + body.max_age * 1000).toISOString()
    : null;

  await db.prepare(
    `INSERT INTO invites (code, server_id, channel_id, inviter_id, max_uses, temporary, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    code,
    serverId,
    body.channel_id ?? null,
    userId,
    body.max_uses ?? null,
    body.temporary ? 1 : 0,
    expiresAt,
    now,
  ).run();

  return apiSuccess({ code, expires_at: expiresAt, channel_id: body.channel_id ?? null }, 201);
}

// GET /api/servers/:id/invites — list invites for a server
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id: serverId } = await params;
  const db = getDB();

  // Verify membership (MANAGE_SERVER required to view all invites)
  const permResult = await requirePermission(serverId, userId, PERMISSIONS.MANAGE_SERVER);
  if (permResult instanceof NextResponse) return permResult;

  // Check ?active=false to include expired invites (default: active only)
  const url = new URL(request.url);
  const showAll = url.searchParams.get("active") === "false";

  let query = `
    SELECT i.*,
           c.name AS channel_name
    FROM invites i
    LEFT JOIN channels c ON c.id = i.channel_id
    WHERE i.server_id = ?`;

  if (!showAll) {
    query += `
      AND (i.expires_at IS NULL OR i.expires_at > datetime('now'))
      AND (i.max_uses IS NULL OR i.max_uses = 0 OR i.uses < i.max_uses)`;
  }

  query += `\n    ORDER BY i.created_at DESC`;

  const { results } = await db.prepare(query).bind(serverId).all();

  return apiSuccess(results);
}
