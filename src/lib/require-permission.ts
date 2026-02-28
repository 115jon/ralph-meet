import { getDB } from "@/lib/api-helpers";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { NextResponse } from "next/server";

/**
 * Verify the user has a specific permission in a server.
 *
 * Sums all role-based permissions for the user via `member_roles + roles`,
 * then checks the requested bitmask flag.
 *
 * @returns `{ permissions: number }` on success, or a `NextResponse` (403) on failure.
 */
export async function requirePermission(
  serverId: string,
  userId: string,
  permission: number,
  errorMessage = "Insufficient permissions"
): Promise<{ permissions: number } | NextResponse> {
  const db = getDB();

  const result = await db
    .prepare(
      `SELECT SUM(r.permissions) as total_perms
       FROM member_roles mr
       JOIN roles r ON r.id = mr.role_id
       WHERE mr.server_id = ? AND mr.user_id = ?`
    )
    .bind(serverId, userId)
    .first();

  const totalPerms = result?.total_perms as number | null;

  if (totalPerms === null || !hasPermission(totalPerms, permission)) {
    return NextResponse.json({ error: errorMessage }, { status: 403 });
  }

  return { permissions: totalPerms };
}

/**
 * Get the combined permissions for a user in a server, without enforcing any
 * specific flag. Returns `null` if the user has no roles (not a member).
 */
export async function getUserPermissions(
  serverId: string,
  userId: string
): Promise<number | null> {
  const db = getDB();

  const result = await db
    .prepare(
      `SELECT SUM(r.permissions) as total_perms
       FROM member_roles mr
       JOIN roles r ON r.id = mr.role_id
       WHERE mr.server_id = ? AND mr.user_id = ?`
    )
    .bind(serverId, userId)
    .first();

  return result ? (result.total_perms as number) : null;
}

/**
 * Calculates a user's permissions for a specific channel, taking into account
 * role hierarchy and channel permission overrides.
 *
 * Evaluation order (matches Discord's logic):
 * 1. Server-wide Administrator -> Grants all permissions immediately.
 * 2. Base `@everyone` permissions in the server.
 * 3. Base role permissions in the server (summed).
 * 4. Apply Channel Overrides for `@everyone` role (deny then allow).
 * 5. Apply Channel Overrides for user's roles (summed deny then summed allow).
 * 6. Apply Channel Overrides for the specific user (deny then allow).
 */
export async function getUserChannelPermissions(
  serverId: string,
  channelId: string,
  userId: string
): Promise<number | null> {
  const db = getDB();

  // 1. Get user's base roles and calculate base permissions
  const { results: userRoles } = await db.prepare(
    `SELECT r.id, r.permissions, r.is_default
     FROM member_roles mr
     JOIN roles r ON r.id = mr.role_id
     WHERE mr.server_id = ? AND mr.user_id = ?`
  ).bind(serverId, userId).all();

  if (!userRoles || userRoles.length === 0) {
    return null; // Not a member
  }

  let basePermissions = 0;
  const roleIds: string[] = [];
  let everyoneRoleId: string | null = null;

  for (const role of userRoles) {
    basePermissions |= role.permissions as number;
    roleIds.push(role.id as string);
    if (role.is_default === 1) {
      everyoneRoleId = role.id as string;
    }
  }

  // Administrators bypass all channel overrides
  if (hasPermission(basePermissions, PERMISSIONS.ADMINISTRATOR)) {
    return basePermissions;
  }

  // 2. Fetch all overrides for this channel that apply to the user
  const placeholders = roleIds.map(() => '?').join(',');
  const queryParams = [channelId, userId, ...roleIds];

  const { results: overrides } = await db.prepare(
    `SELECT target_id, target_type, allow, deny
     FROM channel_permission_overrides
     WHERE channel_id = ?
       AND (
         (target_type = 'user' AND target_id = ?) OR
         (target_type = 'role' AND target_id IN (${placeholders}))
       )`
  ).bind(...queryParams).all();

  let finalPermissions = basePermissions;

  // Find specific overrides
  const everyoneOverride = overrides?.find((o: any) => o.target_type === 'role' && o.target_id === everyoneRoleId);
  const roleOverrides = overrides?.filter((o: any) => o.target_type === 'role' && o.target_id !== everyoneRoleId);
  const userOverride = overrides?.find((o: any) => o.target_type === 'user' && o.target_id === userId);

  // 3. Apply @everyone overrides
  if (everyoneOverride) {
    finalPermissions &= ~(everyoneOverride.deny as number);
    finalPermissions |= (everyoneOverride.allow as number);
  }

  // 4. Apply Role overrides (sum all denies, sum all allows)
  if (roleOverrides && roleOverrides.length > 0) {
    let roleDenies = 0;
    let roleAllows = 0;
    for (const ro of roleOverrides) {
      roleDenies |= ro.deny as number;
      roleAllows |= ro.allow as number;
    }
    finalPermissions &= ~roleDenies;
    finalPermissions |= roleAllows;
  }

  // 5. Apply User override
  if (userOverride) {
    finalPermissions &= ~(userOverride.deny as number);
    finalPermissions |= (userOverride.allow as number);
  }

  return finalPermissions;
}

