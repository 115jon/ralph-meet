// /api/voice/socket-ticket on the Effect edge. The route file only wires
// these handlers.
//
// audience "global" is the chat socket's ticket and is current.
//
// DEPRECATED: audiences "room" and "voice", and the room ticket's
// `media_bootstrap`. That is the two-request join (one Kova check each)
// that `/api/voice/admission` replaced in v3.13.0 (src/server/routes/
// voice-admission.ts, realtime/ADMISSION.md). Installed desktop builds up to
// v3.12.0 and mobile builds up to mobile-v0.5.1 still join this way, and
// MeetingRoom still mints Identify/Resume credentials for their tickets (no
// `media` claim). Delete both audiences, the bootstrap and that minting after
// v3.14.0, once the desktop updater and the mobile minimum version are past
// those builds.

import { Effect, Schema, type Layer } from "effect";

import { apiError } from "@/lib/api-helpers";
import { looseStruct } from "@/lib/schema";
import { validateBody } from "@/lib/validate-body";
import {
  issueSocketTicket,
  type SocketTicketAudience,
} from "@/lib/voice/socket-ticket";
import { WorkerEnv } from "@/server/bindings";
import { runRoute, type RouteServices } from "@/server/edge";
import {
  mintVoiceMedia,
  turnServersFrom,
  voiceMediaWire,
} from "../../../realtime/voice-media";
import {
  SOCKET_TICKET_TTL_MS,
  admitCallSocket,
  admitGlobalSocket,
  createServerTiming,
  getSocketTicketConfig,
  noStore,
  socketAdmissionOptions,
} from "./socket-admission";

export const socketTicketRequestBodySchema = looseStruct({
  audience: Schema.optional(Schema.Unknown),
  channelId: Schema.optional(Schema.Unknown),
  /** A voice move grant for channelId: stands in for CONNECT there. */
  moveGrant: Schema.optional(Schema.Unknown),
  roomSlug: Schema.optional(Schema.Unknown),
  serverId: Schema.optional(Schema.Unknown),
});

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

  const admission = yield* timing.measure(
    "admission",
    audience === "global"
      ? admitGlobalSocket(request)
      : admitCallSocket(request, body, config.ticketSecret, audience),
  );
  if (admission instanceof Response) return admission;

  const expiresAt = Date.now() + SOCKET_TICKET_TTL_MS;
  const nonce = crypto.randomUUID();
  const callsSecret = env.CALLS_APP_SECRET;
  if (audience === "room" && !callsSecret) {
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
        ...(admission.channelId ? { channelId: admission.channelId } : {}),
        subject: admission.subject,
      },
      config.ticketSecret,
    ),
  );

  // Deprecated (see the top of this file): the room ticket's media bootstrap.
  const mediaBootstrap =
    audience === "room" && callsSecret
      ? yield* timing.measure(
          "media",
          Effect.promise(() =>
            mintVoiceMedia({
              participantId: nonce,
              roomSlug: admission.roomSlug,
              subject: admission.subject,
              callsSecret,
              turn: turnServersFrom(env, turnLog),
            }),
          ),
        )
      : undefined;

  const response = Response.json({
    access_mode: admission.accessMode,
    audience,
    expires_at: expiresAt,
    ...(mediaBootstrap
      ? { media_bootstrap: voiceMediaWire(mediaBootstrap) }
      : {}),
    room_slug: admission.roomSlug,
    ticket,
  });
  if (admission.cookie) response.headers.append("Set-Cookie", admission.cookie);
  response.headers.set("Server-Timing", timing.header());
  return response;
});

const turnLog = {
  info(message: string) {
    console.info(`[socket-ticket] ${message}`);
  },
  warn(message: string) {
    console.warn(`[socket-ticket] ${message}`);
  },
};

function parseAudience(value: unknown): SocketTicketAudience | null {
  return value === "global" || value === "room" || value === "voice"
    ? value
    : null;
}

/** The handlers, on the given services (the live ones by default). */
export function socketTicketRoutes(services?: Layer.Layer<RouteServices>) {
  return {
    OPTIONS: socketAdmissionOptions,
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
