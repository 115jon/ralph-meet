import { Schema } from "effect";

import {
  requestSocketTicket,
  socketUrl,
  ticketProtocols,
  type GatewayTicket,
} from "@/features/realtime/ticket";

import { type IceServer, toIceServers } from "./protocol";

// The call sockets' tickets, as src/lib/voice/socket-ticket-client.ts and the
// two web gateways request them. A "room" ticket also carries the media
// bootstrap (participant id, voice token, TURN), so the voice socket and the
// peer connection start without waiting for the room socket's Ready.

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

const RoomTicketSchema = Schema.Struct({
  ticket: Schema.NonEmptyString,
  media_bootstrap: Schema.optional(
    Schema.Struct({
      participant_id: Schema.String,
      voice_token: Schema.String,
      ice_servers: Schema.optional(Schema.Array(IceServerWire)),
    }),
  ),
});

const VoiceTicketSchema = Schema.Struct({ ticket: Schema.NonEmptyString });

export interface MediaBootstrap {
  readonly participantId: string;
  readonly voiceToken: string;
  readonly iceServers?: readonly IceServer[];
}

export interface RoomTicket extends GatewayTicket {
  readonly mediaBootstrap?: MediaBootstrap;
}

function ticketBody(audience: "room" | "voice", target: CallTarget) {
  return {
    audience,
    channelId: target.channelId,
    serverId: target.serverId,
    roomSlug: target.roomSlug,
  };
}

/** The room socket's ticket (MeetingRoom), with the media bootstrap. */
export async function acquireRoomTicket(
  target: CallTarget,
): Promise<RoomTicket> {
  const data = await requestSocketTicket(
    ticketBody("room", target),
    RoomTicketSchema,
  );
  const bootstrap = data.media_bootstrap;
  const ticket: RoomTicket = {
    url: socketUrl(
      `/api/channels/${encodeURIComponent(target.roomSlug)}/ws?v=1`,
    ),
    protocols: ticketProtocols(data.ticket),
  };
  if (!bootstrap) return ticket;
  return {
    ...ticket,
    mediaBootstrap: {
      participantId: bootstrap.participant_id,
      voiceToken: bootstrap.voice_token,
      // Empty means "none": the transport falls back to public STUN.
      iceServers: bootstrap.ice_servers && toIceServers(bootstrap.ice_servers),
    },
  };
}

/** The voice socket's ticket (VoiceRoom). */
export async function acquireVoiceTicket(
  target: CallTarget,
): Promise<GatewayTicket> {
  const { ticket } = await requestSocketTicket(
    ticketBody("voice", target),
    VoiceTicketSchema,
  );
  return {
    url: socketUrl(
      `/api/channels/${encodeURIComponent(target.roomSlug)}/voice?v=1`,
    ),
    protocols: ticketProtocols(ticket),
  };
}
