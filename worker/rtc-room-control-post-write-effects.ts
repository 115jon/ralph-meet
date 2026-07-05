export type RtcRoomPresenceStatus = "online" | "idle" | "dnd" | "offline";

export interface RtcRoomControlPostWriteSession {
  name: string;
  clerk_user_id?: string;
}

export interface RtcRoomControlPostWriteEffectsAdapter {
  queuePresenceWrite(clerkUserId: string, status: RtcRoomPresenceStatus): void;
  broadcastPresenceStatus(clerkUserId: string, status: RtcRoomPresenceStatus): void;
  addChannelSubscription(channelId: string, ws: WebSocket): void;
  removeChannelSubscription(channelId: string, ws: WebSocket): void;
  addServerSubscription(serverId: string, ws: WebSocket): void;
  sendPresenceList(ws: WebSocket, userIds: string[]): void;
  queueVoiceChannelStates(ws: WebSocket, clerkUserId: string): void;
  logInfo(message: string): void;
}

export function applyRtcRoomPresenceUpdate(
  adapter: RtcRoomControlPostWriteEffectsAdapter,
  session: RtcRoomControlPostWriteSession | null | undefined,
  status: RtcRoomPresenceStatus,
) {
  if (!session?.clerk_user_id) return false;

  adapter.queuePresenceWrite(session.clerk_user_id, status);
  adapter.broadcastPresenceStatus(session.clerk_user_id, status);
  return true;
}

export function applyRtcRoomChannelSubscribe(
  adapter: RtcRoomControlPostWriteEffectsAdapter,
  ws: WebSocket,
  session: RtcRoomControlPostWriteSession | null | undefined,
  payload: { channel_id: string },
  onlineClerkUserIds: string[],
) {
  if (!session || !payload.channel_id) return false;

  adapter.addChannelSubscription(payload.channel_id, ws);
  adapter.sendPresenceList(ws, onlineClerkUserIds);
  if (session.clerk_user_id) {
    adapter.queueVoiceChannelStates(ws, session.clerk_user_id);
  }
  adapter.logInfo(`${session.name} subscribed to channel ${payload.channel_id}`);
  return true;
}

export function applyRtcRoomChannelUnsubscribe(
  adapter: RtcRoomControlPostWriteEffectsAdapter,
  ws: WebSocket,
  session: RtcRoomControlPostWriteSession | null | undefined,
  payload: { channel_id: string },
) {
  if (!session || !payload.channel_id) return false;

  adapter.removeChannelSubscription(payload.channel_id, ws);
  return true;
}

export function applyRtcRoomServerSubscribe(
  adapter: RtcRoomControlPostWriteEffectsAdapter,
  ws: WebSocket,
  session: RtcRoomControlPostWriteSession | null | undefined,
  payload: { server_id: string },
) {
  if (!session || !payload.server_id || !session.clerk_user_id) return false;

  adapter.addServerSubscription(payload.server_id, ws);
  adapter.logInfo(`${session.name} subscribed to server ${payload.server_id}`);
  return true;
}
