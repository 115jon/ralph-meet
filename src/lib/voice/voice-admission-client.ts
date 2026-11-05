// The call sockets' admission: one POST /api/voice/admission per join proves
// the user once and returns the room ticket, the voice ticket and the
// participant's voice token and TURN (realtime/ADMISSION.md). RoomGateway
// and VoiceGateway each take their half of that one response; a reconnect
// asks for only the socket that needs a new ticket.

import { recoverAppSession } from "@/lib/app-session-recovery";
import {
  getDesktopToken,
  getStoredKovaAuthSessionToken,
} from "@/lib/desktop-auth";
import { KOVA_AUTH_PUBLISHABLE_KEY } from "@/lib/kova-auth-config";
import { getApiBaseUrl, isTauri } from "@/lib/platform";
import type { IceServer } from "@/lib/types";
import { buildSocketTicketProtocols } from "@/lib/voice/socket-ticket";
import { SocketTicketError } from "@/lib/voice/socket-ticket-client";
import { voiceMoveGrantFor } from "@/lib/voice/voice-move-grants";

/** Which call a socket is for. */
export type CallAdmissionTarget = {
  roomSlug: string;
  channelId?: string;
  serverId?: string;
};

export type CallSocket = "room" | "voice";

/** A participant's voice credentials, as the admission minted them. */
export type MediaBootstrap = {
  participantId: string;
  voiceToken: string;
  iceServers?: IceServer[];
};

export type VoiceAdmission = {
  participantId?: string;
  roomTicket?: string;
  voiceTicket?: string;
  media?: MediaBootstrap;
};

type AdmissionOptions = {
  sockets: readonly CallSocket[];
  media: boolean;
  participantId?: string;
  /** Join requests carry a move grant; hover prefetches never do. */
  withMoveGrant: boolean;
};

