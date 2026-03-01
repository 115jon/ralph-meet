// ── Shared user upsert ──────────────────────────────────────────────────────
// Ensures a Clerk user exists in D1. Extracted from duplicated logic in
// servers/route.ts and invites/[code]/join/route.ts.

import { getDB } from "@/lib/api-helpers";

/**
 * Ensure the Clerk user exists in D1 (upsert on first API call).
 * Uses ON CONFLICT DO NOTHING so it's safe to call repeatedly.
 *
 * When called from API routes, the caller should pass userId + optional
 * Clerk metadata. If no metadata is provided, we just ensure the row exists
 * with a fallback username.
 */
export async function ensureUser(
  userId: string,
  clerkMeta?: { username?: string; avatarUrl?: string | null }
): Promise<{
  username: string;
  avatar: string | null;
}> {
  const db = getDB();

  const existing = await db
    .prepare(`SELECT id, username, avatar_url FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ id: string; username: string; avatar_url: string | null }>();

  if (existing) {
    return { username: existing.username, avatar: existing.avatar_url };
  }

  const username = clerkMeta?.username ?? "User";
  const avatar = clerkMeta?.avatarUrl ?? null;
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO users (id, username, avatar_url, status, created_at)
       VALUES (?, ?, ?, 'online', ?)
       ON CONFLICT (id) DO NOTHING`
    )
    .bind(userId, username, avatar, now)
    .run();

  return { username, avatar };
}
