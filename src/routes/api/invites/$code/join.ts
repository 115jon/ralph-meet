import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { lookupUser } from "@/lib/ensure-user";
import { ServiceError } from "@/lib/service-error";
import { executeBroadcast, executeInvalidation } from "@/services/service-helpers";
import { joinServer } from "@/services/social.service";


// POST /api/invites/:code/join — accept an invite and join a server
const POST = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const { code } = params;
  const db = getDB();

  // Look up the user — they must already be synced via /api/users/me or webhook
  const userInfo = await lookupUser(userId);
  if (!userInfo) {
    return apiError("User profile not synced yet. Please reload the page.", 409);
  }

  try {
    const result = await joinServer(db, code, userId, userInfo.username, userInfo.avatar);

    if (result.already_member) {
      return apiSuccess({ already_member: true, server: result.server });
    }

    await executeInvalidation(result.cacheKeysToInvalidate);
    if (result.broadcasts) {
      for (const b of result.broadcasts) {
        await executeBroadcast(b);
      }
    }

    return apiSuccess({ joined: true, server: result.server }, 201);
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}


export const Route = createFileRoute('/api/invites/$code/join')({
  server: {
    handlers: {
      POST,
    }
  }
});
