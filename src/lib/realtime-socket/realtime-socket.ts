// ── Realtime socket lifecycle ───────────────────────────────────────────────
// One owner for the connection lifecycle of the three realtime sockets: the
// chat store's main gateway socket, RoomGateway and VoiceGateway. Each
// gateway keeps its protocol (what Hello, Ready and the other opcodes mean);
// this module keeps everything else:
//
//   ticket → open → Hello (heartbeat starts) → gateway identifies or resumes
//   → gateway calls markReady() (backoff resets, queued messages flush)
//
// and, when the socket goes: backoff and retry, or give up when the server
// said so (admission rejected, replaced by a newer connection) or the session
// is gone (ticket refused twice). wake() is for the page coming back: retry
// now if a retry is pending, or probe an open socket and drop it if nothing
// answers in time. A socket that gets through tells the others (see
// ./reachability), and those waiting out a backoff retry now too.
//
// Each attempt (one ticket request and the socket it opens) has an identity.
// stop(), reconnectNow() and a fresh connect() replace it, and every callback
// of an older attempt (a late ticket, a stale close) checks it and does
// nothing. Timers come from an injectable clock and sockets from an
// injectable factory, so tests drive the whole state machine by hand.

import { clog, type ScopedLogger } from "@/lib/console-logger";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  GatewayCloseCode,
  GatewayOp,
  HEARTBEAT_FRAME,
  parseGatewayFrame,
  type GatewayFrame,
  type PayloadDecodeResult,
} from "@/lib/gateway-protocol";
import {
  HeartbeatManager,
  type ScheduleTimer,
} from "@/lib/voice/heartbeat-manager";
import { backoffDelay, type RealtimeSocketPolicy } from "./policy";
import { serverReachability, type ServerReachability } from "./reachability";

/** WebSocket.OPEN, without reading the global (tests replace it). */
const WS_OPEN = 1;
/** The voice room closes a socket with this when the same participant reconnects elsewhere. */
const REPLACED_REASON = "Replaced by new connection";
/** Close code for a socket this client gave up on (zombie, no reply after wake). */
const ABANDONED_CODE = 4000;

export interface RealtimeClock {
  readonly schedule: ScheduleTimer;
  /** Uniform in [0, 1), for backoff jitter. */
  readonly random: () => number;
}

const systemClock: RealtimeClock = {
  schedule: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    return () => clearTimeout(handle);
  },
  random: () => Math.random(),
};

/** The part of a WebSocket the lifecycle uses. */
export type RealtimeWebSocket = Pick<
  WebSocket,
  | "readyState"
  | "send"
  | "close"
  | "onopen"
  | "onmessage"
  | "onclose"
  | "onerror"
>;

export type CreateRealtimeWebSocket = (
  url: string,
  protocols?: string[],
) => RealtimeWebSocket;

const openBrowserSocket: CreateRealtimeWebSocket = (url, protocols) =>
  protocols ? new WebSocket(url, protocols) : new WebSocket(url);

/** What one connection attempt needs: where to connect, with which ticket. */
export interface SocketTicket {
  readonly url: string;
  readonly protocols?: string[];
}

/** A client frame, JSON-encoded on send. */
export interface OutboundFrame {
  readonly op: number;
  readonly d?: unknown;
}

/** A decoded server frame. */
export interface InboundMessage {
  readonly op: number;
  readonly d?: unknown;
}

/** Why a socket that closed will not be retried. */
type SocketGiveUp = "admission-rejected" | "replaced";

interface SocketClosed {
  readonly code: number;
  readonly reason: string;
  /** What the lifecycle does next. */
  readonly next: "retry" | SocketGiveUp;
}

/**
 * The gateway's side of the lifecycle. Every hook runs synchronously and may
 * call back into the socket (stop, connect); the lifecycle checks whether it
 * did before it carries on.
 */
export interface RealtimeSocketHooks<
  M extends InboundMessage,
  T extends SocketTicket,
