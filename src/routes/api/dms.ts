import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { executeBroadcast } from "@/services/service-helpers";
import { getOrCreateDM, listDMs } from "@/services/social.service";


// GET /api/dms — list all DM channels for the authenticated user
const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const db = getDB();
  const dms = await listDMs(db, userId);
  return apiSuccess(dms);
}

// POST /api/dms — open or create a DM with a user
const POST = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const body = (await request.json()) as { target_user_id: string };
  if (!body.target_user_id) {
    return apiError("target_user_id is required", 400);
  }

  const db = getDB();

  try {
    const result = await getOrCreateDM(db, userId, body.target_user_id);

    if (result.broadcast) {
      await executeBroadcast(result.broadcast);
    }

    return apiSuccess(result.dm, result.isNew ? 201 : 200);
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}


export const Route = createFileRoute('/api/dms')({
  server: {
    handlers: {
      GET,
      POST,
    }
  }
});
