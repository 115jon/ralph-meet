import { hasPermission, PERMISSIONS } from "@/lib/permissions";

export interface ChannelVisibilityRole {
  id: string;
  permissions: number;
  is_default: boolean | number;
}

export interface ChannelVisibilityOverride {
  channel_id: string;
  target_id: string;
  target_type: string;
  allow: number;
  deny: number;
}

export function resolveVisibleChannelPermissions<T extends { id: string }>(
  channels: T[],
  userId: string,
  userRoles: ChannelVisibilityRole[],
  overrides: ChannelVisibilityOverride[],
): Record<string, number> {
  if (userRoles.length === 0) return {};

  let basePermissions = 0;
  let everyoneRoleId: string | null = null;

  for (const role of userRoles) {
    basePermissions |= role.permissions;
    if (role.is_default === true || role.is_default === 1) {
      everyoneRoleId = role.id;
    }
  }

  if (hasPermission(basePermissions, PERMISSIONS.ADMINISTRATOR)) {
    return channels.reduce<Record<string, number>>((acc, channel) => {
      acc[channel.id] = basePermissions;
      return acc;
    }, {});
  }

  const roleIds = new Set(userRoles.map((role) => role.id));
  const overridesByChannel = overrides.reduce<Record<string, ChannelVisibilityOverride[]>>((acc, override) => {
    if (!acc[override.channel_id]) {
      acc[override.channel_id] = [];
    }
    acc[override.channel_id].push(override);
    return acc;
  }, {});

  return channels.reduce<Record<string, number>>((acc, channel) => {
    let finalPermissions = basePermissions;
    const channelOverrides = overridesByChannel[channel.id] ?? [];

    const everyoneOverride = channelOverrides.find(
      (override) => override.target_type === "role" && override.target_id === everyoneRoleId,
    );
    const roleOverrides = channelOverrides.filter(
      (override) => override.target_type === "role" && roleIds.has(override.target_id) && override.target_id !== everyoneRoleId,
    );
    const userOverride = channelOverrides.find(
      (override) => override.target_type === "user" && override.target_id === userId,
    );

    if (everyoneOverride) {
      finalPermissions &= ~everyoneOverride.deny;
      finalPermissions |= everyoneOverride.allow;
    }

    if (roleOverrides.length > 0) {
      let roleDenies = 0;
      let roleAllows = 0;

      for (const roleOverride of roleOverrides) {
        roleDenies |= roleOverride.deny;
        roleAllows |= roleOverride.allow;
      }

      finalPermissions &= ~roleDenies;
      finalPermissions |= roleAllows;
    }

    if (userOverride) {
      finalPermissions &= ~userOverride.deny;
      finalPermissions |= userOverride.allow;
    }

    if (hasPermission(finalPermissions, PERMISSIONS.VIEW_CHANNELS)) {
      acc[channel.id] = finalPermissions;
    }

    return acc;
  }, {});
}
