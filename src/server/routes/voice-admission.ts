// /api/voice/admission on the Effect edge: one request per voice join. The
// caller is proven once (one Kova session check, one channel-access read)
// and gets everything the join needs: the room socket's ticket, the voice
// socket's ticket, and the participant's voice token and TURN servers.
// Reconnects ask for only the socket that needs a new ticket. Wire format and
// timing: realtime/ADMISSION.md.

import { Effect, Schema, type Layer } from "effect";

import { apiError } from "@/lib/api-helpers";
import { looseStruct } from "@/lib/schema";
import { validateBody } from "@/lib/validate-body";
import {
  isParticipantId,
  issueSocketTicket,
  type SocketTicketClaims,
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
  createServerTiming,
  getSocketTicketConfig,
  noStore,
  socketAdmissionOptions,
  type SocketAdmission,
} from "./socket-admission";

export const voiceAdmissionRequestBodySchema = looseStruct({
  channelId: Schema.optional(Schema.Unknown),
  roomSlug: Schema.optional(Schema.Unknown),
  serverId: Schema.optional(Schema.Unknown),
  /** A voice move grant for channelId: stands in for CONNECT there. */
  moveGrant: Schema.optional(Schema.Unknown),
  /** Which sockets need a ticket: "room", "voice" or both (the default). */
  sockets: Schema.optional(Schema.Unknown),
  /** Mint the voice token and TURN for the room ticket's participant. */
  media: Schema.optional(Schema.Unknown),
  /** The participant the client already is (reconnects; binds the voice ticket). */
  participantId: Schema.optional(Schema.Unknown),
});

type CallSocket = "room" | "voice";

type AdmissionRequest = {
  sockets: ReadonlySet<CallSocket>;
  media: boolean;
  participantId?: string;
};

/** POST /api/voice/admission */
const admit = Effect.fn("voice.admission")(function* (request: Request) {
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
    validateBody(request, voiceAdmissionRequestBodySchema, request),
  );
  if (body instanceof Response) return body;

  const parsed = parseAdmissionRequest(body);
  if (typeof parsed === "string") {
    return apiError(parsed, 400, "INVALID_ADMISSION", request);
  }
  const callsSecret = env.CALLS_APP_SECRET;
  if (parsed.media && !callsSecret) {
    return apiError(
      "Realtime media admission is not configured",
      503,
      "CALLS_APP_SECRET_MISSING",
      request,
    );
  }

  // A moved user's grant is spent once per use, as the two tickets of the
  // deprecated flow each spent it: a join (or a room reconnect) spends the
  // "room" use, a voice-only reconnect the "voice" use.
  const admission = yield* timing.measure(
    "admission",
    admitCallSocket(
      request,
      body,
      config.ticketSecret,
      parsed.sockets.has("room") ? "room" : "voice",
    ),
  );
  if (admission instanceof Response) return admission;

  const expiresAt = Date.now() + SOCKET_TICKET_TTL_MS;
  const roomNonce = parsed.sockets.has("room") ? crypto.randomUUID() : null;
  // The participant this join identifies as: the room ticket's nonce when
  // this admission mints for it, else the one the client already is.
  const participantId =
    parsed.media && roomNonce ? roomNonce : parsed.participantId;

  const [roomTicket, voiceTicket, media] = yield* timing.measure(
    "media",
    Effect.promise(() =>
      Promise.all([
        roomNonce
          ? issueSocketTicket(
              {
                ...ticketClaims(admission, "room", expiresAt, roomNonce),
                media: parsed.media ? "issued" : "held",
              },
              config.ticketSecret,
            )
          : null,
        parsed.sockets.has("voice")
          ? issueSocketTicket(
              {
                ...ticketClaims(
                  admission,
                  "voice",
                  expiresAt,
                  crypto.randomUUID(),
                ),
                ...(participantId ? { participant: participantId } : {}),
              },
              config.ticketSecret,
            )
          : null,
        parsed.media && roomNonce && callsSecret
          ? mintVoiceMedia({
              participantId: roomNonce,
              roomSlug: admission.roomSlug,
              subject: admission.subject,
              callsSecret,
              turn: turnServersFrom(env, turnLog),
            })
          : null,
      ]),
    ),
  );

  const response = Response.json({
    access_mode: admission.accessMode,
    room_slug: admission.roomSlug,
    expires_at: expiresAt,
    ...(participantId ? { participant_id: participantId } : {}),
    ...(roomTicket ? { room_ticket: roomTicket } : {}),
    ...(voiceTicket ? { voice_ticket: voiceTicket } : {}),
    ...(media ? { media: voiceMediaWire(media) } : {}),
  });
  if (admission.cookie) response.headers.append("Set-Cookie", admission.cookie);
  response.headers.set("Server-Timing", timing.header());
  return response;
});

function ticketClaims(
  admission: SocketAdmission,
  audience: CallSocket,
  expiresAt: number,
  nonce: string,
): SocketTicketClaims {
  return {
    accessMode: admission.accessMode,
    audience,
    expiresAt,
    nonce,
    roomSlug: admission.roomSlug,
    ...(admission.serverId ? { serverId: admission.serverId } : {}),
    ...(admission.channelId ? { channelId: admission.channelId } : {}),
    subject: admission.subject,
  };
}

/** The request's sockets, media and participant, or why it is invalid. */
export function parseAdmissionRequest(body: {
  sockets?: unknown;
  media?: unknown;
  participantId?: unknown;
}): AdmissionRequest | string {
  let sockets: Set<CallSocket>;
  if (body.sockets === undefined) {
    sockets = new Set(["room", "voice"]);
  } else {
    if (
      !Array.isArray(body.sockets) ||
      body.sockets.length === 0 ||
      body.sockets.length > 2 ||
      body.sockets.some((socket) => socket !== "room" && socket !== "voice") ||
      new Set(body.sockets).size !== body.sockets.length
    ) {
      return 'sockets must list "room", "voice" or both';
    }
    sockets = new Set(body.sockets as CallSocket[]);
  }

  if (body.media !== undefined && typeof body.media !== "boolean") {
    return "media must be a boolean";
  }
  const media = body.media ?? sockets.has("room");
  if (media && !sockets.has("room")) {
    return "media is minted for the room ticket's participant";
  }

  if (body.participantId !== undefined) {
    if (!isParticipantId(body.participantId)) {
      return "participantId is invalid";
    }
    if (media) {
      return "participantId names an existing participant; media mints a new one";
    }
  }

  return {
    sockets,
    media,
    ...(body.participantId !== undefined
      ? { participantId: body.participantId }
      : {}),
  };
}

const turnLog = {
  info(message: string) {
    console.info(`[voice-admission] ${message}`);
  },
  warn(message: string) {
    console.warn(`[voice-admission] ${message}`);
  },
};

/** The handlers, on the given services (the live ones by default). */
export function voiceAdmissionRoutes(services?: Layer.Layer<RouteServices>) {
  return {
    OPTIONS: socketAdmissionOptions,
    POST: async ({ request }: { request: Request }) =>
      noStore(
        await runRoute("voice.admission", request, admit(request), services),
      ),
  };
}
