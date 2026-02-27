import { getDB } from "@/lib/api-helpers";
import { hasPermission } from "@/lib/permissions";
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
