import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";

// GET /api/users/me — fetch the canonical current user profile from D1
const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const db = getDB();
  const user = await db
    .prepare(`SELECT id, username, avatar_url, bio, status, custom_status FROM users WHERE id = ?`)
    .bind(userId)
    .first();

  if (!user) {
    return apiError("User not found", 404);
  }

  return apiSuccess(user);
}


export const Route = createFileRoute('/api/users/me')({
  server: {
    handlers: {
      GET,
    }
  }
});
