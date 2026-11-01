import { Schema } from "effect";

// The gateway's DM call events (realtime/meeting-room.ts handleCallInitiate
// and friends), the parts the app reads.

const OptionalText = Schema.optional(Schema.NullOr(Schema.String));

/** CALL_RING: someone is calling us. */
export const CallRingEventSchema = Schema.Struct({
  call_id: Schema.String,
  caller_id: Schema.String,
  caller_name: OptionalText,
  caller_username: OptionalText,
  caller_display_name: OptionalText,
  caller_avatar: OptionalText,
  channel_id: Schema.String,
});

/** CALL_RINGING: our call is ringing them. */
export const CallRingingEventSchema = Schema.Struct({
  call_id: Schema.String,
  callee_id: Schema.String,
  channel_id: Schema.String,
});

/**
 * CALL_RING_STOP: accepted, declined, timeout, cancelled, abandoned,
 * disconnected, expired; busy, unavailable and invalid (call_id null) when
 * the ring never started.
 */
export const CallRingStopEventSchema = Schema.Struct({
  call_id: Schema.NullOr(Schema.String),
  reason: Schema.String,
});
export type CallRingStopEvent = typeof CallRingStopEventSchema.Type;
