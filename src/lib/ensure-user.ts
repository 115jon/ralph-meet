// ── Read-only user lookup ────────────────────────────────────────────────────
// Pure SELECT — no side-effects. User creation is handled exclusively by:
//   1. Clerk webhook → POST /api/auth/sync (production)
//   2. GET /api/users/me → auto-sync fallback (local dev / DB rebuild)

import { getDB } from "@/lib/api-helpers";

/**
 * Look up a user in D1 by their Clerk user ID.
 * Returns their username and avatar, or `null` if the user hasn't been synced yet.
 */
export async function lookupUser(
  userId: string
): Promise<{ username: string; display_name: string | null; avatar: string | null } | null> {
  const db = getDB();

  const row = await db
    .prepare(`SELECT username, display_name, avatar_url FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ username: string; display_name: string | null; avatar_url: string | null }>();

  if (!row) return null;

  return { username: row.username, display_name: row.display_name, avatar: row.avatar_url };
}
