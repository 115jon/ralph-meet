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
  media_bootstrap?: unknown;
  ticket?: unknown;
};

export type MediaBootstrap = {
  participantId: string;
  voiceToken: string;
};

export type SocketTicketBundle = {
  mediaBootstrap?: MediaBootstrap;
  protocols: string[];
};

async function requestSocketTicket(
  request: SocketTicketRequest,
): Promise<SocketTicketResponse> {
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

  return (await response.json()) as SocketTicketResponse;
}

function requireTicket(data: SocketTicketResponse): string {
  if (typeof data.ticket !== "string" || data.ticket.length === 0) {
    throw new Error("Socket ticket response was invalid");
  }

  return data.ticket;
}

export async function fetchSocketTicket(
  request: SocketTicketRequest,
): Promise<string> {
  return requireTicket(await requestSocketTicket(request));
}

export async function fetchSocketTicketBundle(
  request: SocketTicketRequest,
): Promise<SocketTicketBundle> {
  const data = await requestSocketTicket(request);
  const protocols = buildSocketTicketProtocols(requireTicket(data));
  if (data.media_bootstrap === undefined) return { protocols };
  if (
    data.media_bootstrap === null ||
    typeof data.media_bootstrap !== "object" ||
    !("participant_id" in data.media_bootstrap) ||
    typeof data.media_bootstrap.participant_id !== "string" ||
    !("voice_token" in data.media_bootstrap) ||
    typeof data.media_bootstrap.voice_token !== "string"
  ) {
    throw new Error("Socket ticket media bootstrap was invalid");
  }
  return {
    mediaBootstrap: {
      participantId: data.media_bootstrap.participant_id,
      voiceToken: data.media_bootstrap.voice_token,
    },
    protocols,
  };
}

export async function fetchSocketProtocols(
  request: SocketTicketRequest,
): Promise<string[]> {
  return buildSocketTicketProtocols(await fetchSocketTicket(request));
}
