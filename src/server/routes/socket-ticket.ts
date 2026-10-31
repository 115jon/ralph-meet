// /api/voice/socket-ticket on the Effect edge. The route file only wires
// these handlers.

import { Effect, Schema, type Layer } from "effect";

import {
  apiError,
  buildVoiceChannelRoomSlug,
  getCorsHeaders,
  handleCorsPreflightIfNeeded,
} from "@/lib/api-helpers";
import { resolveChannelAccess } from "@/lib/channel-access";
import { getUserChannelPermissionsForDb } from "@/lib/require-permission";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { looseStruct } from "@/lib/schema";
import { getOrCreateDemoSession } from "@/lib/voice/demo-session";
import { isPublicDemoRoomSlug } from "@/lib/voice/realtime-policy";
import { validateBody } from "@/lib/validate-body";
import {
  issueSocketTicket,
  type SocketTicketAudience,
} from "@/lib/voice/socket-ticket";
import {
  Database,
  RateLimiter,
  WorkerEnv,
  type WorkerBindings,
} from "@/server/bindings";
import { runRoute, type RouteServices } from "@/server/edge";
import type { AuthUnavailable, Unauthenticated } from "@/server/errors";
import { signedInUserId, type KovaAuth } from "@/server/kova-auth";
import { generateTurnCredentials } from "../../../realtime/meeting-room/turn-credentials";
import { issueVoiceToken } from "../../../realtime/voice-token";

const SOCKET_TICKET_TTL_MS = 60_000;
const DEMO_TICKET_RATE_LIMIT = { limit: 12, windowMs: 60 * 60 * 1000 };
const DEMO_SESSION_TICKET_RATE_LIMIT = { limit: 30, windowMs: 60 * 60 * 1000 };

const OPTIONS = async ({ request }: { request: Request }) =>
  handleCorsPreflightIfNeeded(request) ??
  new Response(null, { status: 204, headers: getCorsHeaders(request) });

export const socketTicketRequestBodySchema = looseStruct({
  audience: Schema.optional(Schema.Unknown),
  channelId: Schema.optional(Schema.Unknown),
  roomSlug: Schema.optional(Schema.Unknown),
  serverId: Schema.optional(Schema.Unknown),
});

type SocketTicketRequestBody = typeof socketTicketRequestBodySchema.Type;

type SocketTicketEnv = WorkerBindings;

type TicketAdmission = {
  accessMode: "authenticated" | "public-demo";
  cookie?: string;
  roomSlug: string;
  serverId?: string;
  subject: string;
};

/** POST /api/voice/socket-ticket — a short-lived, audience-bound socket ticket. */
const issueTicket = Effect.fn("voice.socket_ticket")(function* (
  request: Request,
) {
  const timing = createServerTiming();
  const env = yield* WorkerEnv;
  const config = getSocketTicketConfig(env);
  if (!config.ok) {
    return apiError(
      "Realtime admission is not configured",
      503,
      config.code,
      request,
    );
  }

  const body = yield* Effect.promise(() =>
    validateBody(request, socketTicketRequestBodySchema, request),
  );
  if (body instanceof Response) return body;

  const audience = parseAudience(body.audience);
  if (!audience) {
    return apiError(
      "Invalid socket audience",
      400,
      "INVALID_AUDIENCE",
      request,
    );
  }

  const hasChannelId =
    typeof body.channelId === "string" && body.channelId.trim().length > 0;
  const admitting: Effect.Effect<
    TicketAdmission | Response,
    Unauthenticated | AuthUnavailable,
    KovaAuth | Database | RateLimiter
  > =
    audience !== "global" && !hasChannelId
      ? authorizePublicDemoTicket(request, config.ticketSecret, body, audience)
      : authorizeAuthenticatedTicket(request, body, audience);
  const admission = yield* timing.measure("admission", admitting);
  if (admission instanceof Response) return admission;

  const expiresAt = Date.now() + SOCKET_TICKET_TTL_MS;
  const nonce = crypto.randomUUID();
  if (audience === "room" && !env.CALLS_APP_SECRET) {
    return apiError(
      "Realtime media admission is not configured",
      503,
      "CALLS_APP_SECRET_MISSING",
      request,
    );
  }
  const ticket = yield* Effect.promise(() =>
    issueSocketTicket(
      {
        accessMode: admission.accessMode,
        audience,
        expiresAt,
        nonce,
        roomSlug: admission.roomSlug,
        ...(admission.serverId ? { serverId: admission.serverId } : {}),
        subject: admission.subject,
      },
      config.ticketSecret,
    ),
  );

  const mediaBootstrap =
    audience === "room" && env.CALLS_APP_SECRET
      ? yield* timing.measure(
          "media",
          Effect.promise(() =>
            createRoomMediaBootstrap({
              env,
              nonce,
              roomSlug: admission.roomSlug,
              subject: admission.subject,
            }),
          ),
        )
      : undefined;

  const response = Response.json({
    access_mode: admission.accessMode,
    audience,
    expires_at: expiresAt,
    ...(mediaBootstrap ? { media_bootstrap: mediaBootstrap } : {}),
    room_slug: admission.roomSlug,
    ticket,
  });
  if (admission.cookie) response.headers.append("Set-Cookie", admission.cookie);
  response.headers.set("Server-Timing", timing.header());
  return response;
});

