import { Schema } from "effect";

// A DM call's outcome, saved as a system message (`type: "call"`) so every
// client shows missed, declined and ended calls in the conversation. The
// message's author is the caller; its `content` is a plain-text fallback
// for clients that do not know the type.

export const CallOutcome = Schema.Literals(["missed", "declined", "ended"]);
export type CallOutcome = typeof CallOutcome.Type;

export const CallRecordSchema = Schema.Struct({
  call_id: Schema.String,
  outcome: CallOutcome,
  caller_id: Schema.String,
  callee_id: Schema.String,
  /** Seconds from answer to hang-up; ended calls only. */
  duration_s: Schema.optional(Schema.Number),
});
export type CallRecord = typeof CallRecordSchema.Type;

/** `type` on a message that is a call record. */
export const CALL_MESSAGE_TYPE = "call";

/** 0:07, 4:12, 1:02:03. */
export function formatCallDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** The stored `content`: what an older client shows in place of the row. */
export function callRecordFallbackText(record: CallRecord): string {
  switch (record.outcome) {
    case "missed":
      return "Missed call";
    case "declined":
      return "Declined call";
    case "ended":
      return `Call · ${formatCallDuration(record.duration_s ?? 0)}`;
  }
}

export interface CallRecordLine {
  /** missed: a danger glyph and a Call back key for the person called. */
  readonly tone: "missed" | "neutral";
  readonly text: string;
  /** The duration of an ended call, drawn in the number face. */
  readonly duration: string | null;
}

/**
 * The row's words as `viewerId` sees them. `callerName` and `calleeName`
 * are display names; the viewer's own side reads "You".
 */
export function describeCallRecord(
  record: CallRecord,
  viewerId: string | null | undefined,
  names: { readonly callerName: string; readonly calleeName: string },
): CallRecordLine {
  const viewerCalled = viewerId === record.caller_id;
  switch (record.outcome) {
    case "missed":
      return viewerCalled
        ? {
            tone: "neutral",
            text: `You called ${names.calleeName} · no answer`,
            duration: null,
          }
        : {
            tone: "missed",
            text: `Missed call from ${names.callerName}`,
            duration: null,
          };
    case "declined":
      return viewerCalled
        ? {
            tone: "neutral",
            text: `${names.calleeName} declined your call`,
            duration: null,
          }
        : {
            tone: "neutral",
            text: `You declined a call from ${names.callerName}`,
            duration: null,
          };
    case "ended":
      return {
        tone: "neutral",
        text: viewerCalled ? "You called" : `${names.callerName} called`,
        duration: formatCallDuration(record.duration_s ?? 0),
      };
  }
}
