import { createFileRoute } from '@tanstack/react-router';

import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { fetchReadStates } from "@/services/user.service";


// GET /api/read-states — fetch all read states for the authenticated user
const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const db = getDB();
  const result = await fetchReadStates(db, userId);

  return apiSuccess(result);
}


export const Route = createFileRoute('/api/read-states')({
  server: {
    handlers: {
      GET,
    }
  }
});
