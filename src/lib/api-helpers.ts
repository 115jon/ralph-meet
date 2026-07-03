// ── D1/R2 helpers for API routes ────────────────────────────────────────────
// In the Cloudflare Vite plugin, bindings are accessed via the
// `cloudflare:workers` module — available everywhere inside workerd.

import { env } from "cloudflare:workers";
import { clog } from "@/lib/console-logger";
import type {
  VoiceSessionCheckRequest,
  VoiceSessionCheckResponse,
} from "@/lib/voice/rtc-room-session";
import type { DurableObjectNamespace } from "@cloudflare/workers-types";
export { genId } from "@/lib/id";

const authLog = clog("requireAuth");
const broadcastLog = clog("broadcast");
const broadcastAllLog = clog("broadcastAll");
const broadcastServerLog = clog("broadcastToServerMembers");
const broadcastUserLog = clog("broadcastToUser");

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
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Publishable-Key, X-Voice-Session-Id",
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

export function buildVoiceChannelRoomSlug(serverId: string, channelId: string): string {
  return `voice-${serverId}-${channelId}`;
}

type VoiceSessionCheckFetchResult = {
  ok: boolean;
  status: number | null;
  data: VoiceSessionCheckResponse | null;
};

const VOICE_SESSION_CHECK_RETRY_DELAY_MS = 250;
const VOICE_SESSION_CHECK_MAX_ATTEMPTS = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchVoiceSessionCheck(
  roomSlug: string,
  payload: VoiceSessionCheckRequest,
): Promise<VoiceSessionCheckFetchResult> {
  const namespace = (env as typeof env & { RTC_ROOM: DurableObjectNamespace }).RTC_ROOM;
  const doId = namespace.idFromName(roomSlug);
  const stub = namespace.get(doId);

  for (let attempt = 0; attempt < VOICE_SESSION_CHECK_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await stub.fetch("https://internal/voice-session-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          data: await response.json() as VoiceSessionCheckResponse,
        };
      }

      if (response.status >= 500 && attempt + 1 < VOICE_SESSION_CHECK_MAX_ATTEMPTS) {
        await sleep(VOICE_SESSION_CHECK_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }

      return { ok: false, status: response.status, data: null };
    } catch (error) {
      if (attempt + 1 < VOICE_SESSION_CHECK_MAX_ATTEMPTS) {
        await sleep(VOICE_SESSION_CHECK_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      authLog.error("Voice session check fetch failed:", error);
      return { ok: false, status: null, data: null };
    }
  }

  return { ok: false, status: null, data: null };
}

export async function requireActiveVoiceChannelSession(
  request: Request,
  userId: string,
  channelId: string,
  serverId: string,
  errorMessage = "You must be actively connected to this voice channel to change its status.",
): Promise<{ sessionId: string | null; exactSessionMatched: boolean } | Response> {
  const sessionId = request.headers.get("X-Voice-Session-Id")?.trim() || null;

  if (!sessionId) {
    return apiError(
      "Reconnect to this voice channel from this client before changing its status.",
      403,
      "VOICE_STATUS_REQUIRES_LOCAL_SESSION",
      request,
    );
  }

  try {
    const roomSlug = buildVoiceChannelRoomSlug(serverId, channelId);
    const exactSessionPayload: VoiceSessionCheckRequest = {
      user_id: userId,
      session_id: sessionId,
      require_exact_session: true,
      require_channel_match: false,
    };

    const localRoomSessionCheck = await fetchVoiceSessionCheck(roomSlug, exactSessionPayload);
    if (!localRoomSessionCheck.ok || !localRoomSessionCheck.data) {
      return apiError("Could not verify your voice session right now.", 503, "VOICE_SESSION_CHECK_FAILED", request);
    }

    if (!localRoomSessionCheck.data.allowed) {
      return apiError(errorMessage, 403, "VOICE_STATUS_REQUIRES_ACTIVE_SESSION", request);
    }

    return {
      sessionId,
      exactSessionMatched: !!localRoomSessionCheck.data.exact_session_matched,
    };
  } catch (error) {
    authLog.error("Voice session verification failed:", error);
    return apiError("Could not verify your voice session right now.", 503, "VOICE_SESSION_CHECK_FAILED", request);
  }
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
    authLog.error("Error:", error?.message || error);
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
    broadcastLog.error("Failed to notify gateway:", e);
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
    broadcastAllLog.error("Failed to notify gateway:", e);
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
    broadcastServerLog.error("Failed to notify gateway:", e);
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
    broadcastUserLog.error("Failed to notify gateway:", e);
  }
}
