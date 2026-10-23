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

import { DEFAULT_KOVA_AUTH_URL } from "./src/lib/site-defaults";
import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { logger } from "./src/lib/logger";
import {
  getCorsHeaders,
  handleCorsPreflightIfNeeded,
} from "./src/lib/api-helpers";
import { buildHealthzPayload } from "./src/lib/healthz";
import { handleYtDlpRequest } from "./src/lib/ytdlp/http";
import { syncYtDlpUpstream } from "./src/lib/ytdlp/upstream";
import {
  getSoundboardMediaAggregateRateLimitKey,
  getSoundboardMediaRateLimitKey,
  getSoundboardMediaRequesterRateLimitKey,
  isSoundboardMediaRead,
  isStaticAssetRead,
} from "./src/lib/api-rate-limit";
import {
  parseSocketTicketProtocols,
  verifySocketTicket,
  type SocketTicketAudience,
} from "./src/lib/voice/socket-ticket";
import { RateLimiter } from "./realtime/rate-limiter";
import {
  consumeBackgroundTaskBatch,
  retryMessagePostprocessing,
  type BackgroundTaskEnvelope,
} from "./src/lib/background-tasks";
import { retryR2Cleanup } from "./src/services/r2-cleanup.service";
import {
  COLLECTIBLES_SYNC_CRON,
  CatalogFetchDeferredError,
  syncCollectiblesCatalog,
} from "./src/lib/collectibles-catalog";
import {
  runScheduledJobs,
  selectScheduledJobs,
} from "./src/lib/scheduled-jobs";

/** wrangler.toml [triggers]: maintenance jobs run every 6h. */
const MAINTENANCE_CRON = "0 */6 * * *";
import {
  appendRealtimeAdmissionHeaders,
  createRealtimeAdmissionContext,
  getRealtimeAdmissionConfig,
  stripRealtimeAdmissionHeaders,
} from "./realtime/realtime-admission";
import { handlePartyTracksProxyRequest } from "./realtime/partytracks-proxy";

// DO classes are exported from the root Worker so its bindings and migration
// history own the Durable Object namespaces.
export {
  MeetingRoom,
  MeetingRoom as RootMeetingRoom,
} from "./realtime/meeting-room";
export {
  RateLimiterDO,
  RateLimiterDO as RootRateLimiterDO,
} from "./realtime/rate-limiter-do";
export { VoiceRoom, VoiceRoom as RootVoiceRoom } from "./realtime/voice-room";

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

type VerifiedWebSocketRequest = {
  request: Request;
};

function unauthorizedWebSocket(reason: string) {
  return new Response(reason, { status: 401 });
}

function withDesktopCors(request: Request, response: Response): Response {
  try {
    const headers = getCorsHeaders(request);
    if (!Object.keys(headers).length) return response;

    const nextHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(headers)) {
      nextHeaders.set(key, value);
    }

    const hasNoBody =
      response.status === 204 ||
      response.status === 304 ||
      response.status < 200;
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

function buildDocumentContentSecurityPolicy(authOrigin: string): string {
  return (
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data: blob:; media-src 'self' https: blob:; connect-src 'self' https: wss: ws: " +
    authOrigin +
    " https://api.github.com https://cloudflareinsights.com; worker-src 'self' blob:; frame-src 'self' https:"
  );
}

function resolveAuthOrigin(env: Env): string {
  try {
    return new URL(env.KOVA_AUTH_URL || DEFAULT_KOVA_AUTH_URL).origin;
  } catch {
    return DEFAULT_KOVA_AUTH_URL;
  }
}

const DOCUMENT_SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self "https://www.youtube.com" "https://www.youtube-nocookie.com" "https://www.tiktok.com" "https://open.spotify.com"), geolocation=()',
} as const;

