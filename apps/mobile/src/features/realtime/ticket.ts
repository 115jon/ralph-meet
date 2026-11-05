import { Schema } from "effect";

import { apiJson } from "@/lib/api";
import { config } from "@/lib/config";

// Mirrors src/lib/voice/socket-ticket.ts: the server reads the ticket from the
// second WebSocket subprotocol and answers with the first.
const SOCKET_PROTOCOL = "ralph.realtime.v1";
const TICKET_PROTOCOL_PREFIX = "ralph.ticket.";

const TicketSchema = Schema.Struct({ ticket: Schema.NonEmptyString });

export interface GatewayTicket {
  readonly url: string;
  readonly protocols: string[];
}

/** The WebSocket subprotocols that carry `ticket`. */
export function ticketProtocols(ticket: string): string[] {
  return [SOCKET_PROTOCOL, `${TICKET_PROTOCOL_PREFIX}${ticket}`];
}

/** `path` on the API host as a ws(s):// URL. */
export function socketUrl(path: string): string {
  return `${config.apiBaseUrl.replace(/^http/, "ws")}${path}`;
}

/**
 * POSTs a ticket request; a 401 rejects with ApiError (status 401). `signal`
 * is RealtimeSocket's: it aborts when the attempt times out or is replaced.
 */
export function requestSocketTicket<
  S extends Schema.ConstraintDecoder<unknown>,
>(
  body: Record<string, string>,
  schema: S,
  signal?: AbortSignal,
): Promise<S["Type"]> {
  return apiJson("/api/voice/socket-ticket", schema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * One single-use ticket for the global chat socket. A 401 rejects with an
 * ApiError whose `status` RealtimeSocket reads as "the session is gone".
 */
export async function acquireGatewayTicket(
  signal?: AbortSignal,
): Promise<GatewayTicket> {
  const { ticket } = await requestSocketTicket(
    { audience: "global" },
    TicketSchema,
    signal,
  );
  return { url: socketUrl("/api/gateway"), protocols: ticketProtocols(ticket) };
}
