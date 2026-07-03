export type RtcRoomPresenceStatus = "online" | "idle" | "dnd" | "offline";

export interface RtcRoomControlPostWriteSession {
  name: string;
  clerk_user_id?: string;
}

export interface RtcRoomControlPostWriteEffectsAdapter {
  getSession(ws: WebSocket): RtcRoomControlPostWriteSession | undefined;
  queuePresenceWrite(clerkUserId: string, status: RtcRoomPresenceStatus): void;
  broadcastPresenceStatus(clerkUserId: string, status: RtcRoomPresenceStatus): void;
  addChannelSubscription(channelId: string, ws: WebSocket): void;
  removeChannelSubscription(channelId: string, ws: WebSocket): void;
  addServerSubscription(serverId: string, ws: WebSocket): void;
  getOnlineClerkUserIds(): string[];
  sendPresenceList(ws: WebSocket, userIds: string[]): void;
  queueVoiceChannelStates(ws: WebSocket): void;
  logInfo(message: string): void;
}

export function applyRtcRoomPresenceUpdate(
  adapter: RtcRoomControlPostWriteEffectsAdapter,
  ws: WebSocket,
  status: RtcRoomPresenceStatus,
) {
  const session = adapter.getSession(ws);
  if (!session?.clerk_user_id) return false;

  adapter.queuePresenceWrite(session.clerk_user_id, status);
  adapter.broadcastPresenceStatus(session.clerk_user_id, status);
  return true;
}

export function applyRtcRoomChannelSubscribe(
  adapter: RtcRoomControlPostWriteEffectsAdapter,
  ws: WebSocket,
  payload: { channel_id: string },
) {
  const session = adapter.getSession(ws);
  if (!session || !payload.channel_id) return false;

  adapter.addChannelSubscription(payload.channel_id, ws);
  adapter.sendPresenceList(ws, adapter.getOnlineClerkUserIds());
  adapter.queueVoiceChannelStates(ws);
  adapter.logInfo(`${session.name} subscribed to channel ${payload.channel_id}`);
  return true;
}

export function applyRtcRoomChannelUnsubscribe(
  adapter: RtcRoomControlPostWriteEffectsAdapter,
  ws: WebSocket,
  payload: { channel_id: string },
) {
  const session = adapter.getSession(ws);
  if (!session || !payload.channel_id) return false;

  adapter.removeChannelSubscription(payload.channel_id, ws);
  return true;
}

export function applyRtcRoomServerSubscribe(
  adapter: RtcRoomControlPostWriteEffectsAdapter,
  ws: WebSocket,
  payload: { server_id: string },
) {
  const session = adapter.getSession(ws);
  if (!session || !payload.server_id || !session.clerk_user_id) return false;

  adapter.addServerSubscription(payload.server_id, ws);
  adapter.logInfo(`${session.name} subscribed to server ${payload.server_id}`);
  return true;
}
