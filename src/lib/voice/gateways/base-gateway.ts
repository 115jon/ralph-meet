import { clog, ScopedLogger } from "@/lib/console-logger";
import { TypedEventEmitter } from "@/lib/event-emitter";
import type { ClientMessage, ServerMessage } from "@/lib/types";
import { HeartbeatManager } from "../heartbeat-manager";

export interface BaseGatewayEvents {
  "connected": void;
  "disconnected": void;
  "message": ServerMessage;
  "kicked": void;
}

export abstract class BaseGateway<EventMap extends Record<string, any>> extends TypedEventEmitter<EventMap & BaseGatewayEvents> {
  protected ws: WebSocket | null = null;
  protected reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  protected reconnectAttempt = 0;
  protected msgQueue: ClientMessage[] = [];
  protected isIdentified = false;
  protected isLeaving = false;

  private static readonly BACKOFF_BASE_MS = 500;
  private static readonly BACKOFF_MAX_MS = 10_000;

  protected readonly log: ScopedLogger;
  protected readonly heartbeat: HeartbeatManager;

  constructor(public readonly label: string, private heartbeatOpcode: number) {
    super();
    this.log = clog(label);
    const HEARTBEAT_MSG = JSON.stringify({ op: this.heartbeatOpcode });

    this.heartbeat = new HeartbeatManager(label, {
      sendBeat: () => {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(HEARTBEAT_MSG);
      },
      onZombie: () => this.ws?.close(),
    });
  }

  /**
   * Called to establish the WebSocket connection.
   */
  public connect(url: string, resetReconnectAttempt = true) {
    this.isLeaving = false;
    if (resetReconnectAttempt) {
      this.reconnectAttempt = 0;
    }

    // Guard against duplicate connections
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      this.log.info("Already connecting/connected, skipping duplicate connect()");
      return;
    }

    this.isIdentified = false;
    this.msgQueue = [];

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.log.info("WebSocket connected, waiting for Hello");
      this.emit("connected", undefined as never);
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as ServerMessage;
      // Emit raw message for subclass handling
      this.emit("message", msg as unknown as EventMap["message"]);
      this.handleMessage(msg);
    };

    this.ws.onclose = (event) => {
      this.heartbeat.stop();
      this.isIdentified = false;
      this.ws = null;

      if (!this.isLeaving) {
        if (event.code === 1000 && event.reason === "Replaced by new connection") {
          this.log.warn("Session was replaced by a new connection in another tab/device. Not reconnecting.");
          this.isLeaving = true;
          this.emit("kicked", undefined as never);
          this.emit("disconnected", undefined as never);
          return;
        }

        this.emit("disconnected", undefined as never);
        this.log.warn(`Connection lost (code=${event.code}, reason=${event.reason}) \u2014 attempting to reconnect`);
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  /**
   * Enqueues a message if not identified, or sends it immediately if ready.
   */
  public send(msg: ClientMessage, forceSendBeforeIdentify = false) {
    if (!this.isIdentified && !forceSendBeforeIdentify) {
      this.log.warn(`Not ready (identified=${this.isIdentified}), queueing message op=${msg.op}`);
      this.msgQueue.push(msg);
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.log.error(`Cannot send message op=${msg.op}: socket is not OPEN`);
    }
  }

  /**
   * Subclasses must implement this to interpret messages and manage identification.
   */
  protected abstract handleMessage(msg: ServerMessage): void;

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
    const delay = Math.min(
      BaseGateway.BACKOFF_BASE_MS * Math.pow(2, this.reconnectAttempt),
      BaseGateway.BACKOFF_MAX_MS
    ) * (0.5 + Math.random() * 0.5);

    this.log.info(`Scheduling reconnect in ${Math.round(delay)}ms (attempt ${this.reconnectAttempt + 1})`);
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isLeaving) {
        this.performReconnect();
      }
    }, delay);
  }

  protected flushQueue() {
    this.log.info(`Identified, flushing ${this.msgQueue.length} queued messages`);
    const queued = [...this.msgQueue];
    this.msgQueue = [];
    for (const m of queued) {
      this.send(m);
    }
  }

  public disconnect() {
    this.isLeaving = true;
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
      try { this.ws.close(); } catch { }
      this.ws = null;
    }
    this.isIdentified = false;
  }

  public forceReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.heartbeat.stop();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try { this.ws.close(); } catch { }
      this.ws = null;
    }

    this.isLeaving = false;
    this.isIdentified = false;
    this.performReconnect();
  }
}
