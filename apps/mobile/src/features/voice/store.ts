import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

/** joining: sockets and media coming up; reconnecting: one of them dropped. */
export type CallStatus = "joining" | "connected" | "reconnecting";

export interface CallParticipant {
  /** The room's participant id (one per socket session). */
  readonly id: string;
  readonly userId: string | null;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly muted: boolean;
  readonly deafened: boolean;
}

export interface ActiveCall {
  readonly serverId: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly status: CallStatus;
  readonly muted: boolean;
  readonly deafened: boolean;
  /** Our participant id, once the room has admitted us. */
  readonly selfId: string | null;
  readonly participants: Readonly<Record<string, CallParticipant>>;
  /** Participant ids speaking now. */
  readonly speaking: Readonly<Record<string, true>>;
}

interface VoiceStoreState {
  readonly call: ActiveCall | null;
}

/** State only; the session and ./actions write it. */
export const useVoiceStore = create<VoiceStoreState>()(() => ({ call: null }));

export function updateCall(update: (call: ActiveCall) => ActiveCall): void {
  useVoiceStore.setState((state) =>
    state.call ? { call: update(state.call) } : state,
  );
}

// ── Selectors: narrow, so a tile re-renders only for its own participant ──

export interface CallSummary {
  readonly channelId: string;
  readonly channelName: string;
  readonly status: CallStatus;
  readonly muted: boolean;
  readonly deafened: boolean;
  readonly count: number;
}

/** What the app bar segment and the call header show, or null. */
export function useCallSummary(): CallSummary | null {
  return useVoiceStore(
    useShallow((s) =>
      s.call
        ? {
            channelId: s.call.channelId,
            channelName: s.call.channelName,
            status: s.call.status,
            muted: s.call.muted,
            deafened: s.call.deafened,
            count: Object.keys(s.call.participants).length,
          }
        : null,
    ),
  );
}

export function useInCall(): boolean {
  return useVoiceStore((s) => s.call !== null);
}

/** Participant ids, ours first, then by name. */
export function useParticipantIds(): readonly string[] {
  return useVoiceStore(
    useShallow((s) => {
      const call = s.call;
      if (!call) return [];
      return Object.values(call.participants)
        .sort((a, b) => {
          if (a.id === call.selfId) return -1;
          if (b.id === call.selfId) return 1;
          return a.name.localeCompare(b.name);
        })
        .map((p) => p.id);
    }),
  );
}

export function useParticipant(id: string): CallParticipant | null {
  return useVoiceStore((s) => s.call?.participants[id] ?? null);
}

export function useIsSelf(id: string): boolean {
  return useVoiceStore((s) => s.call?.selfId === id);
}

export function useIsSpeaking(id: string): boolean {
  return useVoiceStore((s) => s.call?.speaking[id] === true);
}
