// ============================================================================
// Call Store — Zustand
//
// Manages the lifecycle of 1:1 DM calls: idle → ringing → active → idle.
// Used by the gateway dispatch handler to update state on CALL_RING,
// CALL_RINGING, CALL_START, CALL_END events.
// ============================================================================

import { create } from "zustand";

export type CallStatus = "idle" | "ringing_outgoing" | "ringing_incoming" | "active";

export interface CallUser {
  id: string;
  username: string;
  avatar_url?: string;
}

export interface CallState {
  /** Current call lifecycle status */
  status: CallStatus;
  /** Unique ID for this call */
  callId: string | null;
  /** The remote user in the call */
  remoteUser: CallUser | null;
  /** DM channel ID */
  channelId: string | null;
  /** VoiceRoom slug for SFU connection */
  voiceRoomId: string | null;
  /** Timestamp when the call became active (for duration timer) */
  startedAt: number | null;
  /** Reason the call ended (for UI feedback) */
  endReason: string | null;
  /** True if the remote user has officially connected to the call at least once */
  hasConnected: boolean;
}

interface CallActions {
  /** Set incoming call state (callee received CALL_RING) */
  setIncomingCall: (callId: string, caller: CallUser, channelId: string) => void;
  /** Set outgoing call state (caller sent CallInitiate, got CALL_RINGING) */
  setOutgoingCall: (callId: string, callee: CallUser, channelId: string) => void;
  /** Transition to active call (both parties, on CALL_START) */
  setActive: (callId: string, voiceRoomId: string, remoteUser: CallUser, channelId: string, hasConnected: boolean) => void;
  /** Reset the startedAt timer when callee accepts the call */
  acceptCall: () => void;
  /** End the call and reset state */
  endCall: (reason?: string) => void;
  /** Stop the ringing avatar from rendering (e.g. if declined/missed, but we are in the call) */
  stopRinging: () => void;
  /** Full reset to idle */
  reset: () => void;
}

const initialState: CallState = {
  status: "idle",
  callId: null,
  remoteUser: null,
  channelId: null,
  voiceRoomId: null,
  startedAt: null,
  endReason: null,
  hasConnected: false,
};

export const useCallStore = create<CallState & CallActions>()((set, get) => ({
  ...initialState,

  setIncomingCall: (callId, caller, channelId) => {
    // Don't override an active call
    if (get().status === "active") return;
    set({
      status: "ringing_incoming",
      callId,
      remoteUser: caller,
      channelId,
      voiceRoomId: null,
      startedAt: null,
      endReason: null,
      hasConnected: false,
    });
  },

  setOutgoingCall: (callId, callee, channelId) => {
    if (get().status === "active") return;
    set({
      status: "ringing_outgoing",
      callId,
      remoteUser: callee,
      channelId,
      voiceRoomId: null,
      startedAt: null,
      endReason: null,
      hasConnected: false,
    });
  },

  setActive: (callId, voiceRoomId, remoteUser, channelId, hasConnected) => {
    set({
      status: "active",
      callId,
      voiceRoomId,
      remoteUser,
      channelId,
      startedAt: Date.now(),
      endReason: null,
      hasConnected,
    });
  },

  acceptCall: () => {
    set({ startedAt: Date.now(), hasConnected: true });
  },

  endCall: (reason) => {
    // Idempotent — skip if already idle to avoid unnecessary re-renders
    if (get().status === "idle") return;
    set({
      ...initialState,
      endReason: reason ?? null,
    });
  },

  stopRinging: () => set({ hasConnected: true }),

  reset: () => set(initialState),
}));
