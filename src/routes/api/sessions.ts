import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, requireAuth } from "@/lib/api-helpers";
import { getRalphAuthSession } from "@/lib/ralph-auth-server";

const GET = async ({ request }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;

  const authSession = await getRalphAuthSession(request.headers);
  const session = authSession?.session;

  return apiSuccess({
    sessions: session
      ? [
        {
          id: session.id,
          clientId: null,
          status: "active",
          lastActiveAt: session.updatedAt ?? session.createdAt ?? null,
          createdAt: session.createdAt ?? null,
          expireAt: session.expiresAt ?? null,
          isCurrent: true,
          activity: null,
        },
      ]
      : [],
  });
};

const DELETE = async ({ request: req }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;

  let body: { sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return apiError("Invalid JSON", 400);
  }

  if (!body.sessionId || typeof body.sessionId !== "string") {
    return apiError("sessionId is required", 400);
  }

  return apiError("Session revocation is managed by Ralph Auth sign-out for this app session.", 501);
};

export const Route = createFileRoute("/api/sessions")({
  server: {
    handlers: {
      GET,
      DELETE,
    },
  },
});
