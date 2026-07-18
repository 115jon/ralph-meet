import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
  apiSuccess,
  broadcastToUser,
  getDB,
  requireAuth,
} from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { validateBody } from "@/lib/validate-body";
import {
  clearNotifications,
  listNotifications,
  markNotificationsRead,
} from "@/services/notification.service";

const markNotificationsReadSchema = z
  .object({
    ids: z.array(z.string()).optional(),
    all: z.boolean().optional(),
  })
  .passthrough();

// GET /api/notifications — fetch user's notifications (most recent first)
const GET = async ({ request, params: _params }: any) => {
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
      return Response.json(
        { error: e.message, code: e.code },
        { status: e.status },
      );
    }
    throw e;
  }
};

// PATCH /api/notifications — mark notifications as read
export const PATCH = async ({ request, params: _params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const bodyResult = await validateBody(
    request,
    markNotificationsReadSchema,
    request,
  );
  if (bodyResult instanceof Response) return bodyResult;
  const body = bodyResult;
  const db = getDB();

  try {
    await markNotificationsRead(db, userId, body);
    await broadcastToUser(userId, "NOTIFICATIONS_READ", {
      ids: body.ids,
      all: !!body.all,
    });
    return apiSuccess({ success: true });
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

// DELETE /api/notifications — clear all notifications
const DELETE = async ({ request: _request, params: _params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const db = getDB();
  await clearNotifications(db, userId);
  await broadcastToUser(userId, "NOTIFICATIONS_CLEAR", {});

  return apiSuccess({ cleared: true });
};

export const Route = createFileRoute("/api/notifications")({
  server: {
    handlers: {
      GET,
      PATCH,
      DELETE,
    },
  },
});
