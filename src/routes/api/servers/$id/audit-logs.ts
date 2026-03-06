import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, getDB, requireAuth } from '@/lib/api-helpers';
import { PERMISSIONS } from '@/lib/permissions';
import { requirePermission } from '@/lib/require-permission';
import { ServiceError } from '@/lib/service-error';
import { fetchAuditLogs } from '@/services/user.service';


const GET = async ({ request, params }: any) => {
  const { id: serverId } = params;

  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  // Check MANAGE_SERVER, ADMINISTRATOR or VIEW_AUDIT_LOG
  const permResult = await requirePermission(
    serverId,
    userId,
    PERMISSIONS.MANAGE_SERVER | PERMISSIONS.ADMINISTRATOR | PERMISSIONS.VIEW_AUDIT_LOG,
    "Forbidden"
  );
  if (permResult instanceof Response) return permResult;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
  const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);

  const db = getDB();

  try {
    const logs = await fetchAuditLogs(db, serverId, { limit, page });
    return apiSuccess(logs);
  } catch (e) {
    if (e instanceof ServiceError) {
      return apiError(e.message, e.status, e.code);
    }
    console.error('Failed to fetch audit logs:', e);
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
