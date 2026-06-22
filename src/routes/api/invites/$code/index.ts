import { createFileRoute } from '@tanstack/react-router';

import { apiSuccess, getDB } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { getInviteInfo } from "@/services/social.service";

// GET /api/invites/:code — preview invite info (no auth required)
const GET = async ({ params }: any) => {
  const { code } = params;
  const db = getDB();

  try {
    const info = await getInviteInfo(db, code);
    return apiSuccess(info);
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
};


export const Route = createFileRoute('/api/invites/$code/')({
  server: {
    handlers: {
      GET,
    }
  }
});
