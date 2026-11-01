import { useCallSummary, type CallSummary } from "@/features/voice/store";
import type { LedState } from "@/ui";

export interface CallSegmentState {
  channel: string;
  status: string;
  led: LedState;
  muted: boolean;
}

/** The head-count, or where the call is when it is not up. */
export function callStatusText(call: CallSummary): string {
  if (call.status === "joining") return "Joining";
  if (call.status === "reconnecting") return "Reconnecting";
  return `${call.count} in call`;
}

/** Live while connected; amber while joining or reconnecting. */
export function callLed(call: CallSummary): LedState {
  return call.status === "connected" ? "talk" : "idle";
}

/** The active call to show in the app bar, or null. */
export function useCallSegment(): CallSegmentState | null {
  const call = useCallSummary();
  if (!call) return null;
  return {
    channel: call.channelName,
    status: callStatusText(call),
    led: callLed(call),
    muted: call.muted,
  };
}
