// ── Shared user upsert ──────────────────────────────────────────────────────
// Ensures a Clerk user exists in D1. Extracted from duplicated logic in
// servers/route.ts and invites/[code]/join/route.ts.

import { getDB } from "@/lib/api-helpers";
import { currentUser } from "@clerk/nextjs/server";

/**
 * Ensure the Clerk user exists in D1 (upsert on first API call).
 * Uses ON CONFLICT DO NOTHING so it's safe to call repeatedly.
 */
export async function ensureUser(userId: string): Promise<{
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

  const clerk = await currentUser();
  const username = clerk?.username ?? clerk?.firstName ?? "User";
  const avatar = clerk?.imageUrl ?? null;
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
