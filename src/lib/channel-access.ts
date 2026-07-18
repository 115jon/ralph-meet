import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getUserChannelPermissionsForDb } from "@/lib/require-permission";
import type { D1Database } from "@cloudflare/workers-types";

export interface ChannelAccess {
  channelId: string;
  channelType: string;
  serverId: string | null;
  permissions: number | null;
}

export type BatchedChannelAccessDecision =
  | { kind: "allowed"; permissions: number | null }
  | { kind: "denied"; permissions: number | null }
  | { kind: "error" };

interface BatchChannel {
  id: string;
  server_id: string | null;
  channel_type: string;
}

interface BatchServerAccessRow {
  user_id: string;
  role_id: string;
  role_permissions: number;
  role_position: number;
  role_is_default: number;
  override_target_id: string | null;
  override_target_type: string | null;
  override_allow: number | null;
  override_deny: number | null;
}

interface BatchRole {
  id: string;
  permissions: number;
  is_default: number;
}

interface BatchOverride {
  target_id: string;
  target_type: "role" | "user";
  allow: number;
  deny: number;
}

interface BatchUserState {
  roles: BatchRole[];
  overrides: Map<string, BatchOverride>;
}

const DM_USER_IDS_PER_CHUNK = 99;
const SERVER_USER_IDS_PER_CHUNK = 98;

