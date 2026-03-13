import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { getMe } from "@/services/user.service";

/**
 * GET /api/users/me — fetch the current user profile from D1.
 *
 * If the user doesn't exist in D1 yet (fresh DB, webhook missed, etc.),
 * we auto-sync them from Clerk. This is the canonical client-side sync
 * point — the only place outside the Clerk webhook that creates a user row.
 */
const GET = async ({ request, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const db = getDB();

  try {
    const user = await getMe(db, userId);

    // If user has no avatar in D1, try to backfill from Clerk's imageUrl.
    // This ensures users who were created before avatar sync was in place
    // get their Clerk profile picture stored in D1 for all queries.
    if (!user.avatar_url) {
      try {
        const { clerkClient } = await import("@clerk/tanstack-react-start/server");
        const client = await clerkClient();
        const clerkUser = await client.users.getUser(userId);
        if (clerkUser?.imageUrl) {
          await db
            .prepare(`UPDATE users SET avatar_url = ? WHERE id = ? AND (avatar_url IS NULL OR avatar_url = '')`)
            .bind(clerkUser.imageUrl, userId)
            .run();
          user.avatar_url = clerkUser.imageUrl;
        }
      } catch { /* Clerk fetch failed — not critical, skip */ }
    }

    return apiSuccess(user);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) {
      // User not in D1 — auto-sync from Clerk session data
      try {
        const synced = await syncUserFromClerk(db, userId);
        if (synced) return apiSuccess(synced);
      } catch (syncErr) {
        console.error("[users/me] Auto-sync from Clerk failed:", syncErr);
      }
      return apiError("User profile not found. Please sign out and sign back in.", 404);
    }
    throw e;
  }
}

/**
 * Pull the user's profile from Clerk Backend API and insert into D1.
 * Only called as a fallback when the user row is missing (e.g. fresh local DB).
 */
async function syncUserFromClerk(
  db: any,
  userId: string
): Promise<{ id: string; username: string; display_name: string | null; avatar_url: string | null; bio: string | null; status: string; custom_status: string | null } | null> {
  const { clerkClient } = await import("@clerk/tanstack-react-start/server");
  const client = await clerkClient();
  const clerkUser = await client.users.getUser(userId);

  if (!clerkUser) return null;

  const username =
    clerkUser.username ??
    `user_${userId.slice(-6)}`;
  const displayName =
    ((clerkUser.unsafeMetadata as any)?.displayName as string | undefined) ??
    ([clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null) ??
    username;
  const avatarUrl = clerkUser.imageUrl ?? null;
  const bio = (clerkUser.unsafeMetadata as any)?.bio ?? null;
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO users (id, username, display_name, avatar_url, bio, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'online', ?)
       ON CONFLICT(id) DO UPDATE SET
         username = excluded.username,
         display_name = CASE
           WHEN users.display_name IS NOT NULL AND users.display_name != '' THEN users.display_name
           ELSE excluded.display_name
         END,
         avatar_url = CASE
           WHEN users.avatar_url LIKE '/api/avatars/%' THEN users.avatar_url
           ELSE excluded.avatar_url
         END,
         bio = excluded.bio`
    )
    .bind(userId, username, displayName, avatarUrl, bio, now)
    .run();

  return {
    id: userId,
    username,
    display_name: displayName,
    avatar_url: avatarUrl,
    bio,
    status: "online",
    custom_status: null,
  };
}


export const Route = createFileRoute('/api/users/me')({
  server: {
    handlers: {
      GET,
    }
  }
});
