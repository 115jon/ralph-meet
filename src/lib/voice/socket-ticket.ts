const SOCKET_TICKET_VERSION = "rt1";
/** The realtime subprotocol every socket negotiates (the ticket rides beside it). */
export const SOCKET_PROTOCOL_NAME = "ralph.realtime.v1";
const SOCKET_TICKET_PROTOCOL_PREFIX = "ralph.ticket.";
const textEncoder = new TextEncoder();
const ticketTokenPattern = /^[A-Za-z0-9_-]+$/;
const roomSlugPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

export type RealtimeAccessMode = "authenticated" | "public-demo";
export type SocketTicketAudience = "global" | "room" | "voice";

export interface SocketTicketClaims {
  accessMode: RealtimeAccessMode;
  audience: SocketTicketAudience;
  expiresAt: number;
  nonce: string;
  roomSlug: string;
  serverId?: string;
  /**
   * The channel a room or voice ticket is for (authenticated tickets). The
   * room reports its voice roster for this channel to the global gateway.
   */
  channelId?: string;
  subject: string;
}

export interface SocketTicketVerificationContext {
  accessMode?: RealtimeAccessMode;
  audience: SocketTicketAudience;
  now: number;
  roomSlug: string;
}

interface SocketTicketProtocolResult {
  responseProtocol: string;
  ticket: string;
}

export type SocketTicketVerification =
  | { ok: true; claims: SocketTicketClaims }
  | {
      ok: false;
      reason:
        | "audience_mismatch"
        | "expired"
        | "invalid"
        | "mode_mismatch"
        | "room_mismatch";
    };

export type SocketTicketProtocolParseResult =
  | { ok: true; value: SocketTicketProtocolResult }
  | { ok: false; reason: "invalid" | "missing" | "multiple" };

export async function issueSocketTicket(
  claims: SocketTicketClaims,
  secret: string,
): Promise<string> {
  if (!isValidClaims(claims) || !secret) {
    throw new Error("Cannot issue an invalid socket ticket");
  }

  const payload = base64UrlEncode(textEncoder.encode(JSON.stringify(claims)));
  const signedValue = `${SOCKET_TICKET_VERSION}.${payload}`;
  const signature = await sign(signedValue, secret);

  return `${signedValue}.${base64UrlEncode(signature)}`;
}

export async function verifySocketTicket(
  ticket: string,
  secret: string,
  context: SocketTicketVerificationContext,
): Promise<SocketTicketVerification> {
  if (!secret || typeof ticket !== "string") {
    return { ok: false, reason: "invalid" };
  }

  const parts = ticket.split(".");
  if (parts.length !== 3 || parts[0] !== SOCKET_TICKET_VERSION) {
    return { ok: false, reason: "invalid" };
  }

  const [version, encodedPayload, encodedSignature] = parts;
  const payloadBytes = base64UrlDecode(encodedPayload);
  const signatureBytes = base64UrlDecode(encodedSignature);
  if (!payloadBytes || !signatureBytes) {
    return { ok: false, reason: "invalid" };
  }

  const signedValue = `${version}.${encodedPayload}`;
  if (!(await verify(signedValue, signatureBytes, secret))) {
    return { ok: false, reason: "invalid" };
  }

  const claims = parseClaims(payloadBytes);
  if (!claims) {
    return { ok: false, reason: "invalid" };
  }
  if (context.accessMode && context.accessMode !== claims.accessMode) {
    return { ok: false, reason: "mode_mismatch" };
  }
  if (context.now >= claims.expiresAt) {
    return { ok: false, reason: "expired" };
  }
  if (context.audience !== claims.audience) {
    return { ok: false, reason: "audience_mismatch" };
  }
  if (context.roomSlug !== claims.roomSlug) {
    return { ok: false, reason: "room_mismatch" };
  }

  return { ok: true, claims };
}

/**
 * Signs `claims` in the ticket's `<version>.<payload>.<signature>` format.
 * The version is part of the signed value, so a token minted for one
 * purpose (another version) never verifies as another.
 */
export async function sealSignedToken(
  version: string,
  claims: Record<string, unknown>,
  secret: string,
): Promise<string> {
  if (!secret || !ticketTokenPattern.test(version)) {
    throw new Error("Cannot seal a token without a secret and version");
  }
  const payload = base64UrlEncode(textEncoder.encode(JSON.stringify(claims)));
  const signedValue = `${version}.${payload}`;
  return `${signedValue}.${base64UrlEncode(await sign(signedValue, secret))}`;
}

