/// <reference types="@cloudflare/workers-types" />
// ============================================================================
// Custom Worker Entrypoint for Next.js + Durable Objects + WebSockets
//
// Routes:
//   /api/gateway                    → MeetingRoom DO  (Global Main Gateway)
//   /api/channels/:channelId/ws     → MeetingRoom DO  (Channel-scoped presence)
//   /api/channels/:channelId/voice  → VoiceRoom DO    (Voice Gateway — media)
//   Everything else                 → Next.js handler
// ============================================================================

// @ts-ignore — generated at build time by opennext
import nextHandler from "./.open-next/worker.js";
import { logger } from "./src/lib/logger";
import { RateLimiter } from "./worker/rate-limiter";

// Re-export DO classes so wrangler can find them
export { MeetingRoom } from "./worker/meeting-room";
export { VoiceRoom } from "./worker/voice-room";

// Module-level rate limiter — persists across requests in the same isolate
const rateLimiter = new RateLimiter();

function requireWebSocket(request: Request): Response | null {
  const upgradeHeader = request.headers.get("Upgrade");
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }
  return null;
}

export default {
  async fetch(
    request: Request,
    env: Record<string, unknown>,
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

    // ── Everything else → Next.js ──────────────────────────────────────
    // During development, if NEXT_DEV_PROXY_URL is set, we proxy to the standard
    // next dev server to get HMR and fast refreshes without full builds.
    if (env.NEXT_DEV_PROXY_URL) {
      const proxyUrl = new URL(request.url);
      const target = new URL(env.NEXT_DEV_PROXY_URL as string);
      proxyUrl.protocol = target.protocol;
      proxyUrl.hostname = target.hostname;
      proxyUrl.port = target.port;

      const newRequest = new Request(proxyUrl.toString(), request);
      return fetch(newRequest);
    }

    return nextHandler.fetch(request, env, ctx);
  },
} satisfies ExportedHandler;

