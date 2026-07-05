import type { PendingCall, RtcRoomDisconnectCallCleanup } from "./meeting-room";

export function findPendingCallForUser(
  pendingCalls: Map<string, PendingCall>,
  userId: string,
): PendingCall | null {
  for (const pending of pendingCalls.values()) {
    if (pending.callerId === userId || pending.calleeId === userId) {
      return pending;
    }
  }
  return null;
}

export function markAcceptedCall(
  acceptedCalls: Map<string, number>,
  callId: string,
  expiresAt: number,
) {
  acceptedCalls.set(callId, expiresAt);
  return expiresAt;
}

export function hasAcceptedCall(
  acceptedCalls: Map<string, number>,
  callId: string,
  now = Date.now(),
) {
  const expiresAt = acceptedCalls.get(callId);
  if (expiresAt === undefined) return false;
  if (expiresAt <= now) {
    acceptedCalls.delete(callId);
    return false;
  }
  return true;
}

export function takePendingCallForAcceptance(
  pendingCalls: Map<string, PendingCall>,
  acceptedCalls: Map<string, number>,
  calleeId: string,
  matches: (pending: PendingCall) => boolean,
  acceptedExpiresAt: number,
) {
  const pending = pendingCalls.get(calleeId);
  if (!pending || !matches(pending)) return null;

  acceptedCalls.set(pending.callId, acceptedExpiresAt);
  pendingCalls.delete(calleeId);
  return pending;
}

export function preparePendingCallAcceptForVoiceJoin(
  pendingCalls: Map<string, PendingCall>,
  acceptedCalls: Map<string, number>,
  clerkUserId: string,
  channelId: string,
  acceptedCallTtlMs: number,
  now = Date.now(),
) {
  return takePendingCallForAcceptance(
    pendingCalls,
    acceptedCalls,
    clerkUserId,
    (pending) => pending.channelId === channelId,
    now + acceptedCallTtlMs,
  );
}

export function preparePendingCallAcceptByCallId(
  pendingCalls: Map<string, PendingCall>,
  acceptedCalls: Map<string, number>,
  calleeId: string,
  callId: string,
  acceptedCallTtlMs: number,
  now = Date.now(),
) {
  return takePendingCallForAcceptance(
    pendingCalls,
    acceptedCalls,
    calleeId,
    (pending) => pending.callId === callId,
    now + acceptedCallTtlMs,
  );
}

export function prepareAbandonedPendingCallForChannel(
  pendingCalls: Map<string, PendingCall>,
  channelId: string,
) {
  for (const [calleeId, pending] of pendingCalls) {
    if (pending.channelId !== channelId) continue;
    pendingCalls.delete(calleeId);
    return pending;
  }
  return null;
}

export function prepareDisconnectCallCleanup(
  pendingCalls: Map<string, PendingCall>,
  userId: string,
  reason: string,
): RtcRoomDisconnectCallCleanup | null {
  const notifications: Array<{ userId: string; callId: string }> = [];

  const pendingAsCallee = pendingCalls.get(userId);
  if (pendingAsCallee) {
    pendingCalls.delete(userId);
    notifications.push({
      userId: pendingAsCallee.callerId,
      callId: pendingAsCallee.callId,
    });
  }

  for (const [calleeId, pending] of pendingCalls) {
    if (pending.callerId !== userId) continue;
    pendingCalls.delete(calleeId);
    notifications.push({
      userId: calleeId,
      callId: pending.callId,
    });
  }

  if (notifications.length === 0) return null;
  return { reason, notifications };
}

export function expirePendingCalls(
  pendingCalls: Map<string, PendingCall>,
  now: number,
) {
  const expired: PendingCall[] = [];
  for (const [calleeId, pending] of pendingCalls) {
    if (pending.expiresAt > now) continue;
    pendingCalls.delete(calleeId);
    expired.push(pending);
  }
  return expired;
}

export function pruneExpiredAcceptedCalls(
  acceptedCalls: Map<string, number>,
  now: number,
) {
  let changed = false;
  for (const [callId, expiresAt] of acceptedCalls) {
    if (expiresAt > now) continue;
    acceptedCalls.delete(callId);
    changed = true;
  }
  return changed;
}