export async function resolveChannelAccessForUsers(
  db: D1Database,
  channelId: string,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, BatchedChannelAccessDecision>> {
  const uniqueUserIds = [
    ...new Set(userIds.map((userId) => userId.trim()).filter(Boolean)),
  ];
  if (uniqueUserIds.length === 0) return new Map();

  const decisions = new Map<string, BatchedChannelAccessDecision>();
  for (const userId of uniqueUserIds) {
    decisions.set(userId, { kind: "denied", permissions: null });
  }

  let channel: BatchChannel | null;
  try {
    channel = await db
      .prepare(
        "SELECT id, server_id, channel_type FROM channels WHERE id = ? LIMIT 1",
      )
      .bind(channelId)
      .first<BatchChannel>();
  } catch {
    for (const userId of uniqueUserIds) {
      decisions.set(userId, { kind: "error" });
    }
    return decisions;
  }

  if (!channel) return decisions;

  if (channel.channel_type === "dm" || channel.server_id === null) {
    for (
      let offset = 0;
      offset < uniqueUserIds.length;
      offset += DM_USER_IDS_PER_CHUNK
    ) {
      const chunk = uniqueUserIds.slice(offset, offset + DM_USER_IDS_PER_CHUNK);
      const placeholders = chunk.map(() => "?").join(",");

      try {
        const { results } = await db
          .prepare(
            `SELECT user_id
             FROM dm_recipients
             WHERE channel_id = ? AND user_id IN (${placeholders})`,
          )
          .bind(channelId, ...chunk)
          .all<{ user_id: string }>();

        for (const row of results ?? []) {
          if (typeof row.user_id !== "string") continue;
          if (!decisions.has(row.user_id)) continue;
          decisions.set(row.user_id, { kind: "allowed", permissions: null });
        }
      } catch {
        for (const userId of chunk) {
          decisions.set(userId, { kind: "error" });
        }
      }
    }
    return decisions;
  }

  for (
    let offset = 0;
    offset < uniqueUserIds.length;
    offset += SERVER_USER_IDS_PER_CHUNK
  ) {
    const chunk = uniqueUserIds.slice(
      offset,
      offset + SERVER_USER_IDS_PER_CHUNK,
    );
    const placeholders = chunk.map(() => "?").join(",");

    let rows: BatchServerAccessRow[];
    try {
      const result = await db
        .prepare(
          `SELECT
             sm.user_id AS user_id,
             r.id AS role_id,
             r.permissions AS role_permissions,
             r.position AS role_position,
             r.is_default AS role_is_default,
             co.target_id AS override_target_id,
             co.target_type AS override_target_type,
             co.allow AS override_allow,
             co.deny AS override_deny
           FROM server_members AS sm
           JOIN member_roles AS mr
             ON mr.server_id = sm.server_id
            AND mr.user_id = sm.user_id
           JOIN roles AS r ON r.id = mr.role_id
           LEFT JOIN channel_permission_overrides AS co
             ON co.channel_id = ?
            AND (
              (co.target_type = 'user' AND co.target_id = sm.user_id) OR
              (co.target_type = 'role' AND co.target_id = mr.role_id)
            )
           WHERE sm.server_id = ?
             AND sm.user_id IN (${placeholders})`,
        )
        .bind(channel.id, channel.server_id, ...chunk)
        .all<BatchServerAccessRow>();
      rows = result.results ?? [];
    } catch {
      for (const userId of chunk) {
        decisions.set(userId, { kind: "error" });
      }
      continue;
    }

    const users = new Map<string, BatchUserState>();
    for (const row of rows) {
      if (!isBatchServerAccessRow(row) || !decisions.has(row.user_id)) {
        continue;
      }

      let user = users.get(row.user_id);
      if (!user) {
        user = { roles: [], overrides: new Map() };
        users.set(row.user_id, user);
      }
      user.roles.push({
        id: row.role_id,
        permissions: row.role_permissions,
        is_default: row.role_is_default,
      });

      if (
        row.override_target_id !== null &&
        row.override_target_type !== null
      ) {
        if (row.override_allow === null || row.override_deny === null) {
          continue;
        }
        user.overrides.set(
          `${row.override_target_type}:${row.override_target_id}`,
          {
            target_id: row.override_target_id,
            target_type: row.override_target_type,
            allow: row.override_allow,
            deny: row.override_deny,
          },
        );
      }
    }

    for (const userId of chunk) {
      const user = users.get(userId);
      if (!user || user.roles.length === 0) continue;

      let basePermissions = 0;
      let everyoneRoleId: string | null = null;
      for (const role of user.roles) {
        basePermissions |= role.permissions;
        if (role.is_default === 1) everyoneRoleId = role.id;
      }

      if (hasPermission(basePermissions, PERMISSIONS.ADMINISTRATOR)) {
        decisions.set(userId, {
          kind: "allowed",
          permissions: basePermissions,
        });
        continue;
      }

      let finalPermissions = basePermissions;
      const everyoneOverride = everyoneRoleId
        ? user.overrides.get(`role:${everyoneRoleId}`)
        : undefined;
      if (everyoneOverride) {
        finalPermissions &= ~everyoneOverride.deny;
        finalPermissions |= everyoneOverride.allow;
      }

      let roleDenies = 0;
      let roleAllows = 0;
      for (const override of user.overrides.values()) {
        if (
          override.target_type === "role" &&
          override.target_id !== everyoneRoleId
        ) {
          roleDenies |= override.deny;
          roleAllows |= override.allow;
        }
      }
      finalPermissions &= ~roleDenies;
      finalPermissions |= roleAllows;

      const userOverride = user.overrides.get(`user:${userId}`);
      if (userOverride) {
        finalPermissions &= ~userOverride.deny;
        finalPermissions |= userOverride.allow;
      }

      decisions.set(
        userId,
        hasPermission(finalPermissions, PERMISSIONS.VIEW_CHANNELS)
          ? { kind: "allowed", permissions: finalPermissions }
          : { kind: "denied", permissions: finalPermissions },
      );
    }
  }

  return decisions;
}

function isBatchServerAccessRow(
  row: BatchServerAccessRow,
): row is BatchServerAccessRow & {
  override_target_id: string | null;
  override_target_type: "role" | "user" | null;
  override_allow: number | null;
  override_deny: number | null;
} {
  return (
    typeof row.user_id === "string" &&
    typeof row.role_id === "string" &&
    typeof row.role_permissions === "number" &&
    typeof row.role_position === "number" &&
    typeof row.role_is_default === "number" &&
    (row.override_target_id === null ||
      typeof row.override_target_id === "string") &&
    (row.override_target_type === null ||
      row.override_target_type === "role" ||
      row.override_target_type === "user") &&
    (row.override_allow === null || typeof row.override_allow === "number") &&
    (row.override_deny === null || typeof row.override_deny === "number")
  );
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
