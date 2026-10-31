/**
 * Voice join grants: the MeetingRoom (chat, presence and the voice roster) is
 * the authority on who has joined a voice channel. A voice token only proves
 * who a participant is, so the VoiceRoom and the PartyTracks proxy also need a
 * join grant before they hand out tracks, accept publications or allow pulls.
 *
 * The MeetingRoom pushes a grant to the VoiceRoom as soon as a non-standby
 * Identify (or a standby promotion) arrives, before it waits on TURN, profile
 * or D1, and pushes a revocation when that session ends. The VoiceRoom keeps
 * the latest grant per participant; a voice Identify that races ahead of the
 * push waits for it instead of adding a pull round trip.
 */

/** MeetingRoom -> VoiceRoom: apply a grant or revocation. */
export const VOICE_JOIN_GRANT_PATH = "/voice-join-grant";
/** VoiceRoom -> MeetingRoom: fallback check when a push is missing. */
export const VOICE_JOIN_GRANT_CHECK_PATH = "/voice-join-grant-check";
/** PartyTracks proxy -> VoiceRoom: may this participant pull remote tracks? */
export const VOICE_MEDIA_AUTHORIZATION_PATH = "/voice-media-authorization";

/** How long a voice Identify or pull waits for the MeetingRoom's grant. */
export const VOICE_JOIN_GRANT_WAIT_MS = 10_000;
/** Revocation tombstones outlive any delayed grant push for the same id. */
const VOICE_JOIN_GRANT_TOMBSTONE_TTL_MS = 10 * 60 * 1000;

export interface VoiceJoinGrantUpdate {
  participantId: string;
  subject: string;
  granted: boolean;
  /** Monotonic per MeetingRoom; older updates never overwrite newer ones. */
  seq: number;
}

export interface VoiceJoinGrantQuery {
  participantId: string;
  subject: string;
}

const MAX_ID_LENGTH = 512;

function isId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH
  );
}

export function parseVoiceJoinGrantUpdate(
  value: unknown,
): VoiceJoinGrantUpdate | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (
    !isId(body.participant_id) ||
    !isId(body.subject) ||
    typeof body.granted !== "boolean" ||
    typeof body.seq !== "number" ||
    !Number.isSafeInteger(body.seq) ||
    body.seq < 0
  ) {
    return null;
  }
  return {
    participantId: body.participant_id,
    subject: body.subject,
    granted: body.granted,
    seq: body.seq,
  };
}

export function parseVoiceJoinGrantQuery(
  value: unknown,
): VoiceJoinGrantQuery | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (!isId(body.participant_id) || !isId(body.subject)) return null;
  return { participantId: body.participant_id, subject: body.subject };
}

export function serializeVoiceJoinGrantUpdate(update: VoiceJoinGrantUpdate) {
  return JSON.stringify({
    participant_id: update.participantId,
    subject: update.subject,
    granted: update.granted,
    seq: update.seq,
  });
}

export function serializeVoiceJoinGrantQuery(query: VoiceJoinGrantQuery) {
  return JSON.stringify({
    participant_id: query.participantId,
    subject: query.subject,
  });
}

/** Strictly increasing sequence numbers that stay ahead of wall time. */
export function createVoiceJoinGrantSequence(now: () => number = Date.now) {
  let last = 0;
  return () => {
    last = Math.max(now(), last + 1);
    return last;
  };
}

interface GrantSql {
  exec<T extends Record<string, unknown>>(
    query: string,
    ...params: unknown[]
  ): Iterable<T>;
}

export type VoiceJoinGrantState = "granted" | "revoked" | "unknown";