/**
 * `Server-Timing` for the ticket: where the join's first round trip goes
 * (admission = Kova session + channel checks, media = voice token + TURN).
 * Durations only, no identifiers; `pnpm bench:voice` reads them.
 */
function createServerTiming() {
  const entries: string[] = [];
  const started = performance.now();
  return {
    measure<A, E, R>(
      name: string,
      effect: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> {
      return Effect.suspend(() => {
        const start = performance.now();
        return effect.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              entries.push(
                `${name};dur=${(performance.now() - start).toFixed(1)}`,
              );
            }),
          ),
        );
      });
    },
    header(): string {
      return [
        ...entries,
        `total;dur=${(performance.now() - started).toFixed(1)}`,
      ].join(", ");
    },
  };
}

async function createRoomMediaBootstrap({
  env,
  nonce,
  roomSlug,
  subject,
}: {
  env: SocketTicketEnv;
  nonce: string;
  roomSlug: string;
  subject: string;
}) {
  const secret = env.CALLS_APP_SECRET;
  if (!secret) {
    throw new Error("CALLS_APP_SECRET is required for room media bootstrap");
  }
  const [voiceToken, iceServers] = await Promise.all([
    issueVoiceToken({
      participantId: nonce,
      roomSlug,
      subject,
      secret,
    }),
    generateTurnCredentials({
      tokenId: env.TURN_TOKEN_ID ?? "",
      tokenSecret: env.TURN_TOKEN_SECRET ?? "",
      fetch,
      log: {
        info(message) {
          console.info(`[socket-ticket] ${message}`);
        },
        warn(message) {
          console.warn(`[socket-ticket] ${message}`);
        },
      },
    }),
  ]);
  return {
    participant_id: nonce,
    voice_token: voiceToken,
    ice_servers: iceServers,
  };
}

function authorizeAuthenticatedTicket(
  request: Request,
  body: SocketTicketRequestBody,
  audience: SocketTicketAudience,
): Effect.Effect<
  TicketAdmission | Response,
  Unauthenticated | AuthUnavailable,
  KovaAuth | Database
> {
  return Effect.gen(function* () {
    const userId = yield* signedInUserId(request);

    if (audience === "global") {
      return {
        accessMode: "authenticated",
        roomSlug: "global-gateway",
        subject: userId,
      } satisfies TicketAdmission;
    }

    if (typeof body.channelId !== "string" || !body.channelId.trim()) {
      return apiError(
        "channelId is required",
        400,
        "CHANNEL_REQUIRED",
        request,
      );
    }

    const channelId = body.channelId.trim();
    const db = yield* Database;
    const channelAccess = yield* Effect.promise(() =>
      resolveChannelAccess(db, userId, channelId),
    );
    if (!channelAccess) {
      return Response.json(
        { error: "Channel not found or access denied" },
        { status: 403 },
      );
    }

    if (
      typeof body.roomSlug === "string" &&
      body.roomSlug.startsWith("dm-call-")
    ) {
      const callRoomSlug = yield* Effect.promise(() =>
        getAuthorizedDmCallRoomSlug(db, userId, channelId),
      );
      if (!callRoomSlug || callRoomSlug !== body.roomSlug) {
        return apiError(
          "Channel not found or access denied",
          403,
          "ROOM_NOT_ALLOWED",
          request,
        );
      }
      return {
        accessMode: "authenticated",
        roomSlug: callRoomSlug,
        subject: userId,
      } satisfies TicketAdmission;
    }

    const serverId = channelAccess.serverId;
    if (!serverId) {
      return apiError(
        "Server voice channel required",
        400,
        "SERVER_VOICE_REQUIRED",
        request,
      );
    }

    const channel = yield* Effect.promise(() =>
      db
        .prepare(
          "SELECT channel_type FROM channels WHERE id = ? AND server_id = ?",
        )
        .bind(channelId, serverId)
        .first<{ channel_type: string }>(),
    );
    if (channel?.channel_type !== "voice") {
      return apiError(
        "Server voice channel required",
        400,
        "SERVER_VOICE_REQUIRED",
        request,
      );
    }

    if (
      typeof body.serverId === "string" &&
      body.serverId.trim() &&
      body.serverId.trim() !== serverId
    ) {
      return apiError(
        "Channel not found or access denied",
        403,
        "SERVER_MISMATCH",
        request,
      );
    }

    const permissions = yield* Effect.promise(() =>
      getUserChannelPermissionsForDb(db, serverId, channelId, userId),
    );
    if (
      permissions === null ||
      !hasPermission(permissions, PERMISSIONS.CONNECT)
    ) {
      return apiError(
        "You do not have permission to connect to this voice channel",
        403,
        "CONNECT_DENIED",
        request,
      );
    }

    return {
      accessMode: "authenticated",
      roomSlug: buildVoiceChannelRoomSlug(serverId, channelId),
      serverId,
      subject: userId,
    } satisfies TicketAdmission;
  });
}

