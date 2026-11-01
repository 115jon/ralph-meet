import { useServersStore } from "@/features/servers/store";
import { useCallSummary, type CallSummary } from "@/features/voice/store";
import type { LedState } from "@/ui";

export interface CallRowState {
  /** "Connected", "Joining" or "Reconnecting". */
  label: string;
  /** The voice channel, then its server when the list knows it. */
  place: string;
  count: number;
  led: LedState;
  muted: boolean;
  deafened: boolean;
}

const STATUS_LABEL: Record<CallSummary["status"], string> = {
  joining: "Joining",
  connected: "Connected",
  reconnecting: "Reconnecting",
};

export function callStatusLabel(call: CallSummary): string {
  return STATUS_LABEL[call.status];
}

/** Live while connected; amber while joining or reconnecting. */
export function callLed(call: CallSummary): LedState {
  return call.status === "connected" ? "talk" : "idle";
}

/** The active call for the panel's call row, or null. */
export function useCallRow(): CallRowState | null {
  const call = useCallSummary();
  const serverName = useServersStore((s) =>
    call ? (s.servers.find((x) => x.id === call.serverId)?.name ?? null) : null,
  );
  if (!call) return null;
  return {
    label: callStatusLabel(call),
    place: serverName
      ? `${call.channelName} · ${serverName}`
      : call.channelName,
    count: call.count,
    led: callLed(call),
    muted: call.muted,
    deafened: call.deafened,
  };
}