function withDocumentSecurityHeaders(
  request: Request,
  response: Response,
  env: Env,
): Response {
  const contentType = response.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (
    contentType !== "text/html" ||
    response.body === null ||
    response.status === 204 ||
    response.status === 304 ||
    response.status < 200
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(DOCUMENT_SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  headers.set(
    "Content-Security-Policy",
    buildDocumentContentSecurityPolicy(resolveAuthOrigin(env)),
  );
  if (new URL(request.url).protocol === "https:") {
    headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

interface Env {
  CALLS_APP_ID: string;
  CALLS_APP_SECRET: string;
  CALLS_API_URL?: string;
  TURN_TOKEN_ID?: string;
  TURN_TOKEN_SECRET?: string;
  MEETING_ROOM: DurableObjectNamespace;
  VOICE_ROOM: DurableObjectNamespace;
  DB: D1Database;
  BUCKET: R2Bucket;
  CACHE: KVNamespace;
  BACKGROUND_TASKS?: Queue<BackgroundTaskEnvelope>;
  REALTIME_ALLOWED_ORIGINS?: string;
  KOVA_AUTH_URL?: string;
  REALTIME_TICKET_SECRET?: string;
  [key: string]: unknown;
}

function isAllowedRealtimeOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;

  const allowedOrigins = new Set([
    new URL(request.url).origin,
    "http://tauri.localhost",
    "https://tauri.localhost",
    ...(env.REALTIME_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ]);
  return allowedOrigins.has(origin);
}

async function requireAuthenticatedWebSocket(
  request: Request,
  env: Env,
  audience: SocketTicketAudience,
  roomSlug: string,
): Promise<VerifiedWebSocketRequest | Response> {
  const upgradeError = requireWebSocket(request);
  if (upgradeError) return upgradeError;
  if (!isAllowedRealtimeOrigin(request, env)) {
    logger.warn("Realtime WebSocket origin rejected", {
      audience,
      roomSlug,
      origin: request.headers.get("Origin"),
    });
    return new Response("Realtime origin is not allowed", { status: 403 });
  }

  const config = getRealtimeAdmissionConfig(env);
  if (!config.ok) {
    logger.error("Realtime WebSocket configuration is incomplete", {
      audience,
      roomSlug,
      reason: config.reason,
    });
    return unauthorizedWebSocket("Realtime admission is not configured");
  }

  const protocol = parseSocketTicketProtocols(
    request.headers.get("Sec-WebSocket-Protocol"),
  );
  if (!protocol.ok) {
    logger.warn("Realtime WebSocket protocol rejected", {
      audience,
      roomSlug,
      reason: protocol.reason,
      hasProtocolHeader: !!request.headers.get("Sec-WebSocket-Protocol"),
    });
    return unauthorizedWebSocket("Missing realtime capability");
  }

  const verification = await verifySocketTicket(
    protocol.value.ticket,
    config.config.ticketSecret,
    {
      audience,
      now: Date.now(),
      roomSlug,
    },
  );
  if (!verification.ok) {
    logger.warn("Realtime WebSocket ticket rejected", {
      audience,
      roomSlug,
      reason: verification.reason,
    });
    return unauthorizedWebSocket("Invalid realtime capability");
  }

  const context = await createRealtimeAdmissionContext(verification.claims);
  const headers = appendRealtimeAdmissionHeaders(
    stripRealtimeAdmissionHeaders(new Headers(request.headers)),
    context,
  );
  headers.delete("Sec-WebSocket-Protocol");
  headers.set("Sec-WebSocket-Protocol", protocol.value.responseProtocol);

  const consumeNamespace = env.MEETING_ROOM as DurableObjectNamespace;
  const consumeStub = consumeNamespace.get(
    consumeNamespace.idFromName(roomSlug),
  );
  const consumeHeaders = appendRealtimeAdmissionHeaders(new Headers(), context);
  const consumeResponse = await consumeStub.fetch(
    "https://internal/consume-realtime-admission",
    {
      method: "POST",
      // Do not copy browser upgrade headers onto this ordinary internal POST.
      headers: consumeHeaders,
    },
  );
  if (!consumeResponse.ok) {
    const consumeBody = (await consumeResponse.text()).slice(0, 200);
    logger.warn("Realtime WebSocket admission consumption rejected", {
      audience,
      roomSlug,
      status: consumeResponse.status,
      body: consumeBody,
    });
    return unauthorizedWebSocket("Realtime capability already used");
  }

  return {
    request: new Request(request, { headers }),
  };
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // ── CORS preflight for desktop Tauri webview ──────────────────────────
    // http://tauri.localhost is a cross-origin context. OPTIONS preflights
    // must be answered before any auth or routing logic runs.
    const preflight = handleCorsPreflightIfNeeded(request);
    if (preflight) return preflight;

    if (url.pathname === "/api/healthz" && request.method === "GET") {
      return withDesktopCors(request, Response.json(buildHealthzPayload()));
    }

    // ── Rate limiting for API routes ─────────────────────────────────────
    // Skip WebSocket upgrades and attachment/background static asset reads.
    // Soundboard media has an aggregate requester/route bucket first, followed
    // by per-sound and per-capability buckets for legitimate range bursts.
    const isWebSocket = !!request.headers.get("Upgrade");
    if (
      url.pathname.startsWith("/api/") &&
      !isWebSocket &&
      !isStaticAssetRead(request.method, url.pathname)
    ) {
      const clientIP = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const isSoundboardMedia = isSoundboardMediaRead(
        request.method,
        url.pathname,
      );
      let result = isSoundboardMedia
        ? rateLimiter.check(
            clientIP,
            request.method,
            url.pathname,
            getSoundboardMediaAggregateRateLimitKey(request, clientIP),
          )
        : rateLimiter.check(clientIP, request.method, url.pathname);
      if (isSoundboardMedia && result.allowed) {
        result = rateLimiter.check(
          clientIP,
          request.method,
          url.pathname,
          getSoundboardMediaRequesterRateLimitKey(request, clientIP),
        );
      }
      if (isSoundboardMedia && result.allowed) {
        result = rateLimiter.check(
          clientIP,
          request.method,
          url.pathname,
          getSoundboardMediaRateLimitKey(request, clientIP),
        );
      }

      if (!result.allowed) {
        logger.security("rate_limit_exceeded", {
          ip: clientIP,
          method: request.method,
          path: url.pathname,
          retry_after_ms: result.resetMs,
        });
        return withDesktopCors(
          request,
          new Response(
            JSON.stringify({
              error: "Too many requests",
              retry_after_ms: result.resetMs,
            }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": String(Math.ceil(result.resetMs / 1000)),
                "X-RateLimit-Remaining": "0",
              },
            },
          ),
        );
      }
    }

    if (/^\/api\/channels\/[^/]+\/partytracks(?:\/|$)/u.test(url.pathname)) {
      const response = await handlePartyTracksProxyRequest(request, env);
      if (response) return withDesktopCors(request, response);
    }

    const ytdlpResponse = await handleYtDlpRequest(request, _ctx);
    if (ytdlpResponse) {
      return withDesktopCors(request, ytdlpResponse);
    }

    // ── Global Main Gateway WebSocket → MeetingRoom DO ────────────────
    if (url.pathname === "/api/gateway") {
      const verified = await requireAuthenticatedWebSocket(
        request,
        env,
        "global",
        "global-gateway",
      );
      if (verified instanceof Response) return verified;

      const doNamespace = env.MEETING_ROOM as DurableObjectNamespace;
      const id = doNamespace.idFromName("global-gateway");
      const stub = doNamespace.get(id);
      return stub.fetch(verified.request);
    }

    // ── Channel-scoped Main Gateway → MeetingRoom DO ──────────────────
    const wsMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/ws$/);
    if (wsMatch) {
      const channelId = wsMatch[1];
      const verified = await requireAuthenticatedWebSocket(
        request,
        env,
        "room",
        channelId,
      );
      if (verified instanceof Response) return verified;

      const doNamespace = env.MEETING_ROOM as DurableObjectNamespace;
      const id = doNamespace.idFromName(channelId);
      const stub = doNamespace.get(id);
      return stub.fetch(verified.request);
    }

    // ── Voice Gateway WebSocket → VoiceRoom DO ────────────────────────
    const voiceMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/voice$/);
    if (voiceMatch) {
      const channelId = voiceMatch[1];
      const verified = await requireAuthenticatedWebSocket(
        request,
        env,
        "voice",
        channelId,
      );
      if (verified instanceof Response) return verified;

      const doNamespace = env.VOICE_ROOM as DurableObjectNamespace;
      const id = doNamespace.idFromName(channelId);
      const stub = doNamespace.get(id);
      return stub.fetch(verified.request);
    }

    // ── Everything else → TanStack Start ──────────────────────────────
    let response: Response;
    try {
      response = await handler(request);
    } catch (err: any) {
      console.error("Error in handler:", err?.message || err);
      response = new Response(
        JSON.stringify({ error: "Internal Server Error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url.pathname.startsWith("/api/")) {
      return withDesktopCors(request, response);
    }
    return withDocumentSecurityHeaders(request, response, env);
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const jobs = selectScheduledJobs(controller.cron, {
      maintenance: {
        crons: [MAINTENANCE_CRON],
        jobs: [
          {
            name: "yt-dlp upstream sync",
            run: () => syncYtDlpUpstream(true),
          },
          {
            name: "R2 cleanup retry",
            run: () => retryR2Cleanup(env.DB, env.BUCKET),
          },
          {
            name: "Message postprocessing retry",
            run: () => retryMessagePostprocessing(env),
          },
        ],
      },
      collectibles: {
        crons: [COLLECTIBLES_SYNC_CRON],
        jobs: [
          {
            name: "Collectibles catalog sync",
            run: async () => {
              // Upstream blocks Workers egress; an off-Cloudflare fetcher
              // pushes to /api/collectibles/ingest. While it keeps up, a
              // failed fetch here was already logged as a warning.
              const catalog = await syncCollectiblesCatalog(env.DB, {
                trigger: "cron",
              }).catch((error: unknown) => {
                if (error instanceof CatalogFetchDeferredError) return null;
                throw error;
              });
              if (!catalog) return;
              console.info("Collectibles catalog sync completed", {
                categories: catalog.categories.length,
                items: catalog.items.length,
                outcome: catalog.sync?.lastOutcome,
                syncedAt: catalog.syncedAt,
              });
            },
          },
        ],
      },
    });
    await runScheduledJobs(jobs, (promise) => ctx.waitUntil(promise));
  },

  async queue(
    batch: MessageBatch<unknown>,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    await consumeBackgroundTaskBatch(batch, {
      DB: env.DB,
      BUCKET: env.BUCKET,
      CACHE: env.CACHE,
      MEETING_ROOM: env.MEETING_ROOM,
    });
  },
};
