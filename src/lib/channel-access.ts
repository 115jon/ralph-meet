import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getUserChannelPermissionsForDb } from "@/lib/require-permission";
import type { D1Database } from "@cloudflare/workers-types";

export interface ChannelAccess {
  channelId: string;
  channelType: string;
  serverId: string | null;
  permissions: number | null;
}

export async function resolveChannelAccess(
  db: D1Database,
  userId: string,
  channelId: string,
): Promise<ChannelAccess | null> {
  try {
    const channel = await db
      .prepare(
        "SELECT id, server_id, channel_type FROM channels WHERE id = ? LIMIT 1",
      )
      .bind(channelId)
      .first<{
        id: string;
        server_id: string | null;
        channel_type: string;
      }>();

    if (!channel) return null;

    if (channel.channel_type === "dm" || channel.server_id === null) {
      const recipient = await db
        .prepare(
          "SELECT 1 FROM dm_recipients WHERE channel_id = ? AND user_id = ? LIMIT 1",
        )
        .bind(channelId, userId)
        .first();

      return recipient
        ? {
            channelId: channel.id,
            channelType: channel.channel_type,
            serverId: null,
            permissions: null,
          }
        : null;
    }

    const member = await db
      .prepare(
        "SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1",
      )
      .bind(channel.server_id, userId)
      .first();
    if (!member) return null;

    const permissions = await getUserChannelPermissionsForDb(
      db,
      channel.server_id,
      channel.id,
      userId,
    );
    if (
      permissions === null ||
      !hasPermission(permissions, PERMISSIONS.VIEW_CHANNELS)
    )
      return null;

    return {
      channelId: channel.id,
      channelType: channel.channel_type,
      serverId: channel.server_id,
      permissions,
    };
  } catch {
    return null;
  }
}

export function hasChannelPermission(
  access: ChannelAccess,
  permission: number,
): boolean {
  return (
    access.serverId === null ||
    (access.permissions !== null &&
      hasPermission(access.permissions, permission))
  );
}
