import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { revokeMessageShare } from "@/services/message-share.service";
import { createFileRoute } from "@tanstack/react-router";

const DELETE = async ({ request, params }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  try {
    await revokeMessageShare(getDB(), params.id, authResult.userId);
    return apiSuccess({ revoked: true });
  } catch (error) {
    if (error instanceof ServiceError) {
      return apiError(error.message, error.status, error.code);
    }
    throw error;
  }
};

export const Route = createFileRoute("/api/shares/$id")({
  server: {
    handlers: {
      DELETE,
    },
  },
});
