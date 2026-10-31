// ── D1/R2 helpers for API routes ────────────────────────────────────────────
// In the Cloudflare Vite plugin, bindings are accessed via the
// `cloudflare:workers` module — available everywhere inside workerd.

import { env } from "cloudflare:workers";
import { clog } from "@/lib/console-logger";
export { genId } from "@/lib/id";

const authLog = clog("requireAuth");
const voiceSessionLog = clog("voice-session");

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
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, X-Publishable-Key, X-Voice-Session-Id, X-Gateway-Session-Id",
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

export function buildVoiceChannelRoomSlug(
  serverId: string,
  channelId: string,
): string {
  return `voice-${serverId}-${channelId}`;
}

type VoiceSessionCheckResponse = {
  allowed?: boolean;
  connected?: boolean;
  exact_session_matched?: boolean;
};

function getRequestLogContext(request?: Request) {
  if (!request) {
    return {
      method: null,
      path: null,
      origin: null,
      country: null,
      regionCode: null,
      colo: null,
      hasVoiceSessionHeader: false,
      hasGatewaySessionHeader: false,
    };
  }

  let path = request.url;
  try {
    path = new URL(request.url).pathname;
  } catch {
    // Fall back to the raw request URL if parsing somehow fails.
  }

  const cf = (
    request as Request & {
      cf?: {
        country?: string;
        regionCode?: string;
        colo?: string;
      };
    }
  ).cf;

  return {
    method: request.method,
    path,
    origin: request.headers.get("origin") ?? null,
    country: cf?.country ?? null,
    regionCode: cf?.regionCode ?? null,
    colo: cf?.colo ?? null,
    hasVoiceSessionHeader: !!request.headers.get("X-Voice-Session-Id"),
    hasGatewaySessionHeader: !!request.headers.get("X-Gateway-Session-Id"),
  };
}

