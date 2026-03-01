import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import {
  clearNotifications,
  listNotifications,
  markNotificationsRead,
} from "@/services/notification.service";


// GET /api/notifications — fetch user's notifications (most recent first)
export async function GET(request: Request) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "50");
  const unreadOnly = url.searchParams.get("unread") === "true";

  const db = getDB();

  try {
    const result = await listNotifications(db, userId, { limit, unreadOnly });
    return apiSuccess(result);
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}

// PATCH /api/notifications — mark notifications as read
export async function PATCH(request: Request) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const body = (await request.json()) as { ids?: string[]; all?: boolean };
  const db = getDB();

  try {
    await markNotificationsRead(db, userId, body);
    return apiSuccess({ success: true });
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}

// DELETE /api/notifications — clear all notifications
export async function DELETE() {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const db = getDB();
  await clearNotifications(db, userId);

  return apiSuccess({ cleared: true });
}
