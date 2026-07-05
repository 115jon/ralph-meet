import type { RtcRoomControlSessionEffectsSession } from "./rtc-room-control-session-effects";

export type RtcRoomControlDisconnectEffectsSession =
  RtcRoomControlSessionEffectsSession & { voice_joined_at?: number };

export interface RtcRoomControlDisconnectEffectsAdapter<
  Session extends RtcRoomControlDisconnectEffectsSession = RtcRoomControlDisconnectEffectsSession,
> {
  hasConcurrentControlSession(ws: WebSocket, clerkUserId: string): boolean;
  broadcast(message: { op: number; d: unknown }, excludeWs?: WebSocket): void;
  buildVoiceState(session: Session): unknown;
  cleanupChannelSubscriptions(ws: WebSocket): void;
  cleanupServerSubscriptions(ws: WebSocket): void;
  deleteLiveControlSession(ws: WebSocket, participantId: string): void;
  clearResumableControlState(participantId: string): void;
  closeSocket(ws: WebSocket, code: number, reason: string): void;
}

export function applyRtcRoomControlDisconnectEffects<
  Session extends RtcRoomControlDisconnectEffectsSession,
>(
  adapter: RtcRoomControlDisconnectEffectsAdapter<Session>,
  ws: WebSocket,
  session: Session,
  options: {
    intentional: boolean;
    closeSocket?: boolean;
    closeCode?: number;
    closeReason?: string;
    emitLeaveBroadcast?: boolean;
  },
) {
  const intentional = options.intentional === true;
  const closeSocket = options.closeSocket ?? true;
  const closeCode = options.closeCode ?? 1000;
  const closeReason = options.closeReason ?? "Left room";
  const emitLeaveBroadcast = options.emitLeaveBroadcast ?? true;

  if (
    session.clerk_user_id
    && !adapter.hasConcurrentControlSession(ws, session.clerk_user_id)
  ) {
    adapter.broadcast(
      {
        op: 19,
        d: {
          event: "PRESENCE_UPDATE",
          data: {
            user_id: session.clerk_user_id,
            status: "offline",
          },
        },
      },
      ws,
    );
  }

  adapter.cleanupChannelSubscriptions(ws);
  adapter.cleanupServerSubscriptions(ws);

  adapter.deleteLiveControlSession(ws, session.id);
  adapter.clearResumableControlState(session.id);

  if (intentional && emitLeaveBroadcast) {
    adapter.broadcast(
      {
        op: 15,
        d: {
          participant: adapter.buildVoiceState(session),
          action: "leave",
        },
      },
      ws,
    );
  }

  if (closeSocket) {
    adapter.closeSocket(ws, closeCode, closeReason);
  }

  return true;
}
