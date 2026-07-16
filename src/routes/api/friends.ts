import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { validateBody } from "@/lib/validate-body";
import { executeBroadcast } from "@/services/service-helpers";
import {
  acceptFriendRequest,
  blockUser,
  listRelationships,
  removeRelationship,
  sendFriendRequest,
} from "@/services/social.service";

const friendRequestSchema = z
  .object({
    username: z.string().default(""),
  })
  .passthrough();

const friendRelationshipSchema = z
  .object({
    target_user_id: z.string().default(""),
    action: z.string().default(""),
  })
  .passthrough();

const removeFriendSchema = z
  .object({
    target_user_id: z.string().default(""),
  })
  .passthrough();

// GET /api/friends — list all relationships for the authenticated user
const GET = async ({ request: _request, params: _params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const db = getDB();
  const result = await listRelationships(db, userId);
  return apiSuccess(result);
};

// POST /api/friends — send a friend request
export const POST = async ({ request, params: _params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const bodyResult = await validateBody(request, friendRequestSchema, request);
  if (bodyResult instanceof Response) return bodyResult;
  const body = bodyResult;
  if (!body.username?.trim()) {
    return apiError("Username is required", 400);
  }

  const db = getDB();

  try {
    const result = await sendFriendRequest(db, userId, body.username);

    for (const b of result.broadcasts) {
      await executeBroadcast(b);
    }

    return apiSuccess(
      { user: result.user, type: result.type },
      result.type === 3 ? 201 : 200,
    );
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

// PUT /api/friends — accept or block a relationship
export const PUT = async ({ request, params: _params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const bodyResult = await validateBody(
    request,
    friendRelationshipSchema,
    request,
  );
  if (bodyResult instanceof Response) return bodyResult;
  const body = bodyResult;
  if (!body.target_user_id || !body.action) {
    return apiError("target_user_id and action are required", 400);
  }

  const db = getDB();

  try {
    if (body.action === "accept") {
      const result = await acceptFriendRequest(db, userId, body.target_user_id);
      for (const b of result.broadcasts) {
        await executeBroadcast(b);
      }
      return apiSuccess({ success: true, type: result.type });
    }

    if (body.action === "block") {
      const result = await blockUser(db, userId, body.target_user_id);
      for (const b of result.broadcasts) {
        await executeBroadcast(b);
      }
      return apiSuccess({ success: true, type: result.type });
    }

    return apiError("Invalid action", 400);
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

// DELETE /api/friends — remove a friend or cancel/reject a request
export const DELETE = async ({ request, params: _params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const bodyResult = await validateBody(request, removeFriendSchema, request);
  if (bodyResult instanceof Response) return bodyResult;
  const body = bodyResult;
  if (!body.target_user_id) {
    return apiError("target_user_id is required", 400);
  }

  const db = getDB();
  const result = await removeRelationship(db, userId, body.target_user_id);

  for (const b of result.broadcasts) {
    await executeBroadcast(b);
  }

  return apiSuccess({ success: true });
};

export const Route = createFileRoute("/api/friends")({
  server: {
    handlers: {
      GET,
      POST,
      PUT,
      DELETE,
    },
  },
});
