import { clog, ScopedLogger } from "@/lib/console-logger";
import { TypedEventEmitter } from "@/lib/event-emitter";
import type { GatewayFrame, PayloadDecodeResult } from "@/lib/gateway-protocol";
import {
  CALL_SOCKET_POLICY,
  RealtimeSocket,
  type SocketTicket,
} from "@/lib/realtime-socket";
import type { ClientMessage, ServerMessage } from "@/lib/types";
import { markVoice } from "../latency-marks";

export interface BaseGatewayEvents {
  connected: void;
  disconnected: void;
  message: ServerMessage;
  /** The voice room replaced this socket with a newer one. Not retried. */
  kicked: void;
  /** The socket ticket was refused twice: the session is gone. Not retried until wake. */
  "auth-failed": void;
}

/**
 * A call socket (RoomGateway, VoiceGateway): the protocol on top of one
 * RealtimeSocket, which owns tickets, reconnects, heartbeats and wake.
 */
export abstract class BaseGateway<
  EventMap extends Record<string, any>,
  Message extends ServerMessage = ServerMessage,
  Ticket extends SocketTicket = SocketTicket,
> extends TypedEventEmitter<EventMap & BaseGatewayEvents> {
  protected readonly log: ScopedLogger;
  protected readonly socket: RealtimeSocket<Message, Ticket>;

  /**
   * @param decodeFrame The endpoint's payload decoder from
   *   @/lib/gateway-protocol (built once at module load).
   */
  constructor(
    public readonly label: string,
    decodeFrame: (frame: GatewayFrame) => PayloadDecodeResult<Message>,
  ) {
    super();
    this.log = clog(label);
    this.socket = new RealtimeSocket<Message, Ticket>({
      label,
      policy: CALL_SOCKET_POLICY,
      decode: decodeFrame,
      acquireTicket: () => this.acquireTicket(),
      hooks: {
        ticketReady: (ticket) => this.onTicket(ticket),
        ticketFailed: (error) => this.onTicketFailed(error),
        authFailed: () => this.emit("auth-failed", undefined as never),
        opened: () => {
          this.log.info("WebSocket connected, waiting for Hello");
          markVoice(`${this.label}:ws-open`);
          this.emit("connected", undefined as never);
        },
        frame: (frame) => this.onFrame(frame),
        message: (msg) => {
          this.emit("message", msg as unknown as EventMap["message"]);
          this.handleMessage(msg);
        },
        closed: ({ next }) => {
          if (next === "replaced") this.emit("kicked", undefined as never);
          this.emit("disconnected", undefined as never);
        },
      },
    });
  }

  /** Requests a ticket and names the socket URL for one connection attempt. */
  protected abstract acquireTicket(): Promise<Ticket>;

  /** The current attempt has its ticket; the socket opens right after. */
  protected onTicket(_ticket: Ticket): void {}

  /** The ticket request failed; the lifecycle retries or stops after this. */
  protected abstract onTicketFailed(error: unknown): void;

  /**
   * Sees every well-formed frame before its payload is decoded, including
   * opcodes this gateway ignores (RoomGateway tracks replay cursors here).
   */
  protected onFrame(_frame: GatewayFrame): void {}

  /**
   * Subclasses interpret messages and call `socket.markReady()` once
   * identified. Hello has already started the heartbeat.
   */
  protected abstract handleMessage(msg: Message): void;

  /**
   * Sends now once identified, else queues until identified. Identify and
   * Resume pass `forceSendBeforeIdentify`.
   */
  public send(msg: ClientMessage, forceSendBeforeIdentify = false): boolean {
    if (!forceSendBeforeIdentify && !this.socket.isReady) {
      this.log.warn(`Not ready, queueing message op=${msg.op}`);
    }
    const sent = forceSendBeforeIdentify
      ? this.socket.sendJson(msg)
      : this.socket.sendWhenReady(msg);
    if (!sent) {
      this.log.error(`Cannot send message op=${msg.op}: socket is not OPEN`);
    }
    return sent;
  }

  public getDebugState() {
    return { label: this.label, ...this.socket.debugState() };
  }

  /** Leave: close the socket, drop queued messages, no reconnect. */
  public disconnect() {
    this.socket.stop();
  }

  /** Drop the socket (or the attempt in flight) and connect again now. */
  public forceReconnect() {
    this.socket.reconnectNow();
  }

  /** The page is back: retry now if waiting, else probe the open socket. */
  public wake() {
    this.socket.wake();
  }
}