function postAdmission(
  body: Record<string, unknown>,
  token: string | null,
): Promise<Response> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (isTauri() && KOVA_AUTH_PUBLISHABLE_KEY) {
    headers.set("X-Publishable-Key", KOVA_AUTH_PUBLISHABLE_KEY);
  }
  return fetch(`${getApiBaseUrl()}/api/voice/admission`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * One admission. A 401 asks Kova for a fresh app token (shared with every
 * other refused call, see app-session-recovery) and tries once more with it.
 * A 401 that survives that is the socket's to count (SocketTicketError).
 */
export async function requestVoiceAdmission(
  target: CallAdmissionTarget,
  options: AdmissionOptions,
): Promise<VoiceAdmission> {
  // Moved here by a moderator: the grant stands in for CONNECT. The server
  // spends it once per use, so a hover prefetch never carries it.
  const moveGrant = options.withMoveGrant
    ? voiceMoveGrantFor(target.channelId)
    : undefined;
  const body = {
    roomSlug: target.roomSlug,
    ...(target.channelId ? { channelId: target.channelId } : {}),
    ...(target.serverId ? { serverId: target.serverId } : {}),
    sockets: options.sockets,
    media: options.media,
    ...(options.participantId ? { participantId: options.participantId } : {}),
    ...(moveGrant ? { moveGrant } : {}),
  };
  const token = getDesktopToken() ?? getStoredKovaAuthSessionToken();
  let response = await postAdmission(body, token);
  if (response.status === 401) {
    const freshToken = await recoverAppSession(token);
    if (freshToken && freshToken !== token) {
      response = await postAdmission(body, freshToken);
    }
  }
  if (!response.ok) throw new SocketTicketError(response.status);
  return parseAdmission(await response.json(), options);
}

function parseAdmission(
  value: unknown,
  options: AdmissionOptions,
): VoiceAdmission {
  if (value === null || typeof value !== "object") {
    throw new Error("Voice admission response was invalid");
  }
  const data = value as Record<string, unknown>;
  const ticket = (key: string, wanted: boolean) => {
    if (!wanted) return undefined;
    const raw = data[key];
    if (typeof raw !== "string" || raw.length === 0) {
      throw new Error("Voice admission response was invalid");
    }
    return raw;
  };
  return {
    ...(typeof data.participant_id === "string"
      ? { participantId: data.participant_id }
      : {}),
    roomTicket: ticket("room_ticket", options.sockets.includes("room")),
    voiceTicket: ticket("voice_ticket", options.sockets.includes("voice")),
    ...(options.media ? { media: parseMediaBootstrap(data.media) } : {}),
  };
}

export function parseMediaBootstrap(value: unknown): MediaBootstrap {
  if (
    value === null ||
    typeof value !== "object" ||
    !("participant_id" in value) ||
    typeof value.participant_id !== "string" ||
    !("voice_token" in value) ||
    typeof value.voice_token !== "string"
  ) {
    throw new Error("Voice admission media was invalid");
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
    throw new Error("Voice admission ICE servers were invalid");
  }
  return value.map((server) => {
    if (server === null || typeof server !== "object" || !("urls" in server)) {
      throw new Error("Voice admission ICE servers were invalid");
    }
    const urls = server.urls;
    if (
      !Array.isArray(urls) ||
      urls.length === 0 ||
      urls.some((url) => typeof url !== "string" || url.length === 0)
    ) {
      throw new Error("Voice admission ICE servers were invalid");
    }
    const parsed: IceServer = { urls };
    if ("username" in server && server.username !== undefined) {
      if (typeof server.username !== "string") {
        throw new Error("Voice admission ICE servers were invalid");
      }
      parsed.username = server.username;
    }
    if ("credential" in server && server.credential !== undefined) {
      if (typeof server.credential !== "string") {
        throw new Error("Voice admission ICE servers were invalid");
      }
      parsed.credential = server.credential;
    }
    return parsed;
  });
}

// ── Prefetch ────────────────────────────────────────────────────────────────

/**
 * Admissions fetched ahead of a join (hovering or pressing a voice channel,
 * its landing on screen) so the click does not start with this round trip.
 * Tickets are single use and the server gives them 60 s; one older than
 * {@link PREFETCH_MAX_AGE_MS} is dropped and fetched fresh.
 */
export const PREFETCH_MAX_AGE_MS = 40_000;

type Pending = { promise: Promise<VoiceAdmission>; fetchedAt: number };

const prefetched = new Map<string, Pending>();

function targetKey(target: CallAdmissionTarget): string {
  return JSON.stringify([
    target.roomSlug,
    target.channelId ?? "",
    target.serverId ?? "",
  ]);
}

const JOIN: AdmissionOptions = {
  sockets: ["room", "voice"],
  media: true,
  withMoveGrant: false,
};

/**
 * Prefetches the admission for joining a server voice channel. Repeats
 * within {@link PREFETCH_MAX_AGE_MS} reuse the one already fetched, so this
 * is cheap to call on every hover.
 */
export function prefetchVoiceChannelJoin(target: {
  serverId: string;
  channelId: string;
  roomSlug?: string;
}): void {
  prefetchVoiceAdmission({
    channelId: target.channelId,
    roomSlug: target.roomSlug || `voice-${target.serverId}-${target.channelId}`,
    serverId: target.serverId,
  });
}

export function prefetchVoiceAdmission(target: CallAdmissionTarget): void {
  const key = targetKey(target);
  const now = Date.now();
  const existing = prefetched.get(key);
  if (existing && now - existing.fetchedAt < PREFETCH_MAX_AGE_MS) return;
  const promise = requestVoiceAdmission(target, JOIN);
  prefetched.set(key, { promise, fetchedAt: now });
  // A failed prefetch (no CONNECT, 429, 401) stays cached until it ages out,
  // so hovering again does not repeat it; the join falls back to a fresh
  // request.
  promise.catch(() => {});
}

/** A fresh prefetched admission for this target (consumed), else null. */
function takePrefetched(target: CallAdmissionTarget): Pending | null {
  const key = targetKey(target);
  const entry = prefetched.get(key);
  if (!entry) return null;
  prefetched.delete(key);
  if (Date.now() - entry.fetchedAt >= PREFETCH_MAX_AGE_MS) return null;
  // A failed prefetch falls back to the join's own request.
  return {
    promise: entry.promise.catch(() => requestVoiceAdmission(target, MOVED)),
    fetchedAt: entry.fetchedAt,
  };
}

const MOVED: AdmissionOptions = { ...JOIN, withMoveGrant: true };

// ── Joins ───────────────────────────────────────────────────────────────────

/** One join's admission: each socket takes its ticket from it once. */
type Join = {
  key: string;
  target: CallAdmissionTarget;
  startedAt: number;
  pending: Pending | null;
  taken: Set<CallSocket>;
};

const joins = new Map<string, Join>();

/**
 * A join is starting (or switching rooms): the next room and voice tickets
 * for `target` come from one admission (prefetched if there is one).
 */
export function beginCallAdmission(target: CallAdmissionTarget): void {
  joins.set(target.roomSlug, {
    key: targetKey(target),
    target,
    startedAt: Date.now(),
    pending: null,
    taken: new Set(),
  });
}

/** This target's join admission while `socket`'s half is fresh and untaken. */
function openJoin(
  target: CallAdmissionTarget,
  socket: CallSocket,
): Pending | null {
  const join = joins.get(target.roomSlug);
  if (!join || join.key !== targetKey(target) || join.taken.has(socket)) {
    return null;
  }
  join.pending ??= takePrefetched(target) ?? {
    promise: requestVoiceAdmission(target, MOVED),
    fetchedAt: Date.now(),
  };
  if (Date.now() - join.pending.fetchedAt >= PREFETCH_MAX_AGE_MS) {
    joins.delete(target.roomSlug);
    return null;
  }
  join.taken.add(socket);
  if (join.taken.size === 2) joins.delete(target.roomSlug);
  return join.pending;
}

export type RoomSocketAdmission = {
  protocols: string[];
  /** Only a join's first ticket brings credentials (see ADMISSION.md). */
  mediaBootstrap?: MediaBootstrap;
};

/**
 * The room socket's ticket: the join's admission the first time, then one
 * room-only request per reconnect. Those mint nothing: a Resume keeps the
 * credentials the client holds, and an Identify (a new participant) gets
 * them in MediaReady.
 */
export async function takeRoomSocketTicket(
  target: CallAdmissionTarget,
): Promise<RoomSocketAdmission> {
  const join = openJoin(target, "room");
  if (join) {
    const admission = await join.promise;
    if (admission.roomTicket) {
      return {
        protocols: buildSocketTicketProtocols(admission.roomTicket),
        ...(admission.media ? { mediaBootstrap: admission.media } : {}),
      };
    }
  }
  const admission = await requestVoiceAdmission(target, {
    sockets: ["room"],
    media: false,
    withMoveGrant: true,
  });
  return {
    protocols: buildSocketTicketProtocols(requireTicket(admission.roomTicket)),
  };
}

/**
 * The voice socket's ticket, bound to `participantId` when known: the join's
 * admission the first time (bound to the participant it minted), then one
 * voice-only request per reconnect.
 */
export async function takeVoiceSocketTicket(
  target: CallAdmissionTarget,
  participantId: string | null,
): Promise<string[]> {
  const join = openJoin(target, "voice");
  if (join) {
    const admission = await join.promise;
    if (
      admission.voiceTicket &&
      (participantId === null || admission.participantId === participantId)
    ) {
      return buildSocketTicketProtocols(admission.voiceTicket);
    }
  }
  const admission = await requestVoiceAdmission(target, {
    sockets: ["voice"],
    media: false,
    ...(participantId ? { participantId } : {}),
    withMoveGrant: true,
  });
  return buildSocketTicketProtocols(requireTicket(admission.voiceTicket));
}

function requireTicket(ticket: string | undefined): string {
  if (!ticket) throw new Error("Voice admission response was invalid");
  return ticket;
}

export function clearVoiceAdmissionsForTests(): void {
  prefetched.clear();
  joins.clear();
}
