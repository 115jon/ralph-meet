import {
  decodeChatGatewayServerFrame,
  GatewayOp,
  type ChatGatewayServerMessage,
  type MainClientPayload,
} from "@ralph/protocol";
import {
  CHAT_SOCKET_POLICY,
  RealtimeSocket,
  type OutboundFrame,
} from "@ralph/realtime";
import { create } from "zustand";

import { acquireGatewayTicket, type GatewayTicket } from "./ticket";

// The chat socket on /api/gateway: the same lifecycle (tickets, heartbeat,
// backoff, wake) and wire protocol as the web chat store, from
// @ralph/realtime and @ralph/protocol. This module keeps the session side:
// Identify on Hello, subscriptions after Ready, and a bus that hands each
// Dispatch event to the features that care. It always identifies afresh
// (no Resume): after a reconnect the features refetch what they show.

export type GatewayStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "signed-out";

const useGatewayStore = create<{ status: GatewayStatus }>()(() => ({
  status: "idle",
}));

export function useGatewayStatus(): GatewayStatus {
  return useGatewayStore((s) => s.status);
}

function setStatus(status: GatewayStatus): void {
  useGatewayStore.setState({ status });
}

type DispatchListener = (event: string, data: unknown) => void;
type ReadyListener = () => void;

const dispatchListeners = new Set<DispatchListener>();
const readyListeners = new Set<ReadyListener>();

/** Calls `listener` with every Dispatch event; returns the unsubscribe. */
export function onDispatch(listener: DispatchListener): () => void {
  dispatchListeners.add(listener);
  return () => dispatchListeners.delete(listener);
}

/** Calls `listener` after every Ready, the first and each reconnect. */
export function onGatewayReady(listener: ReadyListener): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

let userId: string | null = null;
let serverIds: readonly string[] = [];
let channelId: string | null = null;

function send(frame: OutboundFrame): void {
  if (socket.isReady) socket.sendJson(frame);
}

/**
 * The server takes the user from the ticket. A phone asks for full voice
 * members (no supports_voice_state_deltas): it only lists who is in a room.
 */
const IDENTIFY: MainClientPayload<GatewayOp.Identify> = {
  name: "ChatClient",
  platform: "mobile",
};

function handleMessage(message: ChatGatewayServerMessage): void {
  switch (message.op) {
    case GatewayOp.Hello:
      // The lifecycle has started the heartbeat from this Hello.
      if (userId) socket.sendJson({ op: GatewayOp.Identify, d: IDENTIFY });
      return;
    case GatewayOp.Ready:
      socket.markReady();
      setStatus("ready");
      for (const id of serverIds) {
        send({ op: GatewayOp.ServerSubscribe, d: { server_id: id } });
      }
      if (channelId) {
        send({ op: GatewayOp.ChannelSubscribe, d: { channel_id: channelId } });
      }
      for (const listener of readyListeners) listener();
      return;
    case GatewayOp.Dispatch:
      for (const listener of dispatchListeners) {
        listener(message.d.event, message.d.data);
      }
      return;
    default:
      return;
  }
}

const socket = new RealtimeSocket<ChatGatewayServerMessage, GatewayTicket>({
  label: "ChatGW",
  policy: CHAT_SOCKET_POLICY,
  decode: decodeChatGatewayServerFrame,
  acquireTicket: acquireGatewayTicket,
  shouldRetry: () => userId !== null,
  hooks: {
    attemptStarted: () => {
      if (useGatewayStore.getState().status !== "reconnecting") {
        setStatus("connecting");
      }
    },
    authFailed: () => setStatus("signed-out"),
    message: handleMessage,
    closed: () => setStatus("reconnecting"),
    retryScheduled: () => setStatus("reconnecting"),
  },
});

/** Opens the socket for `id`, or closes it when `id` is null (signed out). */
export function connectGateway(id: string | null): void {
  if (id === userId) return;
  userId = id;
  if (id) {
    socket.connect({ freshTicket: true });
  } else {
    socket.stop();
    serverIds = [];
    channelId = null;
    setStatus("idle");
  }
}

/** The app is in front again: retry now, or probe the open socket. */
export function wakeGateway(): void {
  if (userId) socket.wake();
}

/** Server events (voice occupancy, channel changes) for these servers. */
export function subscribeServers(ids: readonly string[]): void {
  const added = ids.filter((id) => !serverIds.includes(id));
  serverIds = ids;
  for (const id of added) {
    send({ op: GatewayOp.ServerSubscribe, d: { server_id: id } });
  }
}

/** Message events for the open channel; one at a time, like the web. */
export function subscribeChannel(id: string | null): void {
  if (id === channelId) return;
  if (channelId) {
    send({ op: GatewayOp.ChannelUnsubscribe, d: { channel_id: channelId } });
  }
  channelId = id;
  if (id) send({ op: GatewayOp.ChannelSubscribe, d: { channel_id: id } });
}
