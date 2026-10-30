import {
  getDesktopToken,
  getStoredKovaAuthSessionToken,
} from "@/lib/desktop-auth";
import { KOVA_AUTH_PUBLISHABLE_KEY } from "@/lib/kova-auth-config";
import { getApiBaseUrl, isTauri } from "@/lib/platform";
import type { IceServer } from "@/lib/types";
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

/** A refused ticket request; `status` 401 means the session is gone. */
export class SocketTicketError extends Error {
  constructor(readonly status: number) {
    super(`Socket ticket request failed (${status})`);
    this.name = "SocketTicketError";
  }
}

export type MediaBootstrap = {
  participantId: string;
  voiceToken: string;
  iceServers?: IceServer[];
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
    throw new SocketTicketError(response.status);
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
  return {
    mediaBootstrap: parseMediaBootstrap(data.media_bootstrap),
    protocols,
  };
}

function parseMediaBootstrap(value: unknown): MediaBootstrap {
  if (
    value === null ||
    typeof value !== "object" ||
    !("participant_id" in value) ||
    typeof value.participant_id !== "string" ||
    !("voice_token" in value) ||
    typeof value.voice_token !== "string"
  ) {
    throw new Error("Socket ticket media bootstrap was invalid");
  }
  const iceServers =
    "ice_servers" in value ? parseIceServers(value.ice_servers) : undefined;
  return {
    participantId: value.participant_id,
    voiceToken: value.voice_token,
    ...(iceServers ? { iceServers } : {}),
  };
}

function parseIceServers(value: unknown): IceServer[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Socket ticket ICE servers were invalid");
  }
  return value.map((server) => {
    if (server === null || typeof server !== "object" || !("urls" in server)) {
      throw new Error("Socket ticket ICE servers were invalid");
    }
    const urls = server.urls;
    if (
      !Array.isArray(urls) ||
      urls.length === 0 ||
      urls.some((url) => typeof url !== "string" || url.length === 0)
    ) {
      throw new Error("Socket ticket ICE servers were invalid");
    }
    const parsed: IceServer = { urls };
    if ("username" in server && server.username !== undefined) {
      if (typeof server.username !== "string") {
        throw new Error("Socket ticket ICE servers were invalid");
      }
      parsed.username = server.username;
    }
    if ("credential" in server && server.credential !== undefined) {
      if (typeof server.credential !== "string") {
        throw new Error("Socket ticket ICE servers were invalid");
      }
      parsed.credential = server.credential;
    }
    return parsed;
  });
}

export async function fetchSocketProtocols(
  request: SocketTicketRequest,
): Promise<string[]> {
  return buildSocketTicketProtocols(await fetchSocketTicket(request));
}
