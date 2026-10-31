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

/**
 * One single-use ticket for the global chat socket. A 401 rejects with an
 * ApiError whose `status` RealtimeSocket reads as "the session is gone".
 */
export async function acquireGatewayTicket(): Promise<GatewayTicket> {
  const { ticket } = await apiJson("/api/voice/socket-ticket", TicketSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audience: "global" }),
  });
  return {
    url: `${config.apiBaseUrl.replace(/^http/, "ws")}/api/gateway`,
    protocols: [SOCKET_PROTOCOL, `${TICKET_PROTOCOL_PREFIX}${ticket}`],
  };
}
