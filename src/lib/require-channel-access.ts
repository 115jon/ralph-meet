// ── Channel-membership authorization ────────────────────────────────────────
// Verifies that the authenticated user has access to a channel.
// For server channels: checks server_members.
// For DM channels: checks dm_recipients.

import { getDB } from "@/lib/api-helpers";
import { NextResponse } from "next/server";

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
  channelId: string
): Promise<{ serverId: string | null } | NextResponse> {
  const db = getDB();

  // First, look up the channel to determine its type
  const channel = await db
    .prepare(`SELECT id, server_id, channel_type FROM channels WHERE id = ?`)
    .bind(channelId)
    .first() as { id: string; server_id: string | null; channel_type: string } | null;

  if (!channel) {
    return NextResponse.json(
      { error: "Channel not found or access denied" },
      { status: 403 }
    );
  }

  // DM channel — verify the user is a recipient
  if (channel.channel_type === "dm" || channel.server_id === null) {
    const recipient = await db
      .prepare(
        `SELECT 1 FROM dm_recipients WHERE channel_id = ? AND user_id = ?`
      )
      .bind(channelId, userId)
      .first();

    if (!recipient) {
      return NextResponse.json(
        { error: "Channel not found or access denied" },
        { status: 403 }
      );
    }

    return { serverId: null };
  }

  // Server channel — verify the user is a server member
  const member = await db
    .prepare(
      `SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`
    )
    .bind(channel.server_id, userId)
    .first();

  if (!member) {
    return NextResponse.json(
      { error: "Channel not found or access denied" },
      { status: 403 }
    );
  }

  return { serverId: channel.server_id };
}
