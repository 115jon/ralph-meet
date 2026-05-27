import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { listUserMessageShares } from "@/services/message-share.service";
import { createFileRoute } from "@tanstack/react-router";

const GET = async ({ request }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  try {
    const shares = await listUserMessageShares(getDB(), authResult.userId);
    return apiSuccess({ shares });
  } catch (error) {
    if (error instanceof ServiceError) {
      return apiError(error.message, error.status, error.code);
    }
    throw error;
  }
};

export const Route = createFileRoute("/api/shares/")({
  server: {
    handlers: {
      GET,
    },
  },
});
