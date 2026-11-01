import type { CallRecord } from "@ralph/protocol";

/**
 * A call record as the DM list's last line: short, from the viewer's side.
 * The full sentence is the timeline row's (describeCallRecord).
 */
export function callPreview(
  record: CallRecord,
  viewerId: string | null | undefined,
): string {
  const viewerCalled = viewerId === record.caller_id;
  switch (record.outcome) {
    case "missed":
      return viewerCalled ? "You called · no answer" : "Missed call";
    case "declined":
      return viewerCalled ? "Call declined" : "You declined a call";
    case "ended":
      return viewerCalled ? "You called" : "Called you";
  }
}

/** The reasons a ring stopped without being answered or declined. */
export function isMissedRingStop(reason: string): boolean {
  return (
    reason === "timeout" ||
    reason === "cancelled" ||
    reason === "abandoned" ||
    reason === "disconnected"
  );
}

/** What the caller is told when the ring never started. */
export function unreachableText(reason: string, name: string): string | null {
  switch (reason) {
    case "busy":
      return `${name} is in another call`;
    case "unavailable":
      return `${name} can't take calls right now`;
    case "invalid":
      return "That call can't be made";
    default:
      return null;
  }
}
