import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, requireAuth } from "@/lib/api-helpers";
import { getKovaAuthSession } from "@/lib/kova-auth-server";
import { validateBody } from "@/lib/validate-body";
import { Schema } from "effect";

const GET = async ({ request }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;

  const authSession = await getKovaAuthSession(request.headers);
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

const sessionRevokeSchema = Schema.Struct({
  sessionId: Schema.optional(Schema.String),
});

export const DELETE = async ({ request: req }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;

  const body = await validateBody(req, sessionRevokeSchema);
  if (body instanceof Response) return body;

  if (!body.sessionId) {
    return apiError("sessionId is required", 400);
  }

  return apiError(
    "Session revocation is managed by Ralph Auth sign-out for this app session.",
    501,
  );
};

export const Route = createFileRoute("/api/sessions")({
  server: {
    handlers: {
      GET,
      DELETE,
    },
  },
});
