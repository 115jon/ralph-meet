import {
  isParticipantId,
  type RealtimeAccessMode,
  type SocketTicketAudience,
  type SocketTicketClaims,
  type SocketTicketMedia,
} from "../src/lib/voice/socket-ticket";

const ADMISSION_HEADER_PREFIX = "x-ralph-realtime-";
const textEncoder = new TextEncoder();

export interface RealtimeAdmissionContext {
  accessMode: RealtimeAccessMode;
  audience: SocketTicketAudience;
  expiresAt: number;
  nonceDigest: string;
  participantId: string;
  roomSlug: string;
  serverId?: string;
  channelId?: string;
  subject: string;
  /** Room sockets admitted by `/api/voice/admission` (SocketTicketMedia). */
  media?: SocketTicketMedia;
  /** Voice sockets admitted by `/api/voice/admission`: who must identify. */
  boundParticipantId?: string;
}

interface RealtimeAdmissionConfig {
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
    expiresAt: claims.expiresAt,
    nonceDigest: await digestNonce(claims.nonce),
    participantId: claims.nonce,
    roomSlug: claims.roomSlug,
    ...(claims.serverId ? { serverId: claims.serverId } : {}),
    ...(claims.channelId ? { channelId: claims.channelId } : {}),
    subject: claims.subject,
    ...(claims.media ? { media: claims.media } : {}),
    ...(claims.participant ? { boundParticipantId: claims.participant } : {}),
  };
}

async function digestNonce(nonce: string): Promise<string> {
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
  next.set(`${ADMISSION_HEADER_PREFIX}expires-at`, String(context.expiresAt));
  next.set(`${ADMISSION_HEADER_PREFIX}nonce-digest`, context.nonceDigest);
  next.set(`${ADMISSION_HEADER_PREFIX}participant-id`, context.participantId);
  next.set(`${ADMISSION_HEADER_PREFIX}room-slug`, context.roomSlug);
  if (context.serverId) {
    next.set(`${ADMISSION_HEADER_PREFIX}server-id`, context.serverId);
  }
  if (context.channelId) {
    next.set(`${ADMISSION_HEADER_PREFIX}channel-id`, context.channelId);
  }
  next.set(`${ADMISSION_HEADER_PREFIX}subject`, context.subject);
  if (context.media) {
    next.set(`${ADMISSION_HEADER_PREFIX}media`, context.media);
  }
  if (context.boundParticipantId) {
    next.set(
      `${ADMISSION_HEADER_PREFIX}bound-participant`,
      context.boundParticipantId,
    );
  }
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
  const expiresAtRaw = headers.get(`${ADMISSION_HEADER_PREFIX}expires-at`);
  const nonceDigest = headers.get(`${ADMISSION_HEADER_PREFIX}nonce-digest`);
  const participantId = headers.get(`${ADMISSION_HEADER_PREFIX}participant-id`);
  const roomSlug = headers.get(`${ADMISSION_HEADER_PREFIX}room-slug`);
  const serverId = headers.get(`${ADMISSION_HEADER_PREFIX}server-id`);
  const channelId = headers.get(`${ADMISSION_HEADER_PREFIX}channel-id`);
  const subject = headers.get(`${ADMISSION_HEADER_PREFIX}subject`);
  const media = headers.get(`${ADMISSION_HEADER_PREFIX}media`);
  const boundParticipantId = headers.get(
    `${ADMISSION_HEADER_PREFIX}bound-participant`,
  );
  const expiresAt = Number(expiresAtRaw);

  if (accessMode !== "authenticated" && accessMode !== "public-demo")
    return null;
  if (audience !== "global" && audience !== "room" && audience !== "voice")
    return null;
  if (
    !nonceDigest ||
    !participantId ||
    !roomSlug ||
    !subject ||
    !Number.isFinite(expiresAt)
  )
    return null;

  return {
    accessMode,
    audience,
    expiresAt,
    nonceDigest,
    participantId,
    roomSlug,
    ...(serverId ? { serverId } : {}),
    ...(channelId ? { channelId } : {}),
    subject,
    ...(media === "issued" || media === "held" ? { media } : {}),
    ...(isParticipantId(boundParticipantId) ? { boundParticipantId } : {}),
  };
}

