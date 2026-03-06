import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/require-permission";
import { ServiceError } from "@/lib/service-error";
import { revokeInvite } from "@/services/social.service";


// DELETE /api/servers/:id/invites/:code — revoke an invite
const DELETE = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { id: serverId, code } = params;

  // Verify MANAGE_SERVER permission
  const permResult = await requirePermission(serverId, userId, PERMISSIONS.MANAGE_SERVER);
  if (permResult instanceof Response) return permResult;

  const db = getDB();

  try {
    await revokeInvite(db, serverId, code);
    return apiSuccess({ deleted: true });
  } catch (e) {
    if (e instanceof ServiceError) {
      return apiError(e.message, e.status, e.code);
    }
    throw e;
  }
}


export const Route = createFileRoute('/api/servers/$id/invites/$code')({
  server: {
    handlers: {
      DELETE,
    }
  }
});
