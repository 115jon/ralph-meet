/**
 * Moderator voice moves between the worker route (POST /api/voice/move) and
 * the MeetingRoom Durable Objects. The route checks the mover; the objects
 * only carry the move out:
 *
 * - VOICE_MOVE_PATH on the source channel's room: sends each of the user's
 *   voice sessions a VoiceMove frame and ends it there (SessionReplaced).
 *   The room's roster push then takes them off the sidebar
 *   (realtime/VOICE_ROSTER.md); no separate global-gateway step.
 */

import { Option, Schema } from "effect";

export const VOICE_MOVE_PATH = "/voice-move";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
const Name = Schema.NullOr(Schema.String.check(Schema.isMaxLength(256)));

/** What the moved client is told: the VoiceMove frame's `d`. */
const VoiceMoveNotice = Schema.Struct({
  channel_id: Id,
  server_id: Id,
  channel_name: Name,
  mover_name: Name,
  grant: Schema.String.check(Schema.isMaxLength(4096)),
  grant_expires_at: Schema.Number,
});

export type VoiceMoveNotice = typeof VoiceMoveNotice.Type;

const VoiceMoveRequest = Schema.Struct({
  user_id: Id,
  notice: VoiceMoveNotice,
});

const decodeMove = Schema.decodeUnknownOption(VoiceMoveRequest);

export function parseVoiceMoveRequest(
  value: unknown,
): { userId: string; notice: VoiceMoveNotice } | null {
  const decoded = decodeMove(value);
  if (Option.isNone(decoded)) return null;
  return { userId: decoded.value.user_id, notice: decoded.value.notice };
}

export function serializeVoiceMoveRequest(
  userId: string,
  notice: VoiceMoveNotice,
): string {
  return JSON.stringify({ user_id: userId, notice });
}

// ── Grant liveness (global gateway) ─────────────────────────────────────────
// The signature only proves who and where. The global gateway, one object for
// every user, keeps each user's latest move grant and spends it once per use,
// so a later move (B -> C) kills the earlier grant (B), and a copied grant
// cannot be replayed into tickets.

/** Route -> global gateway: this is now the user's only live move grant. */
export const VOICE_MOVE_GRANT_PATH = "/voice-move-grant";
/** Ticket route -> global gateway: spend the grant for one ticket. */
export const VOICE_MOVE_GRANT_USE_PATH = "/voice-move-grant-use";

/** What a grant may be spent on, once each. */
export type VoiceMoveGrantUse = "room" | "voice" | "join";

const VoiceMoveGrantRecord = Schema.Struct({
  user_id: Id,
  jti: Id,
  channel_id: Id,
  expires_at: Schema.Number,
});

const VoiceMoveGrantUseRequest = Schema.Struct({
  user_id: Id,
  jti: Id,
  channel_id: Id,
  use: Schema.Literals(["room", "voice"]),
});

export type VoiceMoveGrantRecord = typeof VoiceMoveGrantRecord.Type;
export type VoiceMoveGrantUseRequest = typeof VoiceMoveGrantUseRequest.Type;

const decodeGrantRecord = Schema.decodeUnknownOption(VoiceMoveGrantRecord);
const decodeGrantUse = Schema.decodeUnknownOption(VoiceMoveGrantUseRequest);

export function parseVoiceMoveGrantRecord(
  value: unknown,
): VoiceMoveGrantRecord | null {
  const decoded = decodeGrantRecord(value);
  return Option.isNone(decoded) ? null : decoded.value;
}

export function parseVoiceMoveGrantUse(
  value: unknown,
): VoiceMoveGrantUseRequest | null {
  const decoded = decodeGrantUse(value);
  return Option.isNone(decoded) ? null : decoded.value;
}

interface GrantSql {
  exec(query: string, ...params: unknown[]): Iterable<Record<string, unknown>>;
}

/** SQLite-backed latest move grant per user, owned by the global gateway. */
export class VoiceMoveGrantLedger {
  constructor(private readonly sql: GrantSql) {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS voice_move_grants (
        user_id TEXT PRIMARY KEY,
        jti TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS voice_move_grant_uses (
        jti TEXT NOT NULL,
        use TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (jti, use)
      )
    `);
  }

  /** Makes this the user's only live grant; an earlier one stops working. */
  record(grant: VoiceMoveGrantRecord, now = Date.now()): void {
    this.sql.exec("DELETE FROM voice_move_grants WHERE expires_at <= ?", now);
    this.sql.exec(
      "DELETE FROM voice_move_grant_uses WHERE expires_at <= ?",
      now,
    );
    this.sql.exec(
      `INSERT INTO voice_move_grants (user_id, jti, channel_id, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         jti = excluded.jti,
         channel_id = excluded.channel_id,
         expires_at = excluded.expires_at`,
      grant.user_id,
      grant.jti,
      grant.channel_id,
      grant.expires_at,
    );
  }

  /**
   * Spends the grant for `use`: true once, while it is the user's latest
   * grant for `channelId` and unexpired; false after that.
   */
  spend(
    userId: string,
    jti: string,
    channelId: string,
    use: VoiceMoveGrantUse,
    now = Date.now(),
  ): boolean {
    const row = [
      ...this.sql.exec(
        "SELECT jti, channel_id, expires_at FROM voice_move_grants WHERE user_id = ?",
        userId,
      ),
    ][0];
    if (
      !row ||
      row.jti !== jti ||
      row.channel_id !== channelId ||
      now >= Number(row.expires_at)
    ) {
      return false;
    }
    const spent = [
      ...this.sql.exec(
        `INSERT INTO voice_move_grant_uses (jti, use, expires_at)
         VALUES (?, ?, ?)
         ON CONFLICT(jti, use) DO NOTHING
         RETURNING jti`,
        jti,
        use,
        Number(row.expires_at),
      ),
    ];
    return spent.length > 0;
  }
}
