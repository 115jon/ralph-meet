// Who may open a call socket, shared by /api/voice/admission (one request per
// join, realtime/ADMISSION.md) and the deprecated room and voice audiences of
// /api/voice/socket-ticket. Each check proves the caller once: one Kova
// session lookup (signedInUserId) and one channel-access read per request.

import { Effect } from "effect";

import {
  apiError,
  buildVoiceChannelRoomSlug,
  getCorsHeaders,
  handleCorsPreflightIfNeeded,
} from "@/lib/api-helpers";
import { resolveChannelAccess } from "@/lib/channel-access";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { getOrCreateDemoSession } from "@/lib/voice/demo-session";
import { isPublicDemoRoomSlug } from "@/lib/voice/realtime-policy";
import type { RealtimeAccessMode } from "@/lib/voice/socket-ticket";
import { openVoiceMoveGrant } from "@/lib/voice/voice-move-grant";
import {
  Database,
  RateLimiter,
  WorkerEnv,
  type WorkerBindings,
} from "@/server/bindings";
import type { AuthUnavailable, Unauthenticated } from "@/server/errors";
import { signedInUserId, type KovaAuth } from "@/server/kova-auth";
import {
  VOICE_MOVE_GRANT_USE_PATH,
  type VoiceMoveGrantUseRequest,
} from "../../../realtime/voice-move";

/** Every socket ticket is single use and lives this long (60 s). */
export const SOCKET_TICKET_TTL_MS = 60_000;
const DEMO_TICKET_RATE_LIMIT = { limit: 12, windowMs: 60 * 60 * 1000 };
const DEMO_SESSION_TICKET_RATE_LIMIT = { limit: 30, windowMs: 60 * 60 * 1000 };

export const socketAdmissionOptions = async ({
  request,
}: {
  request: Request;
}) =>
  handleCorsPreflightIfNeeded(request) ??
  new Response(null, { status: 204, headers: getCorsHeaders(request) });

export type SocketAdmission = {
  accessMode: RealtimeAccessMode;
  cookie?: string;
  roomSlug: string;
  serverId?: string;
  /** The channel the room reports its voice roster for (authenticated). */
  channelId?: string;
  subject: string;
};

/** What a call socket admission names; the request bodies' common fields. */
export type CallSocketTarget = {
  channelId?: unknown;
  /** A voice move grant for channelId: stands in for CONNECT there. */
  moveGrant?: unknown;
  roomSlug?: unknown;
  serverId?: unknown;
};

type AdmissionResult = Effect.Effect<
  SocketAdmission | Response,
  Unauthenticated | AuthUnavailable,
  KovaAuth | Database | RateLimiter | WorkerEnv
>;

/**
 * A room or voice socket's admission: the signed-in user's channel (CONNECT,
 * or a move grant spent for `moveGrantUse`), or with no channel a public demo
 * room for this browser's demo session.
 */
export function admitCallSocket(
  request: Request,
  target: CallSocketTarget,
  ticketSecret: string,
  moveGrantUse: VoiceMoveGrantUseRequest["use"],
): AdmissionResult {
  const hasChannelId =
    typeof target.channelId === "string" && target.channelId.trim().length > 0;
  return hasChannelId
    ? authorizeChannel(request, target, ticketSecret, moveGrantUse)
    : authorizePublicDemo(request, ticketSecret, target.roomSlug);
}

/** The chat socket (/api/gateway): any signed-in user. */
export function admitGlobalSocket(
  request: Request,
): Effect.Effect<SocketAdmission, Unauthenticated | AuthUnavailable, KovaAuth> {
  return Effect.map(signedInUserId(request), (userId) => ({
    accessMode: "authenticated" as const,
    roomSlug: "global-gateway",
    subject: userId,
  }));
}

function authorizeChannel(
  request: Request,
  target: CallSocketTarget,
  ticketSecret: string,
  moveGrantUse: VoiceMoveGrantUseRequest["use"],
): Effect.Effect<
  SocketAdmission | Response,
  Unauthenticated | AuthUnavailable,
  KovaAuth | Database | WorkerEnv