/** SQLite-backed latest grant per participant, owned by the VoiceRoom. */
export class VoiceJoinGrantStore {
  constructor(private readonly sql: GrantSql) {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS voice_join_grants (
        participant_id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        granted INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  state(participantId: string, subject: string): VoiceJoinGrantState {
    const row = [
      ...this.sql.exec(
        "SELECT subject, granted FROM voice_join_grants WHERE participant_id = ?",
        participantId,
      ),
    ][0];
    if (!row) return "unknown";
    if (Number(row.granted) !== 1) return "revoked";
    // A grant for a different subject never authorizes this one.
    return row.subject === subject ? "granted" : "revoked";
  }

  isGranted(participantId: string, subject: string): boolean {
    return this.state(participantId, subject) === "granted";
  }

  /** Returns false when a newer update for the participant already exists. */
  apply(update: VoiceJoinGrantUpdate, now = Date.now()): boolean {
    const rows = [
      ...this.sql.exec(
        `INSERT INTO voice_join_grants (participant_id, subject, granted, seq, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(participant_id) DO UPDATE SET
           subject = excluded.subject,
           granted = excluded.granted,
           seq = excluded.seq,
           updated_at = excluded.updated_at
         WHERE excluded.seq > voice_join_grants.seq
         RETURNING participant_id`,
        update.participantId,
        update.subject,
        update.granted ? 1 : 0,
        update.seq,
        now,
      ),
    ];
    return rows.length > 0;
  }

  /**
   * Records a grant confirmed by a MeetingRoom check without a sequence
   * number. It never overrides a pushed update, including a revocation.
   */
  recordConfirmed(query: VoiceJoinGrantQuery, now = Date.now()): boolean {
    const rows = [
      ...this.sql.exec(
        `INSERT INTO voice_join_grants (participant_id, subject, granted, seq, updated_at)
         VALUES (?, ?, 1, 0, ?)
         ON CONFLICT(participant_id) DO NOTHING
         RETURNING participant_id`,
        query.participantId,
        query.subject,
        now,
      ),
    ];
    return (
      rows.length > 0 || this.isGranted(query.participantId, query.subject)
    );
  }

  /**
   * Drops old revocation tombstones and grants that no longer back a voice
   * participant. A dropped grant is re-confirmed with the MeetingRoom.
   */
  prune(now: number, activeParticipantIds: ReadonlySet<string>): void {
    const cutoff = now - VOICE_JOIN_GRANT_TOMBSTONE_TTL_MS;
    const stale = [
      ...this.sql.exec(
        "SELECT participant_id FROM voice_join_grants WHERE updated_at <= ?",
        cutoff,
      ),
    ]
      .map((row) => row.participant_id as string)
      .filter((participantId) => !activeParticipantIds.has(participantId));
    for (const participantId of stale) {
      this.sql.exec(
        "DELETE FROM voice_join_grants WHERE participant_id = ?",
        participantId,
      );
    }
  }

  hasRows(): boolean {
    return (
      [...this.sql.exec("SELECT 1 AS present FROM voice_join_grants LIMIT 1")]
        .length > 0
    );
  }

  oldestUpdatedAt(): number | null {
    const row = [
      ...this.sql.exec(
        "SELECT MIN(updated_at) AS updated_at FROM voice_join_grants",
      ),
    ][0];
    return typeof row?.updated_at === "number" ? row.updated_at : null;
  }
}

/** In-memory wake-ups for requests waiting on a participant's grant. */
export class VoiceJoinGrantWaiters {
  private readonly waiters = new Map<string, Set<() => void>>();

  notify(participantId: string): void {
    const waiting = this.waiters.get(participantId);
    if (!waiting) return;
    this.waiters.delete(participantId);
    for (const wake of waiting) wake();
  }

  /**
   * Resolves when `decide` returns a verdict, re-evaluated after every
   * notification for the participant, or with `decide(true)` at the deadline.
   */
  wait(
    participantId: string,
    timeoutMs: number,
    decide: (final: boolean) => boolean | null,
  ): Promise<boolean> {
    const immediate = decide(false);
    if (immediate !== null) return Promise.resolve(immediate);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.waiters.get(participantId)?.delete(wake);
        resolve(value);
      };
      const wake = () => {
        const verdict = decide(false);
        if (verdict !== null) {
          settle(verdict);
          return;
        }
        this.add(participantId, wake);
      };
      const timer = setTimeout(() => settle(decide(true) === true), timeoutMs);
      this.add(participantId, wake);
    });
  }

  private add(participantId: string, wake: () => void) {
    let waiting = this.waiters.get(participantId);
    if (!waiting) {
      waiting = new Set();
      this.waiters.set(participantId, waiting);
    }
    waiting.add(wake);
  }
}