/** The claims of a token sealed with `version` and `secret`, else null. */
export async function openSignedToken(
  version: string,
  token: unknown,
  secret: string,
): Promise<Record<string, unknown> | null> {
  if (!secret || typeof token !== "string" || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== version) return null;
  const [, encodedPayload, encodedSignature] = parts;
  const payloadBytes = base64UrlDecode(encodedPayload);
  const signatureBytes = base64UrlDecode(encodedSignature);
  if (!payloadBytes || !signatureBytes) return null;
  if (!(await verify(`${version}.${encodedPayload}`, signatureBytes, secret))) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(payloadBytes));
    return isRecord(value) && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function buildSocketTicketProtocols(ticket: string): string[] {
  if (typeof ticket !== "string" || ticket.length === 0) {
    throw new Error("Cannot build WebSocket protocols without a ticket");
  }
  return [SOCKET_PROTOCOL_NAME, `${SOCKET_TICKET_PROTOCOL_PREFIX}${ticket}`];
}

export function parseSocketTicketProtocols(
  header: string | null,
): SocketTicketProtocolParseResult {
  if (!header) return { ok: false, reason: "missing" };

  const protocols = header
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  let hasRealtimeProtocol = false;
  let ticket: string | null = null;
  for (const protocol of protocols) {
    if (protocol === SOCKET_PROTOCOL_NAME) {
      if (hasRealtimeProtocol) return { ok: false, reason: "multiple" };
      hasRealtimeProtocol = true;
      continue;
    }
    if (protocol.startsWith(SOCKET_TICKET_PROTOCOL_PREFIX)) {
      if (ticket !== null) return { ok: false, reason: "multiple" };
      ticket = protocol.slice(SOCKET_TICKET_PROTOCOL_PREFIX.length);
      continue;
    }
    return { ok: false, reason: "invalid" };
  }

  if (!hasRealtimeProtocol || !ticket) return { ok: false, reason: "missing" };
  if (ticket.length > 4096) return { ok: false, reason: "invalid" };

  return {
    ok: true,
    value: {
      responseProtocol: SOCKET_PROTOCOL_NAME,
      ticket,
    },
  };
}

function isValidClaims(value: SocketTicketClaims): boolean {
  return (
    isSocketTicketAudience(value.audience) &&
    isRealtimeAccessMode(value.accessMode) &&
    Number.isFinite(value.expiresAt) &&
    value.expiresAt > 0 &&
    roomSlugPattern.test(value.roomSlug) &&
    ticketTokenPattern.test(value.nonce) &&
    value.nonce.length >= 8 &&
    ticketTokenPattern.test(value.subject) &&
    value.subject.length >= 1 &&
    (value.serverId === undefined ||
      (typeof value.serverId === "string" &&
        roomSlugPattern.test(value.serverId))) &&
    (value.channelId === undefined ||
      (typeof value.channelId === "string" &&
        roomSlugPattern.test(value.channelId)))
  );
}

function parseClaims(bytes: Uint8Array): SocketTicketClaims | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isRecord(value)) return null;

    const claims: SocketTicketClaims = {
      accessMode: value.accessMode as RealtimeAccessMode,
      audience: value.audience as SocketTicketAudience,
      expiresAt: value.expiresAt as number,
      nonce: value.nonce as string,
      roomSlug: value.roomSlug as string,
      ...(value.serverId !== undefined
        ? { serverId: value.serverId as string }
        : {}),
      ...(value.channelId !== undefined
        ? { channelId: value.channelId as string }
        : {}),
      subject: value.subject as string,
    };

    return isValidClaims(claims) ? claims : null;
  } catch {
    return null;
  }
}

function isSocketTicketAudience(value: unknown): value is SocketTicketAudience {
  return value === "global" || value === "room" || value === "voice";
}

function isRealtimeAccessMode(value: unknown): value is RealtimeAccessMode {
  return value === "authenticated" || value === "public-demo";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function sign(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(value),
  );
  return new Uint8Array(signature);
}

async function verify(
  value: string,
  signature: Uint8Array,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    toArrayBuffer(signature),
    textEncoder.encode(value),
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!ticketTokenPattern.test(value)) return null;

  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}
