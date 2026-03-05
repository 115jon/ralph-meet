import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, requireAuth } from "@/lib/api-helpers";
import { auth, clerkClient } from "@clerk/tanstack-react-start/server";

/**
 * GET /api/sessions — List all active sessions for the current user
 * Returns session data with device/browser/location info from Clerk's SessionActivity.
 */
const GET = async ({ request: req }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  // Get the current session ID so we can flag which device is "current"
  let currentSessionId: string | null = null;
  try {
    const authState = await auth();
    currentSessionId = authState.sessionId ?? null;
  } catch {
    // Non-critical — we'll just not flag a current session
  }

  try {
    const client = await clerkClient();
    const response = await client.sessions.getSessionList({
      userId,
      status: "active",
      limit: 50,
    });

    const sessions = response.data.map((session) => {
      const activity = session.latestActivity;
      return {
        id: session.id,
        clientId: session.clientId,
        status: session.status,
        lastActiveAt: session.lastActiveAt,
        createdAt: session.createdAt,
        expireAt: session.expireAt,
        isCurrent: session.id === currentSessionId,
        activity: activity
          ? {
            browserName: activity.browserName ?? null,
            browserVersion: activity.browserVersion ?? null,
            deviceType: activity.deviceType ?? null,
            city: activity.city ?? null,
            country: activity.country ?? null,
            ipAddress: activity.ipAddress ?? null,
            isMobile: activity.isMobile ?? false,
          }
          : null,
      };
    });

    // Sort: current session first, then by lastActiveAt descending
    sessions.sort((a, b) => {
      if (a.isCurrent) return -1;
      if (b.isCurrent) return 1;
      return (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0);
    });

    return apiSuccess({ sessions });
  } catch (err) {
    console.error("[sessions] Error listing sessions:", err);
    return apiError("Failed to list sessions", 500);
  }
};

/**
 * DELETE /api/sessions — Revoke a specific session
 * Body: { sessionId: string }
 */
const DELETE = async ({ request: req }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  let body: { sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return apiError("Invalid JSON", 400);
  }

  const { sessionId } = body;
  if (!sessionId || typeof sessionId !== "string") {
    return apiError("sessionId is required", 400);
  }

  // Verify the session belongs to this user before revoking
  try {
    const client = await clerkClient();
    const session = await client.sessions.getSession(sessionId);
    if (session.userId !== userId) {
      return apiError("Forbidden", 403);
    }

    await client.sessions.revokeSession(sessionId);
    return apiSuccess({ success: true, revokedSessionId: sessionId });
  } catch (err: any) {
    console.error("[sessions] Error revoking session:", err);
    if (err?.status === 404 || err?.errors?.[0]?.code === "resource_not_found") {
      return apiError("Session not found", 404);
    }
    return apiError("Failed to revoke session", 500);
  }
};

export const Route = createFileRoute('/api/sessions')({
  server: {
    handlers: {
      GET,
      DELETE,
    }
  }
});
