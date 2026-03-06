import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { getUserProfileMutuals } from "@/services/user.service";

const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId: currentUserId } = authResult;
  const { id: targetUserId } = params;

  const db = getDB();

  try {
    const profile = await getUserProfileMutuals(db, targetUserId, currentUserId);
    return apiSuccess(profile);
  } catch (e) {
    if (e instanceof ServiceError) {
      return apiError(e.message, e.status, e.code);
    }
    console.error("Failed to fetch user profile:", e);
    return apiError("Failed to fetch profile", 500);
  }
}


export const Route = createFileRoute('/api/users/$id/profile')({
  server: {
    handlers: {
      GET,
    }
  }
});
