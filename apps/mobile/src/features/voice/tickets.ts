import { Schema } from "effect";

import { apiJson } from "@/lib/api";
import {
  socketUrl,
  ticketProtocols,
  type GatewayTicket,
} from "@/features/realtime/ticket";

import { type IceServer, toIceServers } from "./protocol";

// The call sockets' admission, as src/lib/voice/voice-admission-client.ts
// requests it: one POST /api/voice/admission per join returns the room
// ticket, the voice ticket and the participant's voice token and TURN
// (realtime/ADMISSION.md), so the voice socket and the peer connection start
// without waiting for the room socket's Ready. Each socket takes its half
// once; a reconnect asks for only that socket's ticket.

/** Which voice channel a call socket is for. */
export interface CallTarget {
  readonly serverId: string;
  readonly channelId: string;
  readonly roomSlug: string;
}

const IceServerWire = Schema.Struct({
  urls: Schema.Array(Schema.NonEmptyString),
  username: Schema.optional(Schema.String),
  credential: Schema.optional(Schema.String),
});

const AdmissionSchema = Schema.Struct({
  participant_id: Schema.optional(Schema.String),
  room_ticket: Schema.optional(Schema.NonEmptyString),
  voice_ticket: Schema.optional(Schema.NonEmptyString),
  media: Schema.optional(
    Schema.Struct({
      participant_id: Schema.String,
      voice_token: Schema.String,
      ice_servers: Schema.optional(Schema.Array(IceServerWire)),
    }),
  ),
});

type Admission = typeof AdmissionSchema.Type;

export interface MediaBootstrap {
  readonly participantId: string;
  readonly voiceToken: string;
  readonly iceServers?: readonly IceServer[];
}

export interface RoomTicket extends GatewayTicket {
  readonly mediaBootstrap?: MediaBootstrap;
}

type CallSocket = "room" | "voice";

/** POSTs an admission; a 401 rejects with ApiError (status 401). */
function requestAdmission(
  target: CallTarget,
  options: {
    sockets: readonly CallSocket[];
    media: boolean;
    participantId?: string;
  },
): Promise<Admission> {
  return apiJson("/api/voice/admission", AdmissionSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channelId: target.channelId,
      serverId: target.serverId,
      roomSlug: target.roomSlug,
      sockets: options.sockets,
      media: options.media,
      ...(options.participantId
        ? { participantId: options.participantId }
        : {}),
    }),
  });
}

/** Tickets are single use and live 60 s; a join's half is used within this. */
const JOIN_TICKET_MAX_AGE_MS = 40_000;

type Join = {
  target: CallTarget;
  promise: Promise<Admission> | null;
  startedAt: number;
  taken: Set<CallSocket>;
};

const joins = new Map<string, Join>();

/** A join is starting: its first room and voice tickets come from one request. */
export function beginCallAdmission(target: CallTarget): void {
  joins.set(target.roomSlug, {
    target,
    promise: null,
    startedAt: Date.now(),
    taken: new Set(),
  });
}

function openJoin(
  target: CallTarget,
  socket: CallSocket,
): Promise<Admission> | null {
  const join = joins.get(target.roomSlug);
  if (
    !join ||
    join.target.channelId !== target.channelId ||
    join.target.serverId !== target.serverId ||
    join.taken.has(socket) ||
    Date.now() - join.startedAt >= JOIN_TICKET_MAX_AGE_MS
  ) {
    return null;
  }
  join.promise ??= requestAdmission(target, {
    sockets: ["room", "voice"],
    media: true,
  });
  join.taken.add(socket);
  if (join.taken.size === 2) joins.delete(target.roomSlug);
  return join.promise;
}

function roomUrl(target: CallTarget): string {
  return socketUrl(
    `/api/channels/${encodeURIComponent(target.roomSlug)}/ws?v=1`,
  );
}

function voiceUrl(target: CallTarget): string {
  return socketUrl(
    `/api/channels/${encodeURIComponent(target.roomSlug)}/voice?v=1`,
  );
}

/**
 * The room socket's ticket: the join's admission (with the media bootstrap)
 * the first time, then a room-only request per reconnect that mints
 * nothing: a Resume keeps the credentials, an Identify gets MediaReady.
 */
export async function acquireRoomTicket(
  target: CallTarget,
): Promise<RoomTicket> {
  const join = openJoin(target, "room");
  if (join) {
    const admission = await join;
    if (admission.room_ticket) {
      const media = admission.media;
      return {
        url: roomUrl(target),
        protocols: ticketProtocols(admission.room_ticket),
        ...(media
          ? {
              mediaBootstrap: {
                participantId: media.participant_id,
                voiceToken: media.voice_token,
                // Empty means "none": the transport falls back to public STUN.
                iceServers:
                  media.ice_servers && toIceServers(media.ice_servers),
              },
            }
          : {}),
      };
    }
  }
  const admission = await requestAdmission(target, {
    sockets: ["room"],
    media: false,
  });
  return {
    url: roomUrl(target),
    protocols: ticketProtocols(requireTicket(admission.room_ticket)),
  };
}

/**
 * The voice socket's ticket, bound to `participantId` when known: the join's
 * admission the first time, then a voice-only request per reconnect.
 */
export async function acquireVoiceTicket(
  target: CallTarget,
  participantId: string | null,
): Promise<GatewayTicket> {
  const join = openJoin(target, "voice");
  if (join) {
    const admission = await join;
    if (
      admission.voice_ticket &&
      (participantId === null || admission.participant_id === participantId)
    ) {
      return {
        url: voiceUrl(target),
        protocols: ticketProtocols(admission.voice_ticket),
      };
    }
  }
  const admission = await requestAdmission(target, {
    sockets: ["voice"],
    media: false,
    ...(participantId ? { participantId } : {}),
  });
  return {
    url: voiceUrl(target),
    protocols: ticketProtocols(requireTicket(admission.voice_ticket)),
  };
}

function requireTicket(ticket: string | undefined): string {
  if (!ticket) throw new Error("Voice admission response was invalid");
  return ticket;
}

export function clearCallAdmissionsForTests(): void {
  joins.clear();
}
