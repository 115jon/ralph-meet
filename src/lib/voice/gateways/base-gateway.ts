import { clog, ScopedLogger } from "@/lib/console-logger";
import { TypedEventEmitter } from "@/lib/event-emitter";
import {
  GatewayCloseCode,
  HEARTBEAT_FRAME,
  parseGatewayFrame,
  type GatewayFrame,
  type PayloadDecodeResult,
} from "@/lib/gateway-protocol";
import type { ClientMessage, ServerMessage } from "@/lib/types";
import { HeartbeatManager } from "../heartbeat-manager";
import { markVoice } from "../latency-marks";

export interface BaseGatewayEvents {
  connected: void;
  disconnected: void;
  message: ServerMessage;
  kicked: void;
}

export abstract class BaseGateway<
  EventMap extends Record<string, any>,
  Message extends ServerMessage = ServerMessage,
> extends TypedEventEmitter<EventMap & BaseGatewayEvents> {
  protected ws: WebSocket | null = null;
  protected reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  protected reconnectAttempt = 0;
  protected msgQueue: ClientMessage[] = [];
  protected isIdentified = false;
  protected isLeaving = false;
  protected connectionRequestGeneration = 0;

  private static readonly BACKOFF_BASE_MS = 500;
  private static readonly BACKOFF_MAX_MS = 10_000;

  protected readonly log: ScopedLogger;
  protected readonly heartbeat: HeartbeatManager;

  /**
   * @param decodeFrame The endpoint's payload decoder from
   *   @/lib/gateway-protocol (built once at module load).
   */
  constructor(
    public readonly label: string,
    private readonly decodeFrame: (
      frame: GatewayFrame,
    ) => PayloadDecodeResult<Message>,
  ) {
    super();
    this.log = clog(label);

    this.heartbeat = new HeartbeatManager(label, {
      sendBeat: () => {
        if (this.ws?.readyState === WebSocket.OPEN)
          this.ws.send(HEARTBEAT_FRAME);
      },
      onZombie: () => this.ws?.close(),
    });
  }

  /**
   * Called to establish the WebSocket connection.
   */
  public connect(
    url: string,
    resetReconnectAttempt = true,
    protocols?: string[],
  ) {
    this.isLeaving = false;
    if (resetReconnectAttempt) {
      this.reconnectAttempt = 0;
    }

    // Guard against duplicate connections
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.CONNECTING ||
        this.ws.readyState === WebSocket.OPEN)
    ) {
      this.log.info(
        "Already connecting/connected, skipping duplicate connect()",
      );
      return;
    }

    this.isIdentified = false;

    const socket = protocols
      ? new WebSocket(url, protocols)
      : new WebSocket(url);
    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      this.log.info("WebSocket connected, waiting for Hello");
      markVoice(`${this.label}:ws-open`);
      this.emit("connected", undefined as never);
    };

    socket.onmessage = (event) => {
      if (this.ws !== socket) return;
      const msg = this.decodeServerFrame(event.data);
      if (!msg) return;
      this.emit("message", msg as unknown as EventMap["message"]);
      this.handleMessage(msg);
    };

    socket.onclose = (event) => {
      if (this.ws !== socket) return;
      this.heartbeat.stop();
      this.isIdentified = false;
      this.ws = null;

      if (!this.isLeaving) {
        if (
          event.code === 1000 &&
          event.reason === "Replaced by new connection"
        ) {
          this.log.warn(
            "Session was replaced by a new connection in another tab/device. Not reconnecting.",
          );
          this.isLeaving = true;
          this.emit("kicked", undefined as never);
          this.emit("disconnected", undefined as never);
          return;
        }

        if (event.code === GatewayCloseCode.AdmissionRejected) {
          this.log.warn("Realtime admission was rejected. Not reconnecting.");
          this.isLeaving = true;
          this.emit("disconnected", undefined as never);
          return;
        }

        this.emit("disconnected", undefined as never);
        this.log.warn(
          `Connection lost (code=${event.code}, reason=${event.reason}) \u2014 attempting to reconnect`,
        );
        this.scheduleReconnect();
      }
    };

    socket.onerror = () => {
      if (this.ws !== socket) return;
      // onclose will fire after this
    };
  }

  /**
   * Enqueues a message if not identified, or sends it immediately if ready.
   */
  public send(msg: ClientMessage, forceSendBeforeIdentify = false): boolean {
    if (!this.isIdentified && !forceSendBeforeIdentify) {
      this.log.warn(
        `Not ready (identified=${this.isIdentified}), queueing message op=${msg.op}`,
      );
      this.msgQueue.push(msg);
      return true;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    } else {
      this.log.error(`Cannot send message op=${msg.op}: socket is not OPEN`);
      return false;
    }
  }

  public getDebugState() {
    return {
      label: this.label,
      connected: !!this.ws && this.ws.readyState === WebSocket.OPEN,
      readyState: this.ws?.readyState ?? null,
      identified: this.isIdentified,
      leaving: this.isLeaving,
      queued: this.msgQueue.length,
    };
  }

  /**
   * Decodes one server frame at the socket edge. A frame that is not JSON,
   * has no opcode, or fails its opcode's schema is logged and dropped; an
   * opcode this gateway does not handle is ignored. Never throws.
   */
  private decodeServerFrame(data: unknown): Message | null {
    if (typeof data !== "string") {
      this.log.warn("Dropping non-text gateway frame");
      return null;
    }
    const parsed = parseGatewayFrame(data);
    if (!parsed.ok) {
      this.log.warn(`Dropping gateway frame: ${parsed.message}`);
      return null;
    }
    this.onFrame(parsed.frame);
    const decoded = this.decodeFrame(parsed.frame);
    if (decoded.ok) return decoded.message;
    if (decoded.reason === "invalid-payload") {
      this.log.warn(
        `Dropping gateway frame op=${parsed.frame.op}: ${decoded.invalid}`,
      );
    }
    return null;
  }

  /**
   * Sees every well-formed frame before its payload is decoded, including
   * opcodes this gateway ignores (RoomGateway tracks replay cursors here).
   */
  protected onFrame(_frame: GatewayFrame): void {}

  /**
   * Subclasses must implement this to interpret messages and manage identification.
   */
  protected abstract handleMessage(msg: Message): void;

  /**
   * Subclasses must implement this to define how reconnect is re-issued.
   */
  protected abstract performReconnect(): void;

  protected scheduleReconnect() {
    if (this.isLeaving) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // Jittered exponential backoff: 500ms, 1s, 2s, 4s, 8s, 10s (capped)
    const delay =
      Math.min(
        BaseGateway.BACKOFF_BASE_MS * Math.pow(2, this.reconnectAttempt),
        BaseGateway.BACKOFF_MAX_MS,
      ) *
      (0.5 + Math.random() * 0.5);

    this.log.info(
      `Scheduling reconnect in ${Math.round(delay)}ms (attempt ${this.reconnectAttempt + 1})`,
    );
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isLeaving) {
        this.performReconnect();
      }
    }, delay);
  }

  protected flushQueue() {
    this.log.info(
      `Identified, flushing ${this.msgQueue.length} queued messages`,
    );
    const queued = [...this.msgQueue];
    this.msgQueue = [];
    for (const m of queued) {
      this.send(m);
    }
  }

  public disconnect() {
    this.isLeaving = true;
    this.connectionRequestGeneration++;
    this.heartbeat.stop();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      // Remove handlers before close to prevent racing reconnects
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.isIdentified = false;
    this.msgQueue = [];
  }

  public forceReconnect() {
    this.connectionRequestGeneration++;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.heartbeat.stop();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    this.isLeaving = false;
    this.isIdentified = false;
    this.performReconnect();
  }
}
