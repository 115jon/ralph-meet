import type { RtcRoomPresenceStatus } from "./rtc-room-control-post-write-effects";

export interface PendingPresenceWrite {
  status: RtcRoomPresenceStatus;
  dueAt: number;
}

export const RTC_ROOM_PENDING_PRESENCE_KEY_PREFIX = "presence:pending:";
export const RTC_ROOM_PRESENCE_DEBOUNCE_MS = 2_000;

export function buildRtcRoomPendingPresenceWrite(
  status: RtcRoomPresenceStatus,
  now = Date.now(),
): PendingPresenceWrite {
  return {
    status,
    dueAt: now + RTC_ROOM_PRESENCE_DEBOUNCE_MS,
  };
}

export function getRtcRoomPendingPresenceStorageKey(clerkUserId: string) {
  return `${RTC_ROOM_PENDING_PRESENCE_KEY_PREFIX}${clerkUserId}`;
}

export function getRtcRoomPendingPresenceClerkUserId(storageKey: string) {
  if (!storageKey.startsWith(RTC_ROOM_PENDING_PRESENCE_KEY_PREFIX)) return null;
  const clerkUserId = storageKey.slice(RTC_ROOM_PENDING_PRESENCE_KEY_PREFIX.length);
  return clerkUserId || null;
}

export async function persistRtcRoomPresenceStatusToD1(
  env: { DB: D1Database; CACHE: KVNamespace },
  clerkUserId: string,
  status: RtcRoomPresenceStatus,
) {
  await env.DB.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, new Date().toISOString(), clerkUserId)
    .run();

  const { results } = await env.DB.prepare("SELECT server_id FROM server_members WHERE user_id = ?")
    .bind(clerkUserId)
    .all();

  if (!results) return;

  await Promise.allSettled(results.map((row) => {
    const serverId = row.server_id as string;
    return env.CACHE.delete(`v1:server:members:${serverId}`);
  }));
}
