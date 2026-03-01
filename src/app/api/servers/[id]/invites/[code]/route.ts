import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/require-permission";


// DELETE /api/servers/:id/invites/:code — revoke an invite
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; code: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: serverId, code } = await params;
  const db = getDB();

  // Verify MANAGE_SERVER permission
  const permResult = await requirePermission(serverId, userId, PERMISSIONS.MANAGE_SERVER);
  if (permResult instanceof Response) return permResult;

  // Verify the invite belongs to this server
  const invite = await db.prepare(
    `SELECT code FROM invites WHERE code = ? AND server_id = ?`
  ).bind(code, serverId).first();

  if (!invite) {
    return apiError("Invite not found", 404);
  }

  await db.prepare(`DELETE FROM invites WHERE code = ?`).bind(code).run();

  return apiSuccess({ deleted: true });
}
