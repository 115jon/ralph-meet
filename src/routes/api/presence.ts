import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { validateBody } from "@/lib/validate-body";
import { getPresence, updatePresence } from "@/services/presence.service";
import { executeBroadcast } from "@/services/service-helpers";

const presenceUpdateSchema = z
  .object({
    status: z.string().default(""),
    custom_status: z.string().nullable().optional(),
  })
  .passthrough();

// GET /api/presence — fetch current user's presence
const GET = async ({ request, params: _params }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const db = getDB();
  const result = await getPresence(db, userId);

  return apiSuccess(result);
};

// POST /api/presence — update user's presence status
export const POST = async ({ request, params: _params }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const bodyResult = await validateBody(request, presenceUpdateSchema, request);
  if (bodyResult instanceof Response) return bodyResult;
  const body = bodyResult;

  const db = getDB();

  try {
    const result = await updatePresence(db, userId, {
      status: body.status,
      custom_status: body.custom_status,
    });

    for (const broadcast of result.broadcasts) {
      await executeBroadcast(broadcast);
    }

    return apiSuccess({
      status: result.status,
      custom_status: result.custom_status,
    });
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json(
        { error: e.message, code: e.code },
        { status: e.status },
      );
    }
    throw e;
  }
};

export const Route = createFileRoute("/api/presence")({
  server: {
    handlers: {
      GET,
      POST,
    },
  },
});
