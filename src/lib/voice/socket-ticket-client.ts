import { recoverAppSession } from "@/lib/app-session-recovery";
import {
  getDesktopToken,
  getStoredKovaAuthSessionToken,
} from "@/lib/desktop-auth";
import { KOVA_AUTH_PUBLISHABLE_KEY } from "@/lib/kova-auth-config";
import { getApiBaseUrl, isTauri } from "@/lib/platform";
import { buildSocketTicketProtocols } from "@/lib/voice/socket-ticket";

// The chat socket's ticket (/api/gateway, audience "global"). The call
// sockets (room, voice) are admitted by /api/voice/admission instead, one
// request per join: see voice-admission-client.ts.

export type SocketTicketRequest = { audience: "global" };

/** A refused ticket request; `status` 401 means the session is gone. */
export class SocketTicketError extends Error {
  constructor(readonly status: number) {
    super(`Socket ticket request failed (${status})`);
    this.name = "SocketTicketError";
  }
}

function postSocketTicket(
  request: SocketTicketRequest,
  token: string | null,
): Promise<Response> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (isTauri() && KOVA_AUTH_PUBLISHABLE_KEY) {
    headers.set("X-Publishable-Key", KOVA_AUTH_PUBLISHABLE_KEY);
  }
  return fetch(`${getApiBaseUrl()}/api/voice/socket-ticket`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(request),
  });
}

/**
 * One ticket. A 401 asks Kova for a fresh app token (shared with every other
 * refused call, see app-session-recovery) and tries once more with it, so a
 * token revoked server-side costs the socket one round trip, not its
 * "signed out" state. A 401 that survives that is the caller's to count.
 */
async function requestSocketTicket(
  request: SocketTicketRequest,
): Promise<string> {
  const token = getDesktopToken() ?? getStoredKovaAuthSessionToken();
  let response = await postSocketTicket(request, token);

  if (response.status === 401) {
    const freshToken = await recoverAppSession(token);
    if (freshToken && freshToken !== token) {
      response = await postSocketTicket(request, freshToken);
    }
  }

  if (!response.ok) {
    throw new SocketTicketError(response.status);
  }

  const data = (await response.json()) as { ticket?: unknown };
  if (typeof data.ticket !== "string" || data.ticket.length === 0) {
    throw new Error("Socket ticket response was invalid");
  }
  return data.ticket;
}

export async function fetchSocketProtocols(
  request: SocketTicketRequest,
): Promise<string[]> {
  return buildSocketTicketProtocols(await requestSocketTicket(request));
}
