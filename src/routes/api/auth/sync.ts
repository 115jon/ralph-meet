import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, broadcastToAll, getDB } from "@/lib/api-helpers";
import { cacheDel, CacheKey } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { checkRateLimitDO, RATE_LIMITS } from "@/lib/rate-limit";
import type { D1Database } from "@cloudflare/workers-types";
import { Webhook } from "svix";

/**
 * Shared post-sync logic: invalidate caches + broadcast profile update.
 * Reads the actual avatar_url from D1 so the broadcast respects R2 overrides.
 */
async function syncCachesAndBroadcast(
  db: D1Database,
  userId: string,
  username: string,
  event: string
): Promise<void> {
  // ── Cache invalidation ──
  await Promise.all([
    cacheDel(CacheKey.userProfile(userId)),
    cacheDel(CacheKey.userServers(userId)),
  ]);

  // Invalidate member lists for all servers this user belongs to
  const { results: memberships } = await db.prepare(
    `SELECT server_id FROM server_members WHERE user_id = ?`
  ).bind(userId).all();
  if (memberships?.length) {
    await Promise.all(
      memberships.map((m: Record<string, unknown>) =>
        cacheDel(CacheKey.serverMembers(m.server_id as string))
      )
    );
  }

  // Read the actual avatar_url from D1 (may be R2 or Clerk URL)
  const userRow = await db.prepare(
    `SELECT avatar_url FROM users WHERE id = ?`
  ).bind(userId).first() as { avatar_url: string | null } | null;

  logger.info("User synced from webhook", { userId, event });

  // Broadcast profile change to all connected clients
  await broadcastToAll("USER_PROFILE_UPDATE", {
    user_id: userId,
    username,
    avatar_url: userRow?.avatar_url ?? null,
  });
}
// POST /api/auth/sync — Clerk webhook to sync user data to D1
// Called by Clerk webhook on user.created / user.updated events
const POST = async ({ request, params }: any) => {
  // ── Verify Svix webhook signature ──────────────────────────────────
  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    logger.security("webhook_missing_headers", {
      path: "/api/auth/sync",
      has_id: !!svixId,
      has_timestamp: !!svixTimestamp,
      has_signature: !!svixSignature,
    });
    return apiError("Missing webhook headers", 400);
  }

  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error("CLERK_WEBHOOK_SECRET not configured");
    return apiError("Server misconfigured", 500);
  }

  const rawBody = await request.text();

  let body: {
    type: string;
    data: {
      id: string;
      username?: string;
      first_name?: string;
      last_name?: string;
      image_url?: string;
      unsafe_metadata?: { bio?: string };
    };
  };

  try {
    const wh = new Webhook(webhookSecret);
    body = wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as typeof body;
  } catch (err) {
    logger.security("webhook_signature_invalid", {
      path: "/api/auth/sync",
      svix_id: svixId,
      error: err instanceof Error ? err.message : "Unknown",
    });
    return apiError("Invalid webhook signature", 400);
  }

  // ── Process verified webhook ─────────────────────────────────────
  if (!body.type || !body.data?.id) {
    return apiError("Invalid webhook payload", 400);
  }

  // Rate limit profile sync per user ID using the DO token bucket.
  const rl = await checkRateLimitDO(body.data.id, "auth-sync", RATE_LIMITS.AUTH_SYNC);
  if (rl) return rl;

  const db = getDB();
  const user = body.data;

  const username = user.username || `user_${user.id.slice(-6)}`;
  const displayName =
    [user.first_name, user.last_name].filter(Boolean).join(" ") || username;

  switch (body.type) {
    case "user.created": {
      // New user — always use Clerk's avatar
      await db.prepare(
        `INSERT INTO users (id, username, display_name, avatar_url, bio, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'online', ?)
         ON CONFLICT(id) DO UPDATE SET
           username = excluded.username,
           display_name = COALESCE(users.display_name, excluded.display_name),
           avatar_url = excluded.avatar_url,
           bio = excluded.bio`
      ).bind(
        user.id,
        username,
        displayName,
        user.image_url ?? null,
        user.unsafe_metadata?.bio ?? null,
        new Date().toISOString()
      ).run();

      // Cache + broadcast (shared with user.updated below)
      await syncCachesAndBroadcast(db, user.id, username, body.type);
      break;
    }
    case "user.updated": {
      // Existing user — only overwrite avatar_url if they don't have a custom R2 avatar
      // display_name is only set if currently NULL (preserve user-customized names)
      await db.prepare(
        `UPDATE users SET
           username = ?,
           display_name = CASE
             WHEN display_name IS NOT NULL AND display_name != '' THEN display_name
             ELSE ?
           END,
           avatar_url = CASE
             WHEN avatar_url LIKE '/api/avatars/%' THEN avatar_url
             ELSE ?
           END,
           bio = ?
         WHERE id = ?`
      ).bind(
        username,
        displayName,
        user.image_url ?? null,
        user.unsafe_metadata?.bio ?? null,
        user.id
      ).run();

      await syncCachesAndBroadcast(db, user.id, username, body.type);
      break;
    }

    case "user.deleted": {
      await db.prepare(
        `UPDATE users SET status = 'offline' WHERE id = ?`
      ).bind(user.id).run();

      await cacheDel(CacheKey.userProfile(user.id));
      logger.info("User deleted from webhook", { userId: user.id });
      break;
    }
  }

  return apiSuccess({ success: true });
}


export const Route = createFileRoute('/api/auth/sync')({
  server: {
    handlers: {
      POST,
    }
  }
});
