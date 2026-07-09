const SOCKET_TICKET_VERSION = "v1";
const textEncoder = new TextEncoder();
const ticketTokenPattern = /^[A-Za-z0-9_-]+$/;
const roomSlugPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

export type SocketTicketAudience = "global" | "room" | "voice";

export interface SocketTicketClaims {
  audience: SocketTicketAudience;
  expiresAt: number;
  nonce: string;
  roomSlug: string;
  subject: string;
}

export interface SocketTicketVerificationContext {
  audience: SocketTicketAudience;
  now: number;
  roomSlug: string;
}

export type SocketTicketVerification =
  | { ok: true; claims: SocketTicketClaims }
  | {
    ok: false;
    reason: "audience_mismatch" | "expired" | "invalid" | "room_mismatch";
  };

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

function isValidClaims(value: SocketTicketClaims): boolean {
  return (
    isSocketTicketAudience(value.audience)
    && Number.isFinite(value.expiresAt)
    && value.expiresAt > 0
    && roomSlugPattern.test(value.roomSlug)
    && ticketTokenPattern.test(value.nonce)
    && value.nonce.length >= 8
    && ticketTokenPattern.test(value.subject)
    && value.subject.length >= 1
  );
}

function parseClaims(bytes: Uint8Array): SocketTicketClaims | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isRecord(value)) return null;

    const claims: SocketTicketClaims = {
      audience: value.audience as SocketTicketAudience,
      expiresAt: value.expiresAt as number,
      nonce: value.nonce as string,
      roomSlug: value.roomSlug as string,
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
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(value));
  return new Uint8Array(signature);
}

async function verify(value: string, signature: Uint8Array, secret: string): Promise<boolean> {
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
