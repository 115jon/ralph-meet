import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { PERMISSIONS } from "@/lib/permissions";
import { checkRateLimitDO, RATE_LIMITS } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/require-permission";
import { createInvite, listInvites } from "@/services/social.service";


// POST /api/servers/:id/invites — create an invite link
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId } = await params;

  const rl = await checkRateLimitDO(userId, "invite-create", RATE_LIMITS.INVITE_CREATE);
  if (rl) return rl;

  const body = (await request.json()) as {
    channel_id?: string;
    max_uses?: number;
    max_age?: number;
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

  const permResult = await requirePermission(serverId, userId, PERMISSIONS.CREATE_INVITE, "Insufficient permissions to create invites");
  if (permResult instanceof Response) return permResult;

  // Validate channel belongs to server
  if (body.channel_id) {
    const channel = await db.prepare(
      `SELECT id FROM channels WHERE id = ? AND server_id = ?`
    ).bind(body.channel_id, serverId).first();
    if (!channel) {
      return apiError("Channel not found in this server", 404);
    }
  }

  const result = await createInvite(db, serverId, userId, body);
  return apiSuccess(result, 201);
}

// GET /api/servers/:id/invites — list invites for a server
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId } = await params;

  const db = getDB();

  const permResult = await requirePermission(serverId, userId, PERMISSIONS.MANAGE_SERVER);
  if (permResult instanceof Response) return permResult;

  const url = new URL(request.url);
  const showAll = url.searchParams.get("active") === "false";

  const results = await listInvites(db, serverId, showAll);
  return apiSuccess(results);
}