/** The SQL surface the nonce store needs (a Durable Object's `storage.sql`). */
interface NonceSql {
  exec(query: string, ...bindings: unknown[]): unknown;
}

/**
 * The table the previous Worker version spends nonces in. Its rows carry a
 * NOT NULL `connection_generation` that nothing ever read, so this version
 * spends them in realtime_ticket_nonce_uses instead and retires this one.
 */
const RETIRED_NONCE_TABLE = "realtime_ticket_nonces";

/** Creates the single-use nonce table in the Durable Object that accepts sockets. */
export function initRealtimeTicketNonces(
  sql: NonceSql,
  now = Date.now(),
): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS realtime_ticket_nonce_uses (
      nonce_digest TEXT PRIMARY KEY,
      access_mode TEXT NOT NULL,
      audience TEXT NOT NULL,
      room_slug TEXT NOT NULL,
      subject TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER NOT NULL
    );
  `);
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_realtime_ticket_nonce_uses_expires ON realtime_ticket_nonce_uses(expires_at)",
  );
  // Carry over nonces the previous version spent that are still live, so a
  // ticket used just before the deploy cannot be used again after it, then
  // drop its table. After a rollback the previous version recreates that
  // table empty (CREATE IF NOT EXISTS) and never reads
  // realtime_ticket_nonce_uses, so a ticket spent under this version can be
  // replayed once until it expires (SOCKET_TICKET_TTL_MS, 60 s).
  try {
    sql.exec(
      `INSERT OR IGNORE INTO realtime_ticket_nonce_uses (
        nonce_digest, access_mode, audience, room_slug, subject, expires_at, consumed_at
      )
      SELECT nonce_digest, access_mode, audience, room_slug, subject, expires_at, consumed_at
      FROM ${RETIRED_NONCE_TABLE} WHERE expires_at > ?`,
      now,
    );
  } catch (error) {
    // No retired table: a new object, or one already migrated. Any other
    // failure must surface: dropping the table without carrying its live
    // nonces over would make those tickets replayable.
    if (isMissingTableError(error)) return;
    throw error;
  }
  sql.exec(`DROP TABLE IF EXISTS ${RETIRED_NONCE_TABLE}`);
}

/** Whether a SQLite error says a table does not exist. */
function isMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bno such table\b/i.test(message);
}

export type RealtimeAdmissionConsumeResult =
  | { ok: true }
  | { ok: false; reason: "expired" | "replayed" | "storage_error" };

/**
 * Uses up a socket ticket's nonce, once. Called by the Durable Object that
 * accepts the socket, in the same request: a ticket names one audience and
 * one room, and the worker routes each (audience, room) to exactly one
 * object, so that object's table is the only place the nonce can be spent.
 * The INSERT runs synchronously, so two upgrades racing with one ticket
 * cannot both get past it (the primary key refuses the second).
 */
export function consumeRealtimeTicketNonce(
  sql: NonceSql,
  admission: RealtimeAdmissionContext,
  now = Date.now(),
): RealtimeAdmissionConsumeResult {
  if (now >= admission.expiresAt) return { ok: false, reason: "expired" };
  try {
    sql.exec(
      `DELETE FROM realtime_ticket_nonce_uses WHERE expires_at <= ?`,
      now,
    );
    sql.exec(
      `INSERT INTO realtime_ticket_nonce_uses (
        nonce_digest,
        access_mode,
        audience,
        room_slug,
        subject,
        expires_at,
        consumed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      admission.nonceDigest,
      admission.accessMode,
      admission.audience,
      admission.roomSlug,
      admission.subject,
      admission.expiresAt,
      now,
    );
    return { ok: true };
  } catch (error) {
    // Only the primary-key conflict is a replay; any other storage error
    // still refuses the socket (fail closed) but must not read as one.
    return {
      ok: false,
      reason: /UNIQUE|PRIMARY KEY|constraint/i.test(String(error))
        ? "replayed"
        : "storage_error",
    };
  }
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