> {
  /** An attempt starts; its ticket request goes out next. */
  attemptStarted?(): void;
  /** The current attempt has its ticket; the socket opens next. */
  ticketReady?(ticket: T): void;
  /** The ticket request (or opening the socket) failed. */
  ticketFailed?(error: unknown): void;
  /** Ticket refused too often: the session is gone. Retries stop or slow. */
  authFailed?(): void;
  opened?(): void;
  /** Every well-formed frame, before payload decoding (replay cursors). */
  frame?(frame: GatewayFrame): void;
  /** Every frame that decoded. Hello has already started the heartbeat. */
  message(message: M): void;
  /** The socket closed or was abandoned. Not called for stop() or reconnectNow(). */
  closed?(close: SocketClosed): void;
  /** A backoff retry is scheduled; `attempt` counts from 1. */
  retryScheduled?(attempt: number, delayMs: number): void;
}

export interface RealtimeSocketOptions<
  M extends InboundMessage,
  T extends SocketTicket,
> {
  readonly label: string;
  readonly policy: RealtimeSocketPolicy;
  /** The endpoint's payload decoder from @/lib/gateway-protocol. */
  readonly decode: (frame: GatewayFrame) => PayloadDecodeResult<M>;
  /** Fetches a ticket and names the URL for one attempt. */
  readonly acquireTicket: () => Promise<T>;
  readonly hooks: RealtimeSocketHooks<M, T>;
  /** Checked when a retry timer fires; false leaves the socket idle. */
  readonly shouldRetry?: () => boolean;
  readonly clock?: RealtimeClock;
  readonly createSocket?: CreateRealtimeWebSocket;
  /** Shared with the page's other realtime sockets; tests pass their own. */
  readonly reachability?: ServerReachability;
}

type Phase =
  /** Not started, or between a close and its retry. */
  | { readonly kind: "idle" }
  /** stop() was called. */
  | { readonly kind: "stopped" }
  | { readonly kind: "given-up"; readonly reason: SocketGiveUp }
  | { readonly kind: "ticket"; readonly attempt: symbol }
  | {
      readonly kind: "socket";
      readonly attempt: symbol;
      readonly socket: RealtimeWebSocket;
    }
  | {
      readonly kind: "waiting";
      readonly cancel: () => void;
      /** The auth-failed state's slow retry, not a backoff retry. */
      readonly auth: boolean;
    }
  /** Auth failed and the policy has no slow retry: waits for wake/connect. */
  | { readonly kind: "auth-failed" };

/** A ticket request refused because the session is gone (SocketTicketError 401). */
function isAuthRefusal(error: unknown): boolean {
  // Duck-typed on `status` so this module does not load the ticket client.
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 401
  );
}

function helloInterval(d: unknown): number {
  if (
    typeof d === "object" &&
    d !== null &&
    "heartbeat_interval" in d &&
    typeof d.heartbeat_interval === "number"
  ) {
    return d.heartbeat_interval;
  }
  return DEFAULT_HEARTBEAT_INTERVAL_MS;
}

function giveUpReason(code: number, reason: string): SocketGiveUp | null {
  if (code === 1000 && reason === REPLACED_REASON) return "replaced";
  if (code === GatewayCloseCode.AdmissionRejected) return "admission-rejected";
  return null;
}

function detach(socket: RealtimeWebSocket): void {
  socket.onopen = null;
  socket.onmessage = null;
  socket.onclose = null;
  socket.onerror = null;
}

export class RealtimeSocket<
  M extends InboundMessage,
  T extends SocketTicket = SocketTicket,
