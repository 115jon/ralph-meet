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
import { RateLimiter } from "./worker/rate-limiter";

// Re-export DO classes so wrangler can find them
export { MeetingRoom } from "./worker/meeting-room";
export { RateLimiterDO } from "./worker/rate-limiter-do";
export { VoiceRoom } from "./worker/voice-room";

// Module-level rate limiter — persists across requests in the same isolate
const rateLimiter = new RateLimiter();

// Create the TanStack Start fetch handler
const tanstackFetch = createStartHandler(defaultStreamHandler);

function requireWebSocket(request: Request): Response | null {
  const upgradeHeader = request.headers.get("Upgrade");
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }
  return null;
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
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // ── Rate limiting for API routes (skip WebSocket upgrades) ──────────
    if (url.pathname.startsWith("/api/") && !request.headers.get("Upgrade")) {
      const clientIP = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const result = rateLimiter.check(clientIP, request.method, url.pathname);

      if (!result.allowed) {
        logger.security("rate_limit_exceeded", {
          ip: clientIP,
          method: request.method,
          path: url.pathname,
          retry_after_ms: result.resetMs,
        });
        return new Response(
          JSON.stringify({ error: "Too many requests", retry_after_ms: result.resetMs }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(Math.ceil(result.resetMs / 1000)),
              "X-RateLimit-Remaining": "0",
            },
          }
        );
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
    return tanstackFetch(request);
  },
};
