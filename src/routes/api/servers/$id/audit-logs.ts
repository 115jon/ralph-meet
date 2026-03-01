import { createFileRoute } from '@tanstack/react-router';

import { apiSuccess, apiError, getDB, requireAuth } from '@/lib/api-helpers';
import { PERMISSIONS } from '@/lib/permissions';
import { requirePermission } from '@/lib/require-permission';





const GET = async ({ request, params }: any) => {
  try {
    const { id: serverId } = params;

    // Auth
    const authResult = await requireAuth();
    if (authResult instanceof Response) return authResult;
    const { userId } = authResult;

    const db = getDB();

    // Check MANAGE_SERVER, ADMINISTRATOR or VIEW_AUDIT_LOG
    const permResult = await requirePermission(
      serverId,
      userId,
      PERMISSIONS.MANAGE_SERVER | PERMISSIONS.ADMINISTRATOR | PERMISSIONS.VIEW_AUDIT_LOG,
      "Forbidden"
    );

    if (permResult instanceof Response) {
      return permResult;
    }

    // Parse pagination (limit and page)
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const offset = (page - 1) * limit;

    const { results } = await db
      .prepare(
        `SELECT
           a.id, a.server_id, a.actor_id, a.action_type,
           a.target_id, a.changes, a.reason, a.created_at,
           u.id as user_id, u.username as user_username, u.avatar_url as user_avatar_url
         FROM server_audit_logs a
         JOIN users u ON a.actor_id = u.id
         WHERE a.server_id = ?
         ORDER BY a.created_at DESC
         LIMIT ? OFFSET ?`
      )
      .bind(serverId, limit, offset)
      .all();

    // Transform results to match the ServerAuditLog interface
    const formattedLogs = results.map((row: any) => {
      let parsedChanges = null;
      if (row.changes) {
        try { parsedChanges = JSON.parse(row.changes as string); } catch { }
      }

      return {
        id: row.id,
        server_id: row.server_id,
        actor_id: row.actor_id,
        action_type: row.action_type,
        target_id: row.target_id,
        changes: parsedChanges,
        reason: row.reason,
        created_at: row.created_at,
        actor: {
          id: row.user_id,
          username: row.user_username,
          avatar_url: row.user_avatar_url,
        }
      };
    });

    return apiSuccess(formattedLogs);
  } catch (error) {
    console.error('Failed to fetch audit logs:', error);
    return apiError('Internal server error', 500);
  }
}


export const Route = createFileRoute('/api/servers/$id/audit-logs')({
  server: {
    handlers: {
      GET,
    }
  }
});
