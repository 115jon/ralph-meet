// ── Channel-membership authorization ────────────────────────────────────────
// Verifies that the authenticated user is a member of the server that owns
// a given channel. Returns the serverId on success, or a 403 response.

import { getDB } from "@/lib/api-helpers";
import { NextResponse } from "next/server";

/**
 * Verify the user is a member of the server that owns this channel.
 * Returns `{ serverId }` on success, or a `NextResponse` (403/404) on failure.
 */
export async function requireChannelAccess(
  userId: string,
  channelId: string
): Promise<{ serverId: string } | NextResponse> {
  const db = getDB();

  const row = await db
    .prepare(
      `SELECT c.server_id
       FROM channels c
       INNER JOIN server_members sm
         ON sm.server_id = c.server_id AND sm.user_id = ?
       WHERE c.id = ?`
    )
    .bind(userId, channelId)
    .first() as { server_id: string } | null;

  if (!row) {
    return NextResponse.json(
      { error: "Channel not found or access denied" },
      { status: 403 }
    );
  }

  return { serverId: row.server_id };
}
