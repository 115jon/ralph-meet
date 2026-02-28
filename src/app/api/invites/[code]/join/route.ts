import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ensureUser } from "@/lib/ensure-user";
import { ServiceError } from "@/lib/service-error";
import { executeBroadcast, executeInvalidation } from "@/services/service-helpers";
import { joinServer } from "@/services/social.service";
import { NextResponse } from "next/server";

// POST /api/invites/:code/join — accept an invite and join a server
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { code } = await params;
  const db = getDB();

  // Ensure user exists in D1
  const { username, avatar } = await ensureUser(userId);

  try {
    const result = await joinServer(db, code, userId, username, avatar);

    if (result.already_member) {
      return apiSuccess({ already_member: true, server: result.server });
    }

    await executeInvalidation(result.cacheKeysToInvalidate);
    if (result.broadcasts) {
      for (const b of result.broadcasts) {
        await executeBroadcast(b);
      }
    }

    return apiSuccess({ joined: true, server: result.server }, 201);
  } catch (e) {
    if (e instanceof ServiceError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}