> {
  return Effect.gen(function* () {
    const userId = yield* signedInUserId(request);
    const channelId = String(target.channelId).trim();
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
      typeof target.roomSlug === "string" &&
      target.roomSlug.startsWith("dm-call-")
    ) {
      const callRoomSlug = yield* Effect.promise(() =>
        getAuthorizedDmCallRoomSlug(db, userId, channelId),
      );
      if (!callRoomSlug || callRoomSlug !== target.roomSlug) {
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
        channelId,
        subject: userId,
      } satisfies SocketAdmission;
    }

    const serverId = channelAccess.serverId;
    // resolveChannelAccess read this channel's row and the caller's
    // permissions in it (for this server) already: no second lookup.
    if (!serverId || channelAccess.channelType !== "voice") {
      return apiError(
        "Server voice channel required",
        400,
        "SERVER_VOICE_REQUIRED",
        request,
      );
    }

    if (
      typeof target.serverId === "string" &&
      target.serverId.trim() &&
      target.serverId.trim() !== serverId
    ) {
      return apiError(
        "Channel not found or access denied",
        403,
        "SERVER_MISMATCH",
        request,
      );
    }

    const permissions = channelAccess.permissions;
    let canConnect =
      permissions !== null && hasPermission(permissions, PERMISSIONS.CONNECT);
    if (!canConnect && target.moveGrant !== undefined) {
      // A moderator moved them here: a valid grant, spent once per use with
      // the global gateway (only the user's latest grant counts).
      const grant = yield* Effect.promise(() =>
        openVoiceMoveGrant(target.moveGrant, ticketSecret, {
          subject: userId,
          channelId,
          serverId,
        }),
      );
      if (grant) {
        const env = yield* WorkerEnv;
        canConnect = yield* Effect.promise(() =>
          spendVoiceMoveGrant(env, {
            user_id: userId,
            jti: grant.jti,
            channel_id: channelId,
            use: moveGrantUse,
          }),
        );
      }
    }
    if (!canConnect) {
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
      channelId,
      subject: userId,
    } satisfies SocketAdmission;
  });
}

function authorizePublicDemo(
  request: Request,
  ticketSecret: string,
  roomSlug: unknown,
): Effect.Effect<SocketAdmission | Response, never, RateLimiter> {
  return Effect.gen(function* () {
    if (!isSameOrigin(request)) {
      return apiError(
        "Demo ticket origin is not allowed",
        403,
        "DEMO_ORIGIN_NOT_ALLOWED",
        request,
      );
    }
    if (!isPublicDemoRoomSlug(roomSlug)) {
      return apiError("Demo room is not allowed", 403, "DEMO_ROOM_NOT_ALLOWED");
    }

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
    } satisfies SocketAdmission;
  });
}

/** Spends a move grant for one use; false if dead, used or unreachable. */
async function spendVoiceMoveGrant(
  env: WorkerBindings,
  use: VoiceMoveGrantUseRequest,
): Promise<boolean> {
  try {
    const response = await env.MEETING_ROOM.get(
      env.MEETING_ROOM.idFromName("global-gateway"),
    ).fetch(`https://internal${VOICE_MOVE_GRANT_USE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(use),
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return (
      typeof body === "object" &&
      body !== null &&
      "ok" in body &&
      body.ok === true
    );
  } catch {
    return false;
  }
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

/** The ticket signing secret, or the 503 code naming what is missing. */
export function getSocketTicketConfig(
  env: WorkerBindings,
): { ok: true; ticketSecret: string } | { ok: false; code: string } {
  if (!env.REALTIME_TICKET_SECRET) {
    return { ok: false, code: "REALTIME_TICKET_SECRET_MISSING" };
  }
  return { ok: true, ticketSecret: env.REALTIME_TICKET_SECRET };
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

export function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/**
 * `Server-Timing` for an admission: where the join's first round trip goes
 * (admission = Kova session + channel checks, media = voice token + TURN).
 * Durations only, no identifiers; `pnpm bench:voice` reads them.
 */
export function createServerTiming() {
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
