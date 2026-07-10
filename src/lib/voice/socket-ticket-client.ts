import {
  getDesktopToken,
  getStoredKovaAuthSessionToken,
} from "@/lib/desktop-auth";
import { KOVA_AUTH_PUBLISHABLE_KEY } from "@/lib/kova-auth-config";
import { getApiBaseUrl, isTauri } from "@/lib/platform";
import {
  buildSocketTicketProtocols,
  type SocketTicketAudience,
} from "@/lib/voice/socket-ticket";

export type SocketTicketRequest = {
  audience: SocketTicketAudience;
  channelId?: string;
  roomSlug?: string;
  serverId?: string;
};

type SocketTicketResponse = {
  ticket?: unknown;
};

export async function fetchSocketTicket(
  request: SocketTicketRequest,
): Promise<string> {
  const token = getDesktopToken() ?? getStoredKovaAuthSessionToken();
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (isTauri() && KOVA_AUTH_PUBLISHABLE_KEY) {
    headers.set("X-Publishable-Key", KOVA_AUTH_PUBLISHABLE_KEY);
  }

  const response = await fetch(`${getApiBaseUrl()}/api/voice/socket-ticket`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Socket ticket request failed (${response.status})`);
  }

  const data = (await response.json()) as SocketTicketResponse;
  if (typeof data.ticket !== "string" || data.ticket.length === 0) {
    throw new Error("Socket ticket response was invalid");
  }

  return data.ticket;
}

export async function fetchSocketProtocols(
  request: SocketTicketRequest,
): Promise<string[]> {
  return buildSocketTicketProtocols(await fetchSocketTicket(request));
}
