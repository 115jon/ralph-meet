import type {
  RealtimeAccessMode,
  SocketTicketAudience,
  SocketTicketClaims,
} from "../src/lib/voice/socket-ticket";

const ADMISSION_HEADER_PREFIX = "x-ralph-realtime-";
const textEncoder = new TextEncoder();

export interface RealtimeAdmissionContext {
  accessMode: RealtimeAccessMode;
  audience: SocketTicketAudience;
  connectionGeneration: string;
  expiresAt: number;
  nonceDigest: string;
  roomSlug: string;
  subject: string;
}

export interface RealtimeAdmissionConfig {
  ticketSecret: string;
}

export type RealtimeAdmissionConfigResult =
  | { ok: true; config: RealtimeAdmissionConfig }
  | { ok: false; reason: "missing_ticket_secret" };

export function getRealtimeAdmissionConfig(env: {
  REALTIME_TICKET_SECRET?: string;
}): RealtimeAdmissionConfigResult {
  if (!env.REALTIME_TICKET_SECRET) {
    return { ok: false, reason: "missing_ticket_secret" };
  }

  return {
    ok: true,
    config: {
      ticketSecret: env.REALTIME_TICKET_SECRET,
    },
  };
}

export async function createRealtimeAdmissionContext(
  claims: SocketTicketClaims,
): Promise<RealtimeAdmissionContext> {
  return {
    accessMode: claims.accessMode,
    audience: claims.audience,
    connectionGeneration: crypto.randomUUID(),
    expiresAt: claims.expiresAt,
    nonceDigest: await digestNonce(claims.nonce),
    roomSlug: claims.roomSlug,
    subject: claims.subject,
  };
}

export async function digestNonce(nonce: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(nonce),
  );
  return base64UrlEncode(new Uint8Array(digest));
}

export function appendRealtimeAdmissionHeaders(
  headers: Headers,
  context: RealtimeAdmissionContext,
): Headers {
  const next = new Headers(headers);
  stripRealtimeAdmissionHeaders(next);
  next.set(`${ADMISSION_HEADER_PREFIX}access-mode`, context.accessMode);
  next.set(`${ADMISSION_HEADER_PREFIX}audience`, context.audience);
  next.set(
    `${ADMISSION_HEADER_PREFIX}connection-generation`,
    context.connectionGeneration,
  );
  next.set(`${ADMISSION_HEADER_PREFIX}expires-at`, String(context.expiresAt));
  next.set(`${ADMISSION_HEADER_PREFIX}nonce-digest`, context.nonceDigest);
  next.set(`${ADMISSION_HEADER_PREFIX}room-slug`, context.roomSlug);
  next.set(`${ADMISSION_HEADER_PREFIX}subject`, context.subject);
  return next;
}

export function stripRealtimeAdmissionHeaders(headers: Headers): Headers {
  for (const key of Array.from(headers.keys())) {
    if (key.toLowerCase().startsWith(ADMISSION_HEADER_PREFIX)) {
      headers.delete(key);
    }
  }
  return headers;
}

export function getRealtimeAdmissionFromHeaders(
  headers: Headers,
): RealtimeAdmissionContext | null {
  const accessMode = headers.get(`${ADMISSION_HEADER_PREFIX}access-mode`);
  const audience = headers.get(`${ADMISSION_HEADER_PREFIX}audience`);
  const connectionGeneration = headers.get(
    `${ADMISSION_HEADER_PREFIX}connection-generation`,
  );
  const expiresAtRaw = headers.get(`${ADMISSION_HEADER_PREFIX}expires-at`);
  const nonceDigest = headers.get(`${ADMISSION_HEADER_PREFIX}nonce-digest`);
  const roomSlug = headers.get(`${ADMISSION_HEADER_PREFIX}room-slug`);
  const subject = headers.get(`${ADMISSION_HEADER_PREFIX}subject`);
  const expiresAt = Number(expiresAtRaw);

  if (accessMode !== "authenticated" && accessMode !== "public-demo")
    return null;
  if (audience !== "global" && audience !== "room" && audience !== "voice")
    return null;
  if (
    !connectionGeneration ||
    !nonceDigest ||
    !roomSlug ||
    !subject ||
    !Number.isFinite(expiresAt)
  )
    return null;

  return {
    accessMode,
    audience,
    connectionGeneration,
    expiresAt,
    nonceDigest,
    roomSlug,
    subject,
  };
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
