import { createFileRoute } from '@tanstack/react-router';

import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { getPresence, updatePresence } from "@/services/presence.service";
import { executeBroadcast } from "@/services/service-helpers";


// GET /api/presence — fetch current user's presence
const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const db = getDB();
  const result = await getPresence(db, userId);

  return apiSuccess(result);
}

// POST /api/presence — update user's presence status
const POST = async ({ request, params }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const body = (await request.json()) as {
    status: "online" | "idle" | "dnd" | "offline";
    custom_status?: string;
  };

  const db = getDB();

  try {
    const result = await updatePresence(db, userId, {
      status: body.status,
      custom_status: body.custom_status,
    });

    await executeBroadcast(result.broadcast);

    return apiSuccess({ status: result.status, custom_status: result.custom_status });
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}


export const Route = createFileRoute('/api/presence')({
  server: {
    handlers: {
      GET,
      POST,
    }
  }
});
