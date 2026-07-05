import type { PendingCall } from "./meeting-room";

const RTC_CALL_DISPATCH_OP = 19;

export function buildCallRingStopMessage(callId: string | null, reason: string) {
  return {
    op: RTC_CALL_DISPATCH_OP,
    d: {
      event: "CALL_RING_STOP",
      data: {
        call_id: callId,
        reason,
      },
    },
  };
}

export function buildIncomingPendingCallMessage(pending: PendingCall) {
  return {
    op: RTC_CALL_DISPATCH_OP,
    d: {
      event: "CALL_RING",
      data: {
        call_id: pending.callId,
        caller_id: pending.callerId,
        caller_name: pending.callerName,
        caller_username: pending.callerUsername,
        caller_display_name: pending.callerDisplayName,
        caller_avatar: pending.callerAvatar,
        channel_id: pending.channelId,
      },
    },
  };
}

export function buildOutgoingPendingCallRingingMessage(pending: PendingCall) {
  return {
    op: RTC_CALL_DISPATCH_OP,
    d: {
      event: "CALL_RINGING",
      data: {
        call_id: pending.callId,
        callee_id: pending.calleeId,
        callee_name: pending.calleeName,
        callee_username: pending.calleeUsername,
        callee_display_name: pending.calleeDisplayName,
        callee_avatar: pending.calleeAvatar,
        channel_id: pending.channelId,
      },
    },
  };
}
