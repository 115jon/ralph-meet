import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { apiError, apiSuccess, broadcastToAll, getDB } from "@/lib/api-helpers";
import { cacheDel, CacheKey } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { checkRateLimitDO, RATE_LIMITS } from "@/lib/rate-limit";
import type { D1Database } from "@cloudflare/workers-types";

type RalphAuthWebhook = {
  id?: string;
  event?: string;
  type?: string;
  timestamp?: string | number;
  data?: {
    id?: string;
    userId?: string;
    username?: string | null;
    name?: string | null;
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    image?: string | null;
    imageUrl?: string | null;
    avatarUrl?: string | null;
    bio?: string | null;
    actorName?: string | null;
    actorEmail?: string | null;
  };
};

async function syncCachesAndBroadcast(
  db: D1Database,
  userId: string,
  username: string,
  event: string,
): Promise<void> {
  await Promise.all([
    cacheDel(CacheKey.userProfile(userId)),
    cacheDel(CacheKey.userServers(userId)),
  ]);

  const { results: memberships } = await db.prepare(
    `SELECT server_id FROM server_members WHERE user_id = ?`,
  ).bind(userId).all();
  if (memberships?.length) {
    await Promise.all(
      memberships.map((m: Record<string, unknown>) =>
        cacheDel(CacheKey.serverMembers(m.server_id as string)),
      ),
    );
  }

  const userRow = await db.prepare(
    `SELECT avatar_url, theme_preference, theme_sync_enabled, updated_at FROM users WHERE id = ?`,
  ).bind(userId).first() as { avatar_url: string | null; theme_preference: string | null; theme_sync_enabled: number; updated_at: string | null } | null;

  logger.info("User synced from Ralph Auth webhook", { userId, event });

  await broadcastToAll("USER_PROFILE_UPDATE", {
    user_id: userId,
    username,
    avatar_url: userRow?.avatar_url ?? null,
    theme_preference: userRow?.theme_preference ?? null,
    theme_sync_enabled: userRow?.theme_sync_enabled === 1,
    updated_at: userRow?.updated_at ?? null,
  });
}

const POST = async ({ request }: any) => {
  const rawBody = await request.text();
  const signature =
    request.headers.get("x-ralph-auth-signature") ??
    request.headers.get("x-webhook-signature");

  const webhookSecret =
    (env as unknown as CloudflareEnv & { KOVA_AUTH_WEBHOOK_SECRET?: string; RALPH_AUTH_WEBHOOK_SECRET?: string }).KOVA_AUTH_WEBHOOK_SECRET ??
    (env as unknown as CloudflareEnv & { KOVA_AUTH_WEBHOOK_SECRET?: string; RALPH_AUTH_WEBHOOK_SECRET?: string }).RALPH_AUTH_WEBHOOK_SECRET;

  if (!webhookSecret) {
    logger.error("KOVA_AUTH_WEBHOOK_SECRET / RALPH_AUTH_WEBHOOK_SECRET not configured");
    return apiError("Server misconfigured", 500);
  }

  if (!signature || !(await verifyWebhookSignature(rawBody, signature, webhookSecret))) {
    logger.security("webhook_signature_invalid", {
      path: "/api/auth/sync",
      has_signature: !!signature,
    });
    return apiError("Invalid webhook signature", 400);
  }

  let body: RalphAuthWebhook;
  try {
    body = JSON.parse(rawBody) as RalphAuthWebhook;
  } catch {
    return apiError("Invalid JSON", 400);
  }

  const event = body.event ?? body.type;
  const user = body.data;
  const userId = user?.userId ?? user?.id;
  if (!event || !userId || !user) {
    return apiError("Invalid webhook payload", 400);
  }

  const rl = await checkRateLimitDO(userId, "auth-sync", RATE_LIMITS.AUTH_SYNC);
  if (rl) return rl;

  const db = getDB();
  const username = user.username ?? usernameFromEmail(user.email ?? user.actorEmail) ?? `user_${userId.slice(-6)}`;
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  const displayName =
    user.displayName ??
    user.name ??
    user.actorName ??
    (fullName || username);
  const avatarUrl = user.avatarUrl ?? user.imageUrl ?? user.image ?? null;
  const bio = user.bio ?? null;

  switch (event) {
    case "user.created":
    case "user.signUp":
    case "user.signed_up": {
      await db.prepare(
        `INSERT INTO users (id, username, display_name, avatar_url, bio, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'online', ?)
         ON CONFLICT(id) DO UPDATE SET
           username = excluded.username,
           display_name = COALESCE(users.display_name, excluded.display_name),
           avatar_url = CASE
             WHEN users.avatar_url LIKE '/api/avatars/%' THEN users.avatar_url
             ELSE excluded.avatar_url
           END,
           bio = COALESCE(users.bio, excluded.bio)`,
      ).bind(userId, username, displayName, avatarUrl, bio, new Date().toISOString()).run();

      await syncCachesAndBroadcast(db, userId, username, event);
      break;
    }
    case "user.updated":
    case "user.update": {
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
           bio = COALESCE(bio, ?)
         WHERE id = ?`,
      ).bind(username, displayName, avatarUrl, bio, userId).run();

      await syncCachesAndBroadcast(db, userId, username, event);
      break;
    }
    case "user.deleted":
    case "user.delete": {
      await db.prepare(`UPDATE users SET status = 'offline' WHERE id = ?`).bind(userId).run();
      await cacheDel(CacheKey.userProfile(userId));
      logger.info("User deleted from Ralph Auth webhook", { userId });
      break;
    }
  }

  return apiSuccess({ success: true });
};

async function verifyWebhookSignature(rawBody: string, signature: string, secret: string): Promise<boolean> {
  const expected = await hmacSha256(rawBody, secret);
  const cleaned = signature.replace(/^sha256=/, "");
  return timingSafeEqual(cleaned, expected.hex) || timingSafeEqual(cleaned, expected.base64);
}

async function hmacSha256(rawBody: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const bytes = new Uint8Array(digest);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const base64 = btoa(String.fromCharCode(...bytes));
  return { hex, base64 };
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function usernameFromEmail(email?: string | null) {
  return email?.split("@")[0] || null;
}

export const Route = createFileRoute("/api/auth/sync")({
  server: {
    handlers: {
      POST,
    },
  },
});
