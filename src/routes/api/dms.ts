import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { validateBody } from "@/lib/validate-body";
import { executeBroadcast } from "@/services/service-helpers";
import { getOrCreateDM, listDMs } from "@/services/social.service";

const dmCreateSchema = z
  .object({
    target_user_id: z.string().default(""),
  })
  .passthrough();

// GET /api/dms — list all DM channels for the authenticated user
const GET = async ({ request: _request, params: _params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const db = getDB();
  const dms = await listDMs(db, userId);
  return apiSuccess(dms);
};

// POST /api/dms — open or create a DM with a user
export const POST = async ({ request, params: _params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const bodyResult = await validateBody(request, dmCreateSchema, request);
  if (bodyResult instanceof Response) return bodyResult;
  const body = bodyResult;
  if (!body.target_user_id) {
    return apiError("target_user_id is required", 400);
  }

  const db = getDB();

  try {
    const result = await getOrCreateDM(db, userId, body.target_user_id);

    if (result.broadcasts) {
      for (const broadcast of result.broadcasts) {
        await executeBroadcast(broadcast);
      }
    }

    return apiSuccess(result.dm, result.isNew ? 201 : 200);
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

export const Route = createFileRoute("/api/dms")({
  server: {
    handlers: {
      GET,
      POST,
    },
  },
});
