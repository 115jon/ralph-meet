import { apiSuccess, apiError, getDB } from "@/lib/api-helpers";
import { cacheDel, CacheKey } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { Webhook } from "svix";

// POST /api/auth/sync — Clerk webhook to sync user data to D1
// Called by Clerk webhook on user.created / user.updated events
export async function POST(request: Request) {
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

  const db = getDB();
  const user = body.data;

  const username = user.username
    || [user.first_name, user.last_name].filter(Boolean).join(" ")
    || "User";

  switch (body.type) {
    case "user.created":
    case "user.updated": {
      await db.prepare(
        `INSERT INTO users (id, username, avatar_url, bio, status, created_at)
         VALUES (?, ?, ?, ?, 'online', ?)
         ON CONFLICT(id) DO UPDATE SET
           username = excluded.username,
           avatar_url = excluded.avatar_url,
           bio = excluded.bio`
      ).bind(
        user.id,
        username,
        user.image_url ?? null,
        user.unsafe_metadata?.bio ?? null,
        new Date().toISOString()
      ).run();

      // ── Cache invalidation ──
      await Promise.all([
        cacheDel(CacheKey.userProfile(user.id)),
        cacheDel(CacheKey.userServers(user.id)),
      ]);

      // Invalidate member lists for all servers this user belongs to
      const { results: memberships } = await db.prepare(
        `SELECT server_id FROM server_members WHERE user_id = ?`
      ).bind(user.id).all();
      if (memberships?.length) {
        await Promise.all(
          memberships.map((m: Record<string, unknown>) =>
            cacheDel(CacheKey.serverMembers(m.server_id as string))
          )
        );
      }

      logger.info("User synced from webhook", { userId: user.id, event: body.type });
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
