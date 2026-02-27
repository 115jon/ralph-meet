import { genId, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheDel, CacheKey } from "@/lib/cache";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { type D1Database } from "@cloudflare/workers-types";
import { NextResponse } from "next/server";

// Helper: Get user's total permissions for this server
async function getUserServerPermissions(serverId: string, userId: string, db: D1Database): Promise<number | null> {
  const result = await db.prepare(
    `SELECT SUM(r.permissions) as total_perms
     FROM member_roles mr
     JOIN roles r ON r.id = mr.role_id
     WHERE mr.server_id = ? AND mr.user_id = ?`
  ).bind(serverId, userId).first();

  return result ? (result.total_perms as number) : null;
}

// GET /api/servers/:id/roles — list all roles for a server
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id: serverId } = await params;

  const db = getDB();

  // Verify membership
  const member = await db.prepare(
    `SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`
  ).bind(serverId, userId).first();

  if (!member) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const { results } = await db.prepare(
    `SELECT * FROM roles WHERE server_id = ? ORDER BY position DESC`
  ).bind(serverId).all();

  return NextResponse.json((results ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    is_default: r.is_default === 1
  })));
}

// POST /api/servers/:id/roles — create a new role
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id: serverId } = await params;

  const db = getDB();

  // Verify permissions (Requires MANAGE_ROLES)
  const totalPerms = await getUserServerPermissions(serverId, userId, db);
  if (totalPerms === null || !hasPermission(totalPerms, PERMISSIONS.MANAGE_ROLES)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = (await request.json()) as { name: string; color?: string; permissions?: number };
  if (!body.name || body.name.trim().length === 0) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const roleId = genId();
  const now = new Date().toISOString();

  // Get the rank above @everyone (which is position 0)
  const lastRole = await db.prepare(
    `SELECT MAX(position) as max_pos FROM roles WHERE server_id = ? AND is_default = 0`
  ).bind(serverId).first();

  // Note: For simplicity we append it at the end (highest position). In reality you'd insert at a specific rank.
  const newPosition = lastRole && typeof lastRole.max_pos === 'number' ? lastRole.max_pos + 1 : 1;

  await db.prepare(
    `INSERT INTO roles (id, server_id, name, color, permissions, position, is_default, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  ).bind(
    roleId,
    serverId,
    body.name.trim(),
    body.color || null,
    body.permissions ?? 0,
    newPosition,
    now
  ).run();

  const newRole = await db.prepare(
    `SELECT * FROM roles WHERE id = ?`
  ).bind(roleId).first();

  // Invalidate caches that contain roles
  await cacheDel(CacheKey.serverMembers(serverId));

  return NextResponse.json({
    ...newRole,
    is_default: newRole?.is_default === 1
  }, { status: 201 });
}
