/**
 * Discord-style Permission Bitmasks
 *
 * Permissions are represented as a 64-bit integer bitfield (using Number or BigInt).
 * For now we use standard numbers since JS safely supports bitwise ops up to 32 bits,
 * which gives us 31 distinct permissions.
 */

// Core Permissions
export const PERMISSIONS = {
  // General Server Permissions
  ADMINISTRATOR: 1 << 0,       // 1 - Implicitly grants all other permissions
  MANAGE_SERVER: 1 << 1,       // 2
  MANAGE_ROLES: 1 << 2,        // 4
  MANAGE_CATEGORIES: 1 << 3,   // 8
  MANAGE_CHANNELS: 1 << 4,     // 16

  // Member Management
  KICK_MEMBERS: 1 << 5,        // 32
  BAN_MEMBERS: 1 << 6,         // 64
  CREATE_INVITE: 1 << 7,       // 128

  // Text Channel Permissions
  VIEW_CHANNELS: 1 << 8,       // 256
  SEND_MESSAGES: 1 << 9,       // 512
  MANAGE_MESSAGES: 1 << 10,    // 1024
  ADD_REACTIONS: 1 << 11,      // 2048
  ATTACH_FILES: 1 << 12,       // 4096

  // Voice Channel Permissions
  CONNECT: 1 << 13,            // 8192
  SPEAK: 1 << 14,              // 16384
  VIDEO: 1 << 15,              // 32768
  MUTE_MEMBERS: 1 << 16,       // 65536
  DEAFEN_MEMBERS: 1 << 17,     // 131072
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

// Helper to calculate total permissions from a list of bitmasks
export function calculatePermissions(rolePermissions: number[]): number {
  return rolePermissions.reduce((total, perms) => total | perms, 0);
}

// Helper to check if a user has a specific permission
export function hasPermission(totalPermissions: number, checkPermission: number): boolean {
  // Administrators always have permission
  if ((totalPermissions & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR) {
    return true;
  }
  return (totalPermissions & checkPermission) === checkPermission;
}

// Default permissions for the @everyone role
export const DEFAULT_EVERYONE_PERMISSIONS =
  PERMISSIONS.VIEW_CHANNELS |
  PERMISSIONS.SEND_MESSAGES |
  PERMISSIONS.ADD_REACTIONS |
  PERMISSIONS.ATTACH_FILES |
  PERMISSIONS.CONNECT |
  PERMISSIONS.SPEAK |
  PERMISSIONS.VIDEO |
  PERMISSIONS.CREATE_INVITE;
