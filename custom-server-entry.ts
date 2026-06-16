/// <reference types="@cloudflare/workers-types" />
// ============================================================================
// Custom Server Entry for TanStack Start + Durable Objects + WebSockets
//
// Routes:
//   /api/gateway                    → MeetingRoom DO  (Global Main Gateway)
//   /api/channels/:channelId/ws     → MeetingRoom DO  (Channel-scoped presence)
//   /api/channels/:channelId/voice  → VoiceRoom DO    (Voice Gateway — media)
//   Everything else                 → TanStack Start handler
// ============================================================================

import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { logger } from "./src/lib/logger";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "./src/lib/api-helpers";
import { RateLimiter } from "./worker/rate-limiter";

// NOTE: DO classes (MeetingRoom, VoiceRoom, RateLimiterDO) are hosted in
// a separate auxiliary worker (worker/do-entry.ts) to prevent module-level
// I/O context conflicts between the main Worker and DOs in dev mode.
// However, we re-export them here because Cloudflare's migration system
// requires the main worker to still export any class it previously registered
// via [[migrations]], even though script_name routes all traffic to ralph-meet-do.
export { MeetingRoom } from "./worker/meeting-room";
export { RateLimiterDO } from "./worker/rate-limiter-do";
export { VoiceRoom } from "./worker/voice-room";

// Module-level rate limiter — persists across requests in the same isolate
const rateLimiter = new RateLimiter();

// Module-level TanStack Start handler — created once, reused for every request.
// Previously this was called inside fetch() on every request, re-initializing
// the entire SSR pipeline (router tree, React server components, etc.) each time.
const handler = createStartHandler(defaultStreamHandler);

function requireWebSocket(request: Request): Response | null {
  const upgradeHeader = request.headers.get("Upgrade");
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }
  return null;
}

function withDesktopCors(request: Request, response: Response): Response {
  try {
    const headers = getCorsHeaders(request);
    if (!Object.keys(headers).length) return response;

    const nextHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(headers)) {
      nextHeaders.set(key, value);
    }

    const hasNoBody = response.status === 204 || response.status === 304 || response.status < 200;
    return new Response(hasNoBody ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: nextHeaders,
    });
  } catch (e) {
    console.error("Error applying desktop CORS headers:", e);
    return response;
  }
}

interface Env {
  MEETING_ROOM: DurableObjectNamespace;
  VOICE_ROOM: DurableObjectNamespace;
  [key: string]: unknown;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // ── CORS preflight for desktop Tauri webview ──────────────────────────
    // http://tauri.localhost is a cross-origin context. OPTIONS preflights
    // must be answered before any auth or routing logic runs.
    const preflight = handleCorsPreflightIfNeeded(request);
    if (preflight) return preflight;

    // ── Rate limiting for API routes ─────────────────────────────────────
    // Skip WebSocket upgrades and static asset reads. Attachment/background GETs are
    // static file reads that Chromium's media player hits rapidly with Range
    // headers during video playback — rate limiting them causes
    // ERR_REQUEST_RANGE_NOT_SATISFIABLE retry storms.
    const isWebSocket = !!request.headers.get("Upgrade");
    const isStaticAssetRead = request.method === "GET"
      && (url.pathname.startsWith("/api/attachments/") || url.pathname.startsWith("/api/camera-backgrounds/"));
    if (url.pathname.startsWith("/api/") && !isWebSocket && !isStaticAssetRead) {
      const clientIP = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const result = rateLimiter.check(clientIP, request.method, url.pathname);

      if (!result.allowed) {
        logger.security("rate_limit_exceeded", {
          ip: clientIP,
          method: request.method,
          path: url.pathname,
          retry_after_ms: result.resetMs,
        });
        return withDesktopCors(request, new Response(
          JSON.stringify({ error: "Too many requests", retry_after_ms: result.resetMs }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(Math.ceil(result.resetMs / 1000)),
              "X-RateLimit-Remaining": "0",
            },
          }
        ));
      }
    }

    // ── Global Main Gateway WebSocket → MeetingRoom DO ────────────────
    if (url.pathname === "/api/gateway") {
      const err = requireWebSocket(request);
      if (err) return err;

      const doNamespace = env.MEETING_ROOM as DurableObjectNamespace;
      const id = doNamespace.idFromName("global-gateway");
      const stub = doNamespace.get(id);
      return stub.fetch(request);
    }

    // ── Channel-scoped Main Gateway → MeetingRoom DO ──────────────────
    const wsMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/ws$/);
    if (wsMatch) {
      const err = requireWebSocket(request);
      if (err) return err;

      const channelId = wsMatch[1];
      const doNamespace = env.MEETING_ROOM as DurableObjectNamespace;
      const id = doNamespace.idFromName(channelId);
      const stub = doNamespace.get(id);
      return stub.fetch(request);
    }

    // ── Voice Gateway WebSocket → VoiceRoom DO ────────────────────────
    const voiceMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/voice$/);
    if (voiceMatch) {
      const err = requireWebSocket(request);
      if (err) return err;

      const channelId = voiceMatch[1];
      const doNamespace = env.VOICE_ROOM as DurableObjectNamespace;
      const id = doNamespace.idFromName(channelId);
      const stub = doNamespace.get(id);
      return stub.fetch(request);
    }

    // ── Everything else → TanStack Start ──────────────────────────────
    let response: Response;
    try {
      response = await handler(request);
    } catch (err: any) {
      console.error("Error in handler:", err?.message || err);
      response = new Response(JSON.stringify({ error: err?.message || "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    return url.pathname.startsWith("/api/") ? withDesktopCors(request, response) : response;
  },
};