> {
  private phase: Phase = { kind: "idle" };
  /** Backoff retries since the last markReady(). */
  private retries = 0;
  /** Ticket refusals (401) in a row. */
  private refusals = 0;
  private authFailed = false;
  /** markReady() was called for the current socket. */
  private ready = false;
  private queue: OutboundFrame[] = [];
  private cancelProbe: (() => void) | null = null;

  private readonly log: ScopedLogger;
  private readonly heartbeat: HeartbeatManager;
  private readonly clock: RealtimeClock;
  private readonly createSocket: CreateRealtimeWebSocket;
  private readonly policy: RealtimeSocketPolicy;
  private readonly hooks: RealtimeSocketHooks<M, T>;
  private readonly reachability: ServerReachability;

  constructor(private readonly options: RealtimeSocketOptions<M, T>) {
    this.log = clog(options.label);
    this.clock = options.clock ?? systemClock;
    this.reachability = options.reachability ?? serverReachability;
    this.createSocket = options.createSocket ?? openBrowserSocket;
    this.policy = options.policy;
    this.hooks = options.hooks;
    this.heartbeat = new HeartbeatManager(
      options.label,
      {
        sendBeat: () => this.sendRaw(HEARTBEAT_FRAME),
        onZombie: () => {
          if (this.phase.kind === "socket") {
            this.abandon(this.phase.socket, "zombie");
          }
        },
      },
      3,
      (callback, ms) => this.clock.schedule(callback, ms),
    );
  }

  // ── State ────────────────────────────────────────────────────────────────

  /** A ticket request is in flight or a socket exists. */
  get isActive(): boolean {
    return this.phase.kind === "ticket" || this.phase.kind === "socket";
  }

  get isOpen(): boolean {
    return this.openSocket() !== null;
  }

  /** Open, and the gateway has called markReady() for this socket. */
  get isReady(): boolean {
    return this.ready && this.isOpen;
  }

  debugState() {
    const phase = this.phase;
    return {
      phase: phase.kind,
      connected: this.isOpen,
      readyState: phase.kind === "socket" ? phase.socket.readyState : null,
      identified: this.ready,
      leaving: phase.kind === "stopped" || phase.kind === "given-up",
      queued: this.queue.length,
      retries: this.retries,
      authFailed: this.authFailed,
    };
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  /**
   * Connect if not already connecting or connected. A pending retry or the
   * auth-failed state tries now. `freshTicket` discards a ticket request
   * already in flight (it was made for options that changed) and asks again.
   */
  connect(options: { readonly freshTicket?: boolean } = {}): void {
    const phase = this.phase;
    if (phase.kind === "socket") return;
    if (phase.kind === "ticket" && !options.freshTicket) return;
    if (phase.kind === "stopped" || phase.kind === "given-up") this.retries = 0;
    this.beginAttempt();
  }

  /** Intentional leave: no retry until connect(). Clears the send queue. */
  stop(): void {
    this.leavePhase();
    this.phase = { kind: "stopped" };
    this.ready = false;
    this.queue = [];
    this.retries = 0;
    this.refusals = 0;
    this.authFailed = false;
  }

  /**
   * Drop the current attempt or socket without a close event and start a new
   * attempt now. Keeps the backoff count and the send queue.
   */
  reconnectNow(): void {
    this.beginAttempt();
  }

  /**
   * The page is back (visible, online). Retry now if waiting; probe an open
   * socket, which is abandoned unless a frame arrives within the probe window.
   */
  wake(): void {
    const phase = this.phase;
    switch (phase.kind) {
      case "waiting":
      case "auth-failed":
        this.beginAttempt();
        return;
      case "socket":
        this.probe(phase.socket);
        return;
      default:
        return;
    }
  }

  /** The gateway is identified (Ready, Resumed, VoiceReady). */
  markReady(): void {
    this.ready = true;
    this.retries = 0;
    if (this.queue.length === 0) return;
    this.log.info(`Identified, flushing ${this.queue.length} queued messages`);
    const queued = this.queue;
    this.queue = [];
    for (const message of queued) this.sendWhenReady(message);
  }

  // ── Sending ──────────────────────────────────────────────────────────────

  /** Sends now if the socket is open; false otherwise. */
  sendJson(message: OutboundFrame): boolean {
    return this.sendRaw(JSON.stringify(message));
  }

  /** Sends if ready, else queues until markReady(). False only if a send failed. */
  sendWhenReady(message: OutboundFrame): boolean {
    if (!this.ready) {
      this.queue.push(message);
      return true;
    }
    return this.sendJson(message);
  }

  /** Removes queued messages that match (they would be wrong after a reconnect). */
  dropQueued(predicate: (message: OutboundFrame) => boolean): void {
    this.queue = this.queue.filter((message) => !predicate(message));
  }

  private sendRaw(data: string): boolean {
    const socket = this.openSocket();
    if (!socket) return false;
    socket.send(data);
    return true;
  }

  private openSocket(): RealtimeWebSocket | null {
    const phase = this.phase;
    return phase.kind === "socket" && phase.socket.readyState === WS_OPEN
      ? phase.socket
      : null;
  }

  // ── Attempts ─────────────────────────────────────────────────────────────

  private isCurrent(attempt: symbol): boolean {
    const phase = this.phase;
    return (
      (phase.kind === "ticket" || phase.kind === "socket") &&
      phase.attempt === attempt
    );
  }

  private owns(socket: RealtimeWebSocket): boolean {
    return this.phase.kind === "socket" && this.phase.socket === socket;
  }

  /** Cancels the pending retry, drops the socket, stops liveness timers. */
  private leavePhase(): void {
    const phase = this.phase;
    if (phase.kind === "waiting") phase.cancel();
    if (phase.kind === "socket") {
      detach(phase.socket);
      try {
        phase.socket.close();
      } catch {
        // Already closed.
      }
    }
    this.heartbeat.stop();
    this.clearProbe();
  }

  private beginAttempt(): void {
    this.leavePhase();
    const attempt = Symbol(this.options.label);
    this.phase = { kind: "ticket", attempt };
    this.ready = false;
    this.hooks.attemptStarted?.();
    if (!this.isCurrent(attempt)) return;

    let ticket: Promise<T>;
    try {
      ticket = this.options.acquireTicket();
    } catch (error) {
      ticket = Promise.reject(error);
    }
    void ticket.then(
      (value) => this.openWithTicket(attempt, value),
      (error: unknown) => this.attemptFailed(attempt, error),
    );
  }

  private openWithTicket(attempt: symbol, ticket: T): void {
    if (!this.isCurrent(attempt)) return;
    this.refusals = 0;
    this.authFailed = false;

    let socket: RealtimeWebSocket;
    try {
      this.hooks.ticketReady?.(ticket);
      if (!this.isCurrent(attempt)) return;
      socket = this.createSocket(ticket.url, ticket.protocols);
    } catch (error) {
      this.attemptFailed(attempt, error);
      return;
    }
    this.phase = { kind: "socket", attempt, socket };

    socket.onopen = () => {
      if (!this.owns(socket)) return;
      this.log.info("Connected");
      this.hooks.opened?.();
      this.reachability.reachable();
    };
    socket.onmessage = (event) => {
      if (!this.owns(socket)) return;
      // Any bytes at all mean the link is alive.
      this.clearProbe();
      this.receive(event.data);
    };
    socket.onclose = (event) => {
      if (!this.owns(socket)) return;
      this.closed(socket, event.code, event.reason);
    };
    socket.onerror = () => {
      // onclose follows.
    };
    // The ticket request reached the server.
    this.reachability.reachable();
  }

  private attemptFailed(attempt: symbol, error: unknown): void {
    if (!this.isCurrent(attempt)) return;
    const failed: Phase = { kind: "idle" };
    this.phase = failed;
    this.hooks.ticketFailed?.(error);
    if (this.phase !== failed) return;

    if (isAuthRefusal(error)) {
      this.refusals++;
      if (this.authFailed || this.refusals >= this.policy.refusalsToFail) {
        if (!this.authFailed) {
          this.authFailed = true;
          this.log.warn("Ticket refused (401). Waiting for sign-in.");
          this.hooks.authFailed?.();
          if (this.phase !== failed) return;
        }
        this.waitForAuth();
        return;
      }
      this.log.warn("Ticket refused (401). Retrying once.");
    } else if (this.authFailed) {
      // Could not tell (server or network trouble): stay signed out.
      this.waitForAuth();
      return;
    } else {
      this.refusals = 0;
    }
    this.scheduleRetry();
  }

  // ── Retry ────────────────────────────────────────────────────────────────

  private scheduleRetry(): void {
    const delay = backoffDelay(this.policy.backoff, this.retries, () =>
      this.clock.random(),
    );
    this.retries++;
    this.log.info(
      `Reconnecting in ${Math.round(delay)}ms (attempt ${this.retries})`,
    );
    this.waitThenRetry(delay, false);
    this.hooks.retryScheduled?.(this.retries, delay);
  }

  /** The auth-failed state: a slow retry, or none until wake/connect. */
  private waitForAuth(): void {
    if (this.policy.authRetryMs === null) {
      this.phase = { kind: "auth-failed" };
      return;
    }
    this.waitThenRetry(this.policy.authRetryMs, true);
  }

  private waitThenRetry(ms: number, auth: boolean): void {
    const retry = () => {
      if (this.phase !== waiting) return;
      if (this.options.shouldRetry?.() === false) {
        cancel();
        this.phase = { kind: "idle" };
        return;
      }
      this.beginAttempt();
    };
    const cancelTimer = this.clock.schedule(retry, ms);
    // A backoff ends early when another socket gets through. The signed-out
    // wait does not: the server being up says nothing about the session.
    const stopListening = auth
      ? null
      : this.reachability.onNextReachable(() => {
          if (this.phase !== waiting) return;
          this.log.info("Server reachable again, retrying now");
          retry();
        });
    const cancel = () => {
      cancelTimer();
      stopListening?.();
    };
    const waiting: Phase = { kind: "waiting", cancel, auth };
    this.phase = waiting;
  }

  // ── Socket events ────────────────────────────────────────────────────────

  /**
   * One frame from the socket. Malformed frames and frames that fail their
   * opcode's schema are logged and dropped; opcodes the endpoint does not
   * handle are ignored. Never throws.
   */
  private receive(data: unknown): void {
    if (typeof data !== "string") {
      this.log.warn("Dropping non-text gateway frame");
      return;
    }
    const parsed = parseGatewayFrame(data);
    if (!parsed.ok) {
      this.log.warn(`Dropping gateway frame: ${parsed.message}`);
      return;
    }
    const frame = parsed.frame;
    try {
      this.hooks.frame?.(frame);
      const decoded = this.options.decode(frame);
      if (!decoded.ok) {
        if (decoded.reason === "invalid-payload") {
          this.log.warn(
            `Dropping gateway frame op=${frame.op}: ${decoded.invalid}`,
          );
        }
        return;
      }
      if (frame.op === GatewayOp.Hello) {
        this.heartbeat.start(helloInterval(frame.d));
      } else if (frame.op === GatewayOp.HeartbeatACK) {
        this.heartbeat.onAck();
      }
      this.hooks.message(decoded.message);
    } catch (error) {
      this.log.warn("Gateway frame handler failed:", error);
    }
  }

  private probe(socket: RealtimeWebSocket): void {
    if (socket.readyState !== WS_OPEN || this.cancelProbe) return;
    socket.send(HEARTBEAT_FRAME);
    this.cancelProbe = this.clock.schedule(() => {
      this.cancelProbe = null;
      this.abandon(socket, "no reply after wake");
    }, this.policy.probeMs);
  }

  private clearProbe(): void {
    this.cancelProbe?.();
    this.cancelProbe = null;
  }

  /**
   * Give up on a socket that has stopped answering. `close()` on a dead link
   * can take a long time to fire `onclose` (the closing handshake has to time
   * out), so run the close path now; the late event finds no handler.
   */
  private abandon(socket: RealtimeWebSocket, reason: string): void {
    if (!this.owns(socket)) return;
    this.log.warn(`Abandoning socket (${reason})`);
    this.closed(socket, ABANDONED_CODE, reason);
    try {
      socket.close(ABANDONED_CODE, reason);
    } catch {
      // Already closed.
    }
  }

  private closed(socket: RealtimeWebSocket, code: number, reason: string) {
    detach(socket);
    this.heartbeat.stop();
    this.clearProbe();
    this.ready = false;

    const giveUp = giveUpReason(code, reason);
    if (giveUp) {
      this.log.warn(
        giveUp === "replaced"
          ? "Replaced by a newer connection. Not reconnecting."
          : "Realtime admission was rejected. Not reconnecting.",
      );
      this.phase = { kind: "given-up", reason: giveUp };
      this.hooks.closed?.({ code, reason, next: giveUp });
      return;
    }

    this.log.warn(`Connection lost (code=${code}, reason=${reason})`);
    const closed: Phase = { kind: "idle" };
    this.phase = closed;
    this.hooks.closed?.({ code, reason, next: "retry" });
    if (this.phase === closed) this.scheduleRetry();
  }
}