function authorizePublicDemoTicket(
  request: Request,
  ticketSecret: string,
  body: SocketTicketRequestBody,
  audience: SocketTicketAudience,
): Effect.Effect<TicketAdmission | Response, never, RateLimiter> {
  return Effect.gen(function* () {
    if (!isSameOrigin(request)) {
      return apiError(
        "Demo ticket origin is not allowed",
        403,
        "DEMO_ORIGIN_NOT_ALLOWED",
        request,
      );
    }
    if (audience === "global") {
      return apiError(
        "Public demo global gateway is disabled",
        403,
        "GLOBAL_DEMO_DISABLED",
      );
    }
    if (!isPublicDemoRoomSlug(body.roomSlug)) {
      return apiError("Demo room is not allowed", 403, "DEMO_ROOM_NOT_ALLOWED");
    }
    const roomSlug = body.roomSlug;

    const session = yield* Effect.promise(() =>
      getOrCreateDemoSession(request, ticketSecret),
    );
    const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const rateLimiter = yield* RateLimiter;
    const ipLimit = yield* rateLimiter.check(
      `demo-ticket-ip:${clientIp}`,
      "issue",
      DEMO_TICKET_RATE_LIMIT,
    );
    if (ipLimit) return ipLimit;

    const sessionLimit = yield* rateLimiter.check(
      `demo-ticket-session:${session.subject}`,
      "issue",
      DEMO_SESSION_TICKET_RATE_LIMIT,
    );
    if (sessionLimit) return sessionLimit;

    return {
      accessMode: "public-demo",
      cookie: session.cookie ?? undefined,
      roomSlug,
      subject: session.subject,
    } satisfies TicketAdmission;
  });
}

async function getAuthorizedDmCallRoomSlug(
  db: D1Database,
  userId: string,
  channelId: string,
): Promise<string | null> {
  const { results } = await db
    .prepare(
      `SELECT user_id FROM dm_recipients WHERE channel_id = ? ORDER BY user_id ASC`,
    )
    .bind(channelId)
    .all<{ user_id: string }>();
  const recipients = (results ?? [])
    .map((row: { user_id: string }) => row.user_id)
    .filter(Boolean);
  if (recipients.length !== 2 || !recipients.includes(userId)) return null;
  return `dm-call-${recipients[0]}-${recipients[1]}`;
}

function getSocketTicketConfig(
  env: SocketTicketEnv,
): { ok: true; ticketSecret: string } | { ok: false; code: string } {
  if (!env.REALTIME_TICKET_SECRET) {
    return { ok: false, code: "REALTIME_TICKET_SECRET_MISSING" };
  }

  return {
    ok: true,
    ticketSecret: env.REALTIME_TICKET_SECRET,
  };
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

function parseAudience(value: unknown): SocketTicketAudience | null {
  return value === "global" || value === "room" || value === "voice"
    ? value
    : null;
}

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** The handlers, on the given services (the live ones by default). */
export function socketTicketRoutes(services?: Layer.Layer<RouteServices>) {
  return {
    OPTIONS,
    POST: async ({ request }: { request: Request }) =>
      noStore(
        await runRoute(
          "voice.socket_ticket",
          request,
          issueTicket(request),
          services,
        ),
      ),
  };
}
