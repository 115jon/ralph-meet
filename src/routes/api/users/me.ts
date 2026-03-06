import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { getMe } from "@/services/user.service";

// GET /api/users/me — fetch the canonical current user profile from D1
const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const db = getDB();

  try {
    const user = await getMe(db, userId);
    return apiSuccess(user);
  } catch (e) {
    if (e instanceof ServiceError) {
      return apiError(e.message, e.status, e.code);
    }
    throw e;
  }
}


export const Route = createFileRoute('/api/users/me')({
  server: {
    handlers: {
      GET,
    }
  }
});
