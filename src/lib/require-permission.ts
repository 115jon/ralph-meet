import { getDB } from "@/lib/api-helpers";
import {
  resolveVisibleChannelPermissions,
  type ChannelVisibilityOverride,
  type ChannelVisibilityRole,
} from "@/lib/channel-visibility";
import { calculatePermissions, hasPermission, PERMISSIONS } from "@/lib/permissions";

async function fetchServerMemberRoles(
  serverId: string,
  userId: string
): Promise<Array<{ permissions: number; position: number; is_default: number; id: string }>> {
  const db = getDB();
  const { results } = await db
    .prepare(
      `SELECT r.id, r.permissions, r.position, r.is_default
       FROM server_members sm
       JOIN member_roles mr ON mr.server_id = sm.server_id AND mr.user_id = sm.user_id
       JOIN roles r ON r.id = mr.role_id
       WHERE sm.server_id = ? AND sm.user_id = ?`
    )
    .bind(serverId, userId)
    .all();

  return (results ?? []) as Array<{ permissions: number; position: number; is_default: number; id: string }>;
}


/**
 * Verify the user has a specific permission in a server.
 *
 * Combines all role-based permissions for the user via `member_roles + roles`,
 * then checks the requested bitmask flag.
 *
 * @returns `{ permissions: number }` on success, or a `NextResponse` (403) on failure.
 */
export async function requirePermission(
  serverId: string,
  userId: string,
  permission: number,
  errorMessage = "Insufficient permissions"
): Promise<{ permissions: number } | Response> {
  const roles = await fetchServerMemberRoles(serverId, userId);
  const totalPerms = roles.length > 0
    ? calculatePermissions(roles.map((role) => role.permissions))
    : null;

  if (totalPerms === null || !hasPermission(totalPerms, permission)) {
    return Response.json({ error: errorMessage }, { status: 403 });
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
  const roles = await fetchServerMemberRoles(serverId, userId);
  return roles.length > 0
    ? calculatePermissions(roles.map((role) => role.permissions))
    : null;
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
  const userRoles = await fetchServerMemberRoles(serverId, userId);

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
): Promise<{ permissions: number } | Response> {
  const totalPerms = await getUserChannelPermissions(serverId, channelId, userId);

  if (totalPerms === null || !hasPermission(totalPerms, permission)) {
    return Response.json({ error: errorMessage }, { status: 403 });
  }

  return { permissions: totalPerms };
}

/**
 * Filters a list of channels, returning only those the user has VIEW_CHANNELS for.
 * Computes all channel overrides locally in one pass for performance.
 */
 
export async function getVisibleChannels<T extends { id: string }>(
  serverId: string,
  userId: string,
  channels: T[]
): Promise<T[]> {
  const db = getDB();

  const userRoles = await fetchServerMemberRoles(serverId, userId) as ChannelVisibilityRole[];

  if (!userRoles || userRoles.length === 0) return [];
  const roleIds = userRoles.map((role) => role.id);

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
  const visiblePermissions = resolveVisibleChannelPermissions(
    channels,
    userId,
    userRoles,
    (overrides ?? []) as ChannelVisibilityOverride[],
  );

  return channels.reduce((acc: T[], channel) => {
    const permissions = visiblePermissions[channel.id];
    if (permissions === undefined) return acc;
    acc.push({ ...channel, permissions });
    return acc;
  }, []);
}
