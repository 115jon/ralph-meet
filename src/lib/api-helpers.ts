// ── D1/R2 helpers for API routes ────────────────────────────────────────────
// In the Cloudflare Vite plugin, bindings are accessed via the
// `cloudflare:workers` module — available everywhere inside workerd.

import { env } from "cloudflare:workers";

// ── Desktop CORS origins ─────────────────────────────────────────────────────
// The Tauri desktop app runs at http://tauri.localhost (useHttpsScheme: false)
// or https://tauri.localhost. Both must be allowed to call the deployed Worker.
const DESKTOP_ORIGINS = new Set([
  "http://tauri.localhost",
  "https://tauri.localhost",
]);

export function getCorsHeaders(req?: Request): HeadersInit {
  const origin = req?.headers.get("origin") ?? "";
  if (!DESKTOP_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Publishable-Key",
    "Access-Control-Allow-Credentials": "true",
  };
}

/** Handle OPTIONS preflight requests from the desktop Tauri webview. */
export function handleCorsPreflightIfNeeded(req: Request): Response | null {
  const origin = req.headers.get("origin") ?? "";
  if (req.method === "OPTIONS" && DESKTOP_ORIGINS.has(origin)) {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }
  return null;
}

export function getDB(): CloudflareEnv["DB"] {
  return env.DB;
}

export function getBucket(): CloudflareEnv["BUCKET"] {
  return env.BUCKET;
}

export function getKV(): CloudflareEnv["CACHE"] {
  return env.CACHE;
}

export function getEnv(): CloudflareEnv {
  return env as unknown as CloudflareEnv;
}

export async function requireAuth(req?: Request): Promise<{ userId: string } | Response> {
  const { auth, verifyToken } = await import("@/lib/kova-auth-server");
  try {
    const authState = await auth();

    if (authState.userId) {
      return { userId: authState.userId };
    }

    // Try verifying manually if auth() didn't pick it up (e.g. custom desktop JWT in header or query param)
    const { getRequestHeader } = await import(
      /* @vite-ignore */ "@tanstack/react-start" + "/server"
    );
    const authHeader =
      req?.headers.get("authorization") ?? getRequestHeader("authorization");

    let token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.substring(7) : null;

    if (!token && req?.url) {
      const url = new URL(req.url);
      token = url.searchParams.get("token");
    }

    if (token) {
      try {
        const claims = await verifyToken(token);
        if (claims?.sub) {
          return { userId: claims.sub };
        }
      } catch (e) {
        console.error("Custom desktop token validation failed:", e);
      }
    }

    return Response.json({ error: "Unauthorized" }, { status: 401, headers: getCorsHeaders(req) });
  } catch (error: any) {
    console.error("[requireAuth] Error:", error?.message || error);
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: getCorsHeaders(req) });
  }
}

/** Standardized successful API response — returns data directly */
export function apiSuccess<T>(data: T, status = 200, req?: Request): Response {
  return Response.json(data, { status, headers: getCorsHeaders(req) });
}

/** Standardized error API response */
export function apiError(message: string, status = 400, code?: string, req?: Request): Response {
  return Response.json({ error: message, code }, { status, headers: getCorsHeaders(req) });
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

  data: any
): Promise<void> {
  try {
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

  data: any
): Promise<void> {
  try {
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
 * Broadcast a dispatch event to all connected members of a server.
 * The DO routes this via in-memory server subscription maps (Op 35).
 */
export async function broadcastToServerMembers(
  serverId: string,
  event: string,
  data: any
): Promise<void> {
  try {
    const doId = env.MEETING_ROOM.idFromName("global-gateway");
    const stub = env.MEETING_ROOM.get(doId);
    await stub.fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server_id: serverId, event, data }),
    });
  } catch (e) {
    console.error("[broadcastToServerMembers] Failed to notify gateway:", e);
  }
}
/**
 * Broadcast a dispatch event to a SPECIFIC user.
 * Used for private events like friend requests, DMs, etc.
 */
export async function broadcastToUser(
  userId: string,
  event: string,

  data: any
): Promise<void> {
  try {
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
