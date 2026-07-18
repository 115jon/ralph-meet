// ── Channel-membership authorization ────────────────────────────────────────
// Verifies that the authenticated user has access to a channel.
// For server channels: checks server_members.
// For DM channels: checks dm_recipients.

import { getDB } from "@/lib/api-helpers";
import { resolveChannelAccess } from "@/lib/channel-access";

/**
 * Verify the user has access to this channel.
 *
 * - **Server channels**: checks the user is a member of the owning server.
 *   Returns `{ serverId: string }`.
 * - **DM channels** (`server_id IS NULL`): checks the user is in `dm_recipients`.
 *   Returns `{ serverId: null }`.
 * - On failure returns a `NextResponse` (403).
 */
export async function requireChannelAccess(
  userId: string,
  channelId: string,
): Promise<{ serverId: string | null } | Response> {
  const access = await resolveChannelAccess(getDB(), userId, channelId);
  if (!access) {
    return Response.json(
      { error: "Channel not found or access denied" },
      { status: 403 },
    );
  }

  return { serverId: access.serverId };
}