async function fetchVoiceSessionCheck(
  roomSlug: string,
  payload: {
    user_id: string;
    channel_id?: string;
    session_id?: string | null;
    require_exact_session?: boolean;
    require_channel_match?: boolean;
  },
): Promise<VoiceSessionCheckResponse | null> {
  const doId = env.MEETING_ROOM.idFromName(roomSlug);
  const stub = env.MEETING_ROOM.get(doId);
  const response = await stub.fetch("https://internal/voice-session-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as VoiceSessionCheckResponse;
}

function getVoiceSessionIdFromRequest(request: Request): string | null {
  const headerSessionId = request.headers.get("X-Voice-Session-Id")?.trim();
  if (headerSessionId) return headerSessionId;

  try {
    const url = new URL(request.url);
    const querySessionId = url.searchParams.get("sessionId")?.trim();
    return querySessionId || null;
  } catch {
    return null;
  }
}

export async function requireActiveVoiceRoomSession(
  request: Request,
  userId: string,
  roomSlug: string,
  options?: {
    serverId?: string | null;
    channelId?: string | null;
    errorMessage?: string;
  },
): Promise<
  { sessionId: string | null; exactSessionMatched: boolean } | Response
> {
  const sessionId = getVoiceSessionIdFromRequest(request);
  const errorMessage =
    options?.errorMessage ??
    "You must be actively connected to this voice room to use this feature.";
  const requestContext = getRequestLogContext(request);
  const channelId = options?.channelId?.trim() || null;
  const serverId = options?.serverId?.trim() || null;

  if (!sessionId) {
    voiceSessionLog.warn(
      "Rejecting voice-room request without a local session id",
      {
        ...requestContext,
        userId,
        roomSlug,
        serverId,
        channelId,
      },
    );
    return apiError(
      "Reconnect to this voice room from this client before using this feature.",
      403,
      "VOICE_STATUS_REQUIRES_LOCAL_SESSION",
      request,
    );
  }

  try {
    if (channelId && serverId) {
      const globalSessionData = await fetchVoiceSessionCheck("global-gateway", {
        user_id: userId,
        channel_id: channelId,
        require_exact_session: false,
        require_channel_match: true,
      });

      if (!globalSessionData) {
        voiceSessionLog.warn(
          "Voice session lookup failed for the global gateway",
          {
            ...requestContext,
            userId,
            roomSlug,
            serverId,
            channelId,
            sessionId,
          },
        );
        return apiError(
          "Could not verify your voice session right now.",
          503,
          "VOICE_SESSION_CHECK_FAILED",
          request,
        );
      }

      if (!globalSessionData.allowed) {
        voiceSessionLog.warn("Voice session rejected by the global gateway", {
          ...requestContext,
          userId,
          roomSlug,
          serverId,
          channelId,
          sessionId,
          connected: globalSessionData.connected ?? null,
        });
        return apiError(
          errorMessage,
          403,
          "VOICE_STATUS_REQUIRES_ACTIVE_SESSION",
          request,
        );
      }
    }

    const localRoomSessionData = await fetchVoiceSessionCheck(roomSlug, {
      user_id: userId,
      session_id: sessionId,
      require_exact_session: true,
      require_channel_match: false,
    });

    if (!localRoomSessionData) {
      voiceSessionLog.warn("Voice session lookup failed for the room", {
        ...requestContext,
        userId,
        roomSlug,
        serverId,
        channelId,
        sessionId,
      });
      return apiError(
        "Could not verify your voice session right now.",
        503,
        "VOICE_SESSION_CHECK_FAILED",
        request,
      );
    }

    if (!localRoomSessionData.allowed) {
      voiceSessionLog.warn("Voice session rejected by the room check", {
        ...requestContext,
        userId,
        roomSlug,
        serverId,
        channelId,
        sessionId,
        connected: localRoomSessionData.connected ?? null,
        exactSessionMatched: !!localRoomSessionData.exact_session_matched,
      });
      return apiError(
        errorMessage,
        403,
        "VOICE_STATUS_REQUIRES_ACTIVE_SESSION",
        request,
      );
    }

    if (!localRoomSessionData.exact_session_matched) {
      voiceSessionLog.warn(
        "Voice session was allowed without an exact room-session match",
        {
          ...requestContext,
          userId,
          roomSlug,
          serverId,
          channelId,
          sessionId,
          connected: localRoomSessionData.connected ?? null,
        },
      );
    }

    return {
      sessionId,
      exactSessionMatched: !!localRoomSessionData.exact_session_matched,
    };
  } catch (error) {
    voiceSessionLog.error("Voice session verification failed", {
      ...requestContext,
      userId,
      roomSlug,
      serverId,
      channelId,
      sessionId,
      error,
    });
    return apiError(
      "Could not verify your voice session right now.",
      503,
      "VOICE_SESSION_CHECK_FAILED",
      request,
    );
  }
}

export async function requireActiveVoiceChannelSession(
  request: Request,
  userId: string,
  channelId: string,
  serverId: string,
  errorMessage = "You must be actively connected to this voice channel to change its status.",
): Promise<
  { sessionId: string | null; exactSessionMatched: boolean } | Response
> {
  return requireActiveVoiceRoomSession(
    request,
    userId,
    buildVoiceChannelRoomSlug(serverId, channelId),
    {
      channelId,
      serverId,
      errorMessage,
    },
  );
}

/**
 * Who is calling, or the response to send instead: 401 when Kova says there
 * is no session, 503 (AUTH_UNAVAILABLE) when Kova could not answer. Clients
 * retry a 503 with their normal backoff; only a 401 means "sign in again".
 *
 * Routes on the Effect edge (`@/server/edge`) get the same answers from
 * `runRoute`; this is the same typed lookup for the routes not moved yet.
 */
export async function requireAuth(
  req?: Request,
): Promise<{ userId: string } | Response> {
  const { checkCredentials, requestCredentials } =
    await import("@/lib/kova-auth-server");
  const requestContext = getRequestLogContext(req);
  try {
    const credentials = requestCredentials(req);
    const check = await checkCredentials(credentials);

    if (check.status === "signed-in") {
      return { userId: check.user.id };
    }

    const credentialContext = {
      hasAuthorizationHeader: !!credentials.authorization,
      hasBearerToken: !!credentials.authorization?.startsWith("Bearer "),
      hasQueryToken: !!credentials.queryToken,
    };

    if (check.status === "unavailable") {
      authLog.warn("Session check unavailable", {
        ...requestContext,
        ...credentialContext,
        reason: check.reason,
      });
      return authUnavailableResponse(req);
    }

    authLog.warn("Unauthorized request", {
      ...requestContext,
      ...credentialContext,
    });
    return unauthorizedResponse(req);
  } catch (error: unknown) {
    // The check itself broke: that says nothing about the session.
    authLog.error("Authorization check failed", {
      ...requestContext,
      error,
    });
    return authUnavailableResponse(req);
  }
}

/** Seconds a client should wait before retrying a 503 AUTH_UNAVAILABLE. */
const AUTH_RETRY_AFTER_SECONDS = 5;

/** The 401 for a request with no session. Clients read it as "sign in again". */
export function unauthorizedResponse(req?: Request): Response {
  return Response.json(
    { error: "Unauthorized" },
    { status: 401, headers: getCorsHeaders(req) },
  );
}

/** The 503 for "Kova could not answer". Clients retry it; it is not a sign-out. */
export function authUnavailableResponse(req?: Request): Response {
  const response = apiError(
    "Couldn't check your session right now. Try again shortly.",
    503,
    "AUTH_UNAVAILABLE",
    req,
  );
  response.headers.set("Retry-After", String(AUTH_RETRY_AFTER_SECONDS));
  return response;
}

/** Standardized successful API response — returns data directly */
export function apiSuccess<T>(data: T, status = 200, req?: Request): Response {
  return Response.json(data, { status, headers: getCorsHeaders(req) });
}

/** Standardized error API response */
export function apiError(
  message: string,
  status = 400,
  code?: string,
  req?: Request,
): Response {
  return Response.json(
    { error: message, code },
    { status, headers: getCorsHeaders(req) },
  );
}

/** Who a broadcast is for, as the global gateway's `/broadcast` reads it. */
type BroadcastTarget =
  | { channel_id: string }
  | { server_id: string }
  | { member_user_id: string }
  | { target_user_id: string };

/**
 * Send one dispatch to the global gateway Durable Object. Delivery is best
 * effort: a failure is not raised to the route. It is logged as one flat
 * object (target and event, never the payload) so dropped fan-out shows up.
 */
async function sendToGateway(
  target: BroadcastTarget,
  event: string,
  data: unknown,
): Promise<void> {
  try {
    const doId = env.MEETING_ROOM.idFromName("global-gateway");
    const stub = env.MEETING_ROOM.get(doId);
    const response = await stub.fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...target, event, data }),
    });
    if (!response.ok) {
      logDroppedBroadcast(target, event, { status: response.status });
    }
  } catch (error) {
    logDroppedBroadcast(target, event, {
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}

function logDroppedBroadcast(
  target: BroadcastTarget,
  event: string,
  failure: { status: number } | { error: string },
): void {
  console.error({
    level: "ERROR",
    message: "gateway.broadcast_dropped",
    timestamp: new Date().toISOString(),
    event,
    ...target,
    ...failure,
  });
}

/**
 * Broadcast a dispatch event to all WS clients subscribed to a channel.
 * Sends an internal HTTP request to the global gateway MeetingRoom DO.
 */
export async function broadcastToChannel(
  channelId: string,
  event: string,

  data: any,
): Promise<void> {
  await sendToGateway({ channel_id: channelId }, event, data);
}

/**
 * Broadcast a dispatch event to all connected members of a server.
 * The DO routes this via in-memory server subscription maps (Op 35).
 */
export async function broadcastToServerMembers(
  serverId: string,
  event: string,
  data: any,
): Promise<void> {
  await sendToGateway({ server_id: serverId }, event, data);
}

/** Broadcast a user profile event only to members of servers containing the user. */
export async function broadcastToUserServers(
  userId: string,
  event: string,
  data: unknown,
): Promise<void> {
  await sendToGateway({ member_user_id: userId }, event, data);
}

/**
 * Broadcast a dispatch event to a SPECIFIC user.
 * Used for private events like friend requests, DMs, etc.
 */
export async function broadcastToUser(
  userId: string,
  event: string,

  data: any,
): Promise<void> {
  await sendToGateway({ target_user_id: userId }, event, data);
}
