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
  display_name?: string | null;
  avatar_url?: string | null;
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
  /** True if the local user has actively opted into connecting to the SFU */
  hasJoinedSFU: boolean;
}

interface CallActions {
  /**
   * Transition to ringing incoming.
   */
  setIncomingCall: (payload: { callId: string; remoteUser: NonNullable<CallState["remoteUser"]>; channelId: string; voiceRoomId: string }) => void;
  /**
   * Transition to ringing outgoing.
   */
  setOutgoingCall: (payload: { callId: string; remoteUser: NonNullable<CallState["remoteUser"]>; channelId: string; voiceRoomId: string }) => void;
  /** Explicitly join the SFU room */
  joinSFU: () => void;
  /** Reset the startedAt timer when callee accepts the call */
  acceptCall: () => void;
  /** Leave the call SFU but keep call metadata visible (like leaving a voice channel — shows "Join" button) */
  leaveCall: () => void;
  /** End the call and reset state */
  endCall: (reason?: string) => void;
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
  hasJoinedSFU: false,
};

export const useCallStore = create<CallState & CallActions>()((set, get) => ({
  ...initialState,

  setIncomingCall: (payload) => {
    // Don't override an active call
    if (get().status === "active") return;
    set({
      status: "ringing_incoming",
      callId: payload.callId,
      remoteUser: payload.remoteUser,
      channelId: payload.channelId,
      voiceRoomId: payload.voiceRoomId,
      startedAt: null,
      endReason: null,
      hasConnected: false,
      hasJoinedSFU: false,
    });
  },

  setOutgoingCall: (payload) => {
    if (get().status === "active") return;
    set({
      status: "ringing_outgoing",
      callId: payload.callId,
      remoteUser: payload.remoteUser,
      channelId: payload.channelId,
      voiceRoomId: payload.voiceRoomId,
      startedAt: null,
      endReason: null,
      hasConnected: false,
      hasJoinedSFU: false,
    });
  },

  joinSFU: () => set({ hasJoinedSFU: true }),

  acceptCall: () => {
    set({ status: "active", startedAt: Date.now(), hasConnected: true, hasJoinedSFU: true });
  },

  leaveCall: () => {
    // Keep call metadata visible (status stays "active") but disconnect from SFU.
    // The user sees the call dashboard with a "Join" button, just like a voice channel.
    if (get().status !== "active") return;
    set({ hasJoinedSFU: false });
  },

  endCall: (reason) => {
    // Idempotent — skip if already idle to avoid unnecessary re-renders
    if (get().status === "idle") return;
    set({
      ...initialState,
      endReason: reason ?? null,
    });
  },

  reset: () => set(initialState),
}));
