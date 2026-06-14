import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, getDB, requireAuth } from '@/lib/api-helpers';
import { hasAnyPermission, PERMISSIONS } from '@/lib/permissions';
import { getUserPermissions } from '@/lib/require-permission';
import { ServiceError } from '@/lib/service-error';
import { fetchAuditLogs } from '@/services/user.service';


const GET = async ({ request, params }: any) => {
  const { id: serverId } = params;

  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  // Allow any of: MANAGE_SERVER, ADMINISTRATOR, VIEW_AUDIT_LOG
  const userPermissions = await getUserPermissions(serverId, userId);
  if (userPermissions === null || !hasAnyPermission(userPermissions, PERMISSIONS.MANAGE_SERVER | PERMISSIONS.VIEW_AUDIT_LOG)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

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
