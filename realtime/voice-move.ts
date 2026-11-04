/**
 * Moderator voice moves between the worker route (POST /api/voice/move) and
 * the MeetingRoom Durable Objects. The route checks the mover; the objects
 * only carry the move out:
 *
 * - VOICE_MOVE_PATH on the source channel's room: sends each of the user's
 *   voice sessions a VoiceMove frame and ends it there (SessionReplaced).
 * - VOICE_MOVE_OUT_PATH on the global gateway: takes the user off the source
 *   channel's sidebar roster, so an offline or old client does not linger.
 */

import { Option, Schema } from "effect";

export const VOICE_MOVE_PATH = "/voice-move";
export const VOICE_MOVE_OUT_PATH = "/voice-move-out";

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

const VoiceMoveOutRequest = Schema.Struct({
  user_id: Id,
  channel_id: Id,
});

const decodeMove = Schema.decodeUnknownOption(VoiceMoveRequest);
const decodeMoveOut = Schema.decodeUnknownOption(VoiceMoveOutRequest);

export function parseVoiceMoveRequest(
  value: unknown,
): { userId: string; notice: VoiceMoveNotice } | null {
  const decoded = decodeMove(value);
  if (Option.isNone(decoded)) return null;
  return { userId: decoded.value.user_id, notice: decoded.value.notice };
}

export function parseVoiceMoveOutRequest(
  value: unknown,
): { userId: string; channelId: string } | null {
  const decoded = decodeMoveOut(value);
  if (Option.isNone(decoded)) return null;
  return { userId: decoded.value.user_id, channelId: decoded.value.channel_id };
}

export function serializeVoiceMoveRequest(
  userId: string,
  notice: VoiceMoveNotice,
): string {
  return JSON.stringify({ user_id: userId, notice });
}

export function serializeVoiceMoveOutRequest(
  userId: string,
  channelId: string,
): string {
  return JSON.stringify({ user_id: userId, channel_id: channelId });
}