/**
 * Verify the user has a specific permission in a specific channel.
 */
export async function requireChannelPermission(
  serverId: string,
  channelId: string,
  userId: string,
  permission: number,
  errorMessage = "Insufficient channel permissions"
): Promise<{ permissions: number } | NextResponse> {
  const totalPerms = await getUserChannelPermissions(serverId, channelId, userId);

  if (totalPerms === null || !hasPermission(totalPerms, permission)) {
    return NextResponse.json({ error: errorMessage }, { status: 403 });
  }

  return { permissions: totalPerms };
}

/**
 * Filters a list of channels, returning only those the user has VIEW_CHANNELS for.
 * Computes all channel overrides locally in one pass for performance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getVisibleChannels<T extends { id: string }>(
  serverId: string,
  userId: string,
  channels: T[]
): Promise<T[]> {
  const db = getDB();

  // 1. Get user's base roles
  const { results: userRoles } = await db.prepare(
    `SELECT r.id, r.permissions, r.is_default
     FROM member_roles mr
     JOIN roles r ON r.id = mr.role_id
     WHERE mr.server_id = ? AND mr.user_id = ?`
  ).bind(serverId, userId).all();

  if (!userRoles || userRoles.length === 0) return [];

  let basePermissions = 0;
  const roleIds: string[] = [];
  let everyoneRoleId: string | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const role of userRoles as any[]) {
    basePermissions |= role.permissions as number;
    roleIds.push(role.id as string);
    if (role.is_default === 1) everyoneRoleId = role.id as string;
  }

  if (hasPermission(basePermissions, PERMISSIONS.ADMINISTRATOR)) {
    return channels;
  }

  const placeholders = roleIds.length > 0 ? roleIds.map(() => '?').join(',') : "''";
  const queryParams = [serverId, userId, ...roleIds];

  const { results: overrides } = await db.prepare(
    `SELECT co.channel_id, co.target_id, co.target_type, co.allow, co.deny
     FROM channel_permission_overrides co
     JOIN channels c ON c.id = co.channel_id
     WHERE c.server_id = ?
       AND (
         (co.target_type = 'user' AND co.target_id = ?) OR
         (co.target_type = 'role' AND co.target_id IN (${placeholders}))
       )`
  ).bind(...queryParams).all();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overridesByChannel = (overrides || []).reduce((acc: Record<string, any[]>, row: any) => {
    if (!acc[row.channel_id]) acc[row.channel_id] = [];
    acc[row.channel_id].push(row);
    return acc;
  }, {});

  return channels.reduce((acc: T[], channel) => {
    let finalPermissions = basePermissions;
    const chanOverrides = overridesByChannel[channel.id] || [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const everyoneOverride = chanOverrides.find((o: any) => o.target_type === 'role' && o.target_id === everyoneRoleId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const roleOverrides = chanOverrides.filter((o: any) => o.target_type === 'role' && o.target_id !== everyoneRoleId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userOverride = chanOverrides.find((o: any) => o.target_type === 'user' && o.target_id === userId);

    if (everyoneOverride) {
      finalPermissions &= ~(everyoneOverride.deny as number);
      finalPermissions |= (everyoneOverride.allow as number);
    }

    if (roleOverrides.length > 0) {
      let roleDenies = 0;
      let roleAllows = 0;
      for (const ro of roleOverrides) {
        roleDenies |= ro.deny as number;
        roleAllows |= ro.allow as number;
      }
      finalPermissions &= ~roleDenies;
      finalPermissions |= roleAllows;
    }

    if (userOverride) {
      finalPermissions &= ~(userOverride.deny as number);
      finalPermissions |= (userOverride.allow as number);
    }

    if (hasPermission(finalPermissions, PERMISSIONS.VIEW_CHANNELS)) {
      acc.push({ ...channel, permissions: finalPermissions });
    }
    return acc;
  }, []);
}
