// ── Who may move whom between voice channels ───────────────────────────────
// The server's decision for POST /api/voice/move, and the sidebar's guess
// at it (which rows are draggable, which channels light up). The server
// re-checks everything on drop; the client copy only avoids offering moves
// that would be refused.

import { hasPermission, PERMISSIONS } from "@/lib/permissions";

export type VoiceMoveDenial =
  /** The mover lacks MOVE_MEMBERS on a channel, or cannot join the target. */
  | "missing_permissions"
  /** The moved member's top role is not below the mover's (as for kicks). */
  | "role_hierarchy";

export interface VoiceMoveActor {
  isOwner: boolean;
  /** Effective permissions in the source channel; null = not a member. */
  sourcePermissions: number | null;
  /** Effective permissions in the target channel; null = not a member. */
  targetPermissions: number | null;
  /** Highest role position (0 = only @everyone). */
  topRole: number;
}

export interface VoiceMoveTarget {
  isOwner: boolean;
  topRole: number;
}

/**
 * Whether `permissions` (effective, for one channel) may move members out:
 * MOVE_MEMBERS, and the channel is visible. A mover denied VIEW_CHANNELS on
 * a private channel cannot empty it.
 */
export function canMoveMembersIn(permissions: number | null): boolean {
  return (
    permissions !== null &&
    hasPermission(
      permissions,
      PERMISSIONS.MOVE_MEMBERS | PERMISSIONS.VIEW_CHANNELS,
    )
  );
}

/**
 * Whether `permissions` may be the destination of a move: MOVE_MEMBERS, and
 * the mover could see and join the channel themselves.
 */
export function canMoveMembersInto(permissions: number | null): boolean {
  return (
    permissions !== null &&
    hasPermission(
      permissions,
      PERMISSIONS.MOVE_MEMBERS |
        PERMISSIONS.VIEW_CHANNELS |
        PERMISSIONS.CONNECT,
    )
  );
}

/**
 * The mover needs MOVE_MEMBERS in both channels (channel overrides apply;
 * ADMINISTRATOR implies it) and must be able to see and join the target.
 * The server owner always may. Like kicking, a member whose top role is at
 * or above the mover's cannot be moved unless the mover is an administrator,
 * and only the owner moves the owner.
 */
export function decideVoiceMove(
  mover: VoiceMoveActor,
  target: VoiceMoveTarget,
): { ok: true } | { ok: false; reason: VoiceMoveDenial } {
  if (mover.isOwner) return { ok: true };
  if (
    !canMoveMembersIn(mover.sourcePermissions) ||
    !canMoveMembersInto(mover.targetPermissions)
  ) {
    return { ok: false, reason: "missing_permissions" };
  }
  if (target.isOwner) return { ok: false, reason: "role_hierarchy" };
  const isAdministrator = hasPermission(
    mover.sourcePermissions ?? 0,
    PERMISSIONS.ADMINISTRATOR,
  );
  if (!isAdministrator && target.topRole >= mover.topRole) {
    return { ok: false, reason: "role_hierarchy" };
  }
  return { ok: true };
}
