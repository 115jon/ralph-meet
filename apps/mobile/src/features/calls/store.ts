import { create } from "zustand";

// DM calls on this phone, before (and around) the voice call itself: the
// call ringing us, and the ring we started. Once a call is answered it is
// an ordinary voice call in features/voice; this store only holds rings.

export interface CallPeer {
  readonly id: string;
  readonly name: string;
  /** As stored: may be an API-relative /api/... path. */
  readonly avatarUrl: string | null;
}

/** A call ringing this phone, shown by the app's own sheet while in front. */
export interface IncomingRing {
  readonly callId: string;
  readonly channelId: string;
  readonly caller: CallPeer;
}

/**
 * Our ring, as DMCallRegion shows it: starting (sent, no answer from the
 * server yet), ringing, or over without an answer. "No answer" and
 * "declined" keep us in the DM's call (the server's lobby) to ring again.
 */
export type OutgoingPhase = "starting" | "ringing" | "no-answer" | "declined";

export interface OutgoingRing {
  readonly channelId: string;
  readonly peer: CallPeer;
  readonly callId: string | null;
  readonly phase: OutgoingPhase;
  /** When the current ring began (epoch ms), for the ring clock. */
  readonly since: number;
}

interface CallsState {
  readonly incoming: IncomingRing | null;
  readonly outgoing: OutgoingRing | null;
  /** A missed-call "Call back" asked to ring this DM; its page picks it up. */
  readonly callBack: string | null;
  /** When the other person joined the DM call we're in (the region's clock). */
  readonly connectedAt: number | null;
}

const INITIAL: CallsState = {
  incoming: null,
  outgoing: null,
  callBack: null,
  connectedAt: null,
};

/** State only; ./actions changes it. */
export const useCallsStore = create<CallsState>()(() => INITIAL);

export function resetCallsStore(): void {
  useCallsStore.setState(INITIAL);
}

export function useIncomingRing(): IncomingRing | null {
  return useCallsStore((s) => s.incoming);
}

/** Our ring in `channelId`, if that is where it is. */
export function useOutgoingRing(channelId: string): OutgoingRing | null {
  return useCallsStore((s) =>
    s.outgoing?.channelId === channelId ? s.outgoing : null,
  );
}
