import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { executeBroadcast } from "@/services/service-helpers";
import {
  acceptFriendRequest,
  blockUser,
  listRelationships,
  removeRelationship,
  sendFriendRequest,
} from "@/services/social.service";


// GET /api/friends — list all relationships for the authenticated user
export async function GET() {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const db = getDB();
  const result = await listRelationships(db, userId);
  return apiSuccess(result);
}

// POST /api/friends — send a friend request
export async function POST(request: Request) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const body = (await request.json()) as { username: string };
  if (!body.username?.trim()) {
    return apiError("Username is required", 400);
  }

  const db = getDB();

  try {
    const result = await sendFriendRequest(db, userId, body.username);

    for (const b of result.broadcasts) {
      await executeBroadcast(b);
    }

    return apiSuccess({ user: result.user, type: result.type }, result.type === 3 ? 201 : 200);
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}

// PUT /api/friends — accept or block a relationship
export async function PUT(request: Request) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const body = (await request.json()) as { target_user_id: string; action: "accept" | "block" };
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
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}

// DELETE /api/friends — remove a friend or cancel/reject a request
export async function DELETE(request: Request) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const body = (await request.json()) as { target_user_id: string };
  if (!body.target_user_id) {
    return apiError("target_user_id is required", 400);
  }

  const db = getDB();
  const result = await removeRelationship(db, userId, body.target_user_id);

  for (const b of result.broadcasts) {
    await executeBroadcast(b);
  }

  return apiSuccess({ success: true });
}
