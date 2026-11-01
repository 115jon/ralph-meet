// ── user_id, and its pre-rename name clerk_user_id ─────────────────────────
// Before the rename the user id was `clerk_user_id`, a leftover from the
// Clerk days. The rename ships in two phases (docs/user-id-rename.md):
//
// Phase 1 (now): everything reads `user_id`, falling back to `clerk_user_id`
// (normalizeUserIdField), and everything the Durable Objects write carries
// both names with the same value (withLegacyClerkUserId):
// - on the wire: VoiceState on the call sockets and voice channel members in
//   the chat socket's VOICE_CHANNEL_STATES / VOICE_CHANNEL_STATE_UPDATE, so
//   web tabs and mobile builds from before the rename keep working; the
//   decoders normalize at the socket edge, so app code sees only `user_id`;
// - in Durable Object storage: WebSocket attachments, resumable session
//   snapshots and vc:members lists, so a rollback to the previous Worker
//   version still finds `clerk_user_id`. VoiceRoom's participants table has
//   both columns for the same reason (voice-room.ts).
//
// Phase 2 removes every path marked TODO(user-id-rename phase 2).
//
// No Effect runtime modules: clients and the Durable Objects load this file.

/** The pre-rename name of `user_id`. Compatibility paths only. */
export const LEGACY_CLERK_USER_ID_FIELD = "clerk_user_id";

/**
 * The phase-1 switch: while true, every payload and stored record that has a
 * `user_id` also gets `clerk_user_id` (withLegacyClerkUserId), and VoiceRoom
 * writes both participants columns.
 *
 * TODO(user-id-rename phase 2): delete this constant and every path that
 * reads it or is marked with this TODO, once the minimum supported mobile
 * build reads `user_id`, the rollback window for this release has passed,
 * and replays buffered before it have expired. See docs/user-id-rename.md.
 */
export const LEGACY_CLERK_USER_ID_COMPAT = true;

type LegacyClerkUserId = { readonly [LEGACY_CLERK_USER_ID_FIELD]?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What the Durable Objects send and store: `record` plus `clerk_user_id` set
 * to its `user_id`, while LEGACY_CLERK_USER_ID_COMPAT is on. Records without
 * a user id are returned as is.
 */
export function withLegacyClerkUserId<T extends { readonly user_id?: string }>(
  record: T,
): T & LegacyClerkUserId {
  if (!LEGACY_CLERK_USER_ID_COMPAT || typeof record.user_id !== "string") {
    return record;
  }
  return { ...record, [LEGACY_CLERK_USER_ID_FIELD]: record.user_id };
}

/**
 * What clients decode and the Durable Objects restore: a record with
 * `user_id` taken from `user_id`, or from `clerk_user_id` when only that is
 * set (a pre-rename server or write, a replay buffered before the deploy),
 * and with `clerk_user_id` removed. Anything else is returned as is.
 *
 * TODO(user-id-rename phase 2): the `clerk_user_id` fallback.
 */
export function normalizeUserIdField<T>(value: T): T {
  if (!isRecord(value) || !(LEGACY_CLERK_USER_ID_FIELD in value)) return value;
  const { [LEGACY_CLERK_USER_ID_FIELD]: legacy, ...rest } = value;
  const userId =
    typeof rest.user_id === "string"
      ? rest.user_id
      : typeof legacy === "string"
        ? legacy
        : undefined;
  return (userId === undefined ? rest : { ...rest, user_id: userId }) as T;
}

/** normalizeUserIdField over a list; anything but an array is unchanged. */
export function normalizeUserIdFields<T>(value: T): T {
  return (
    Array.isArray(value)
      ? value.map((item) => normalizeUserIdField(item))
      : value
  ) as T;
}

/**
 * The chat socket's voice channel events with every member normalized
 * (normalizeUserIdField). Other events are returned as is.
 */
export function normalizeVoiceDispatchUserIds<
  T extends { readonly event: string; readonly data?: unknown },
>(d: T): T {
  const data = d.data;
  if (!isRecord(data)) return d;
  switch (d.event) {
    case "VOICE_CHANNEL_STATES": {
      const states = data.voice_states;
      if (!isRecord(states)) return d;
      const voice_states: Record<string, unknown> = {};
      for (const [channelId, members] of Object.entries(states)) {
        voice_states[channelId] = normalizeUserIdFields(members);
      }
      return { ...d, data: { ...data, voice_states } };
    }
    case "VOICE_CHANNEL_STATE_UPDATE":
      if (!Array.isArray(data.members)) return d;
      return {
        ...d,
        data: { ...data, members: normalizeUserIdFields(data.members) },
      };
    default:
      return d;
  }
}
