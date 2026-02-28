// ── D1/R2 helpers for API routes ────────────────────────────────────────────
// In the OpenNext/Cloudflare adapter, bindings are accessed via
// getCloudflareContext().env — NOT process.env.

import { auth } from "@clerk/nextjs/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";

export function getDB(): CloudflareEnv["DB"] {
  const { env } = getCloudflareContext();
  return env.DB;
}

export function getBucket(): CloudflareEnv["BUCKET"] {
  const { env } = getCloudflareContext();
  return env.BUCKET;
}

export function getKV(): CloudflareEnv["CACHE"] {
  const { env } = getCloudflareContext();
  return env.CACHE;
}

/** Require Clerk auth and return the user ID, or a 401 response */
export async function requireAuth(): Promise<{ userId: string } | NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return { userId };
}

/** Standardized successful API response — returns data directly */
export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/** Standardized error API response */
export function apiError(message: string, status = 400, code?: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

/** Generate a random ID */
export function genId(): string {
  return crypto.randomUUID();
}

/**
 * Broadcast a dispatch event to all WS clients subscribed to a channel.
 * Sends an internal HTTP request to the global gateway MeetingRoom DO.
 */
export async function broadcastToChannel(
  channelId: string,
  event: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
): Promise<void> {
  try {
    const { env } = getCloudflareContext();
    const doId = env.MEETING_ROOM.idFromName("global-gateway");
    const stub = env.MEETING_ROOM.get(doId);
    await stub.fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel_id: channelId, event, data }),
    });
  } catch (e) {
    console.error("[broadcast] Failed to notify gateway:", e);
  }
}

/**
 * Broadcast a dispatch event to ALL connected WS clients.
 * Used for server-wide events (member add/remove, server update, presence).
 */
export async function broadcastToAll(
  event: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
): Promise<void> {
  try {
    const { env } = getCloudflareContext();
    const doId = env.MEETING_ROOM.idFromName("global-gateway");
    const stub = env.MEETING_ROOM.get(doId);
    await stub.fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ broadcast_all: true, event, data }),
    });
  } catch (e) {
    console.error("[broadcastAll] Failed to notify gateway:", e);
  }
}
/**
 * Broadcast a dispatch event to a SPECIFIC user.
 * Used for private events like friend requests, DMs, etc.
 */
export async function broadcastToUser(
  userId: string,
  event: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
): Promise<void> {
  try {
    const { env } = getCloudflareContext();
    const doId = env.MEETING_ROOM.idFromName("global-gateway");
    const stub = env.MEETING_ROOM.get(doId);
    await stub.fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_user_id: userId, event, data }),
    });
  } catch (e) {
    console.error("[broadcastToUser] Failed to notify gateway:", e);
  }
}
