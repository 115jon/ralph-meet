import { describe, expect, it, vi } from "vitest";
import {
  decodeRoomGatewayServerFrame,
  GatewayOp,
  type RoomGatewayServerMessage,
} from "@/lib/gateway-protocol";
import {
  backoffDelay,
  CALL_SOCKET_POLICY,
  CHAT_SOCKET_POLICY,
  CONNECT_TIMEOUTS,
  createServerReachability,
  isRealtimeTimeout,
  RealtimeSocket,
  type RealtimeClock,
  type RealtimeSocketPolicy,
  type RealtimeWebSocket,
  type ServerReachability,
  type SocketTicket,
} from "@/lib/realtime-socket";

// ── Fakes ───────────────────────────────────────────────────────────────────

/** A clock the test advances by hand. `random` is fixed (0 = no jitter). */
class FakeClock implements RealtimeClock {
  time = 0;
  readonly now = () => this.time;
  randomValue = 0;
  private timers: Array<{ at: number; fn: () => void; live: boolean }> = [];

  readonly schedule = (fn: () => void, ms: number) => {
    const timer = { at: this.time + ms, fn, live: true };
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  };

  readonly random = () => this.randomValue;

  /** Delays from now of the timers still pending. */
  pending(): number[] {
    return this.timers
      .filter((timer) => timer.live)
      .map((timer) => timer.at - this.time);
  }

  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const due = this.timers
        .filter((timer) => timer.live && timer.at <= end)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.live = false;
      this.time = due.at;
      due.fn();
    }
    this.time = end;
  }
}

class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  closedWith: [number | undefined, string | undefined] | null = null;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols?: string[],
  ) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closedWith = [code, reason];
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  receive(data: unknown): void {
    this.onmessage?.({
      data:
        typeof data === "string" || data instanceof ArrayBuffer
          ? data
          : JSON.stringify(data),
    } as MessageEvent);
  }

  serverClose(code: number, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

class TicketError extends Error {
  constructor(readonly status: number) {
    super(`ticket ${status}`);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Lets ticket promises settle (the module's clock is fake; this one is real). */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const HELLO = { op: GatewayOp.Hello, d: { heartbeat_interval: 1000 } };
const ACK = { op: GatewayOp.HeartbeatACK };

function harness(
  policy: RealtimeSocketPolicy = CALL_SOCKET_POLICY,
  options: {
    shouldRetry?: () => boolean;
    /** Defaults to one of its own, so other harnesses never wake this one. */
    reachability?: ServerReachability;
  } = {},
) {
  const clock = new FakeClock();
  const sockets: FakeSocket[] = [];
  const tickets: Array<ReturnType<typeof deferred<SocketTicket>>> = [];
  const events: string[] = [];
  const messages: RoomGatewayServerMessage[] = [];
  const signals: AbortSignal[] = [];
  const failures: unknown[] = [];
  const acquireTicket = vi.fn((signal: AbortSignal) => {
    const ticket = deferred<SocketTicket>();
    tickets.push(ticket);
    signals.push(signal);
    return ticket.promise;
  });
  const socket = new RealtimeSocket<RoomGatewayServerMessage>({
    label: "Test",
    policy,
    decode: decodeRoomGatewayServerFrame,
    acquireTicket,
    clock,
    shouldRetry: options.shouldRetry,
    reachability: options.reachability ?? createServerReachability(),
    createSocket: (url, protocols) => {
      const fake = new FakeSocket(url, protocols);
      sockets.push(fake);
      return fake as unknown as RealtimeWebSocket;
    },
    hooks: {
      attemptStarted: () => events.push("attempt"),
      ticketReady: () => events.push("ticket"),
      ticketFailed: (error) => {
        failures.push(error);
        events.push("ticket-failed");
      },
      authFailed: () => events.push("auth-failed"),
      opened: () => events.push("open"),
      message: (message) => messages.push(message),
      closed: ({ next }) => events.push(`closed:${next}`),
      retryScheduled: (attempt, delayMs) =>
        events.push(`retry:${attempt}:${Math.round(delayMs)}`),
    },
  });

  const grantTicket = async () => {
    tickets
      .at(-1)!
      .resolve({ url: "wss://meet.test/socket", protocols: ["p"] });
    await settle();
    return sockets.at(-1)!;
  };
  const refuseTicket = async (status: number) => {
    tickets.at(-1)!.reject(new TicketError(status));
    await settle();
  };
  const connected = async () => {
    socket.connect();
    const fake = await grantTicket();
    fake.open();
    return fake;
  };
  const retries = () => events.filter((event) => event.startsWith("retry:"));

  return {
    clock,
    socket,
    sockets,
    tickets,
    signals,
    failures,
    events,
    messages,
    acquireTicket,
    grantTicket,
    refuseTicket,
    connected,
    retries,
  };
}

// ── Backoff ─────────────────────────────────────────────────────────────────

describe("backoff schedule", () => {
  it("doubles from the base to the cap, per socket", () => {
    const none = () => 0;
    const call = [0, 1, 2, 3, 4, 5, 6].map((n) =>
      backoffDelay(CALL_SOCKET_POLICY.backoff, n, none),
    );
    expect(call).toEqual([500, 1000, 2000, 4000, 8000, 10_000, 10_000]);
    const chat = [0, 1, 2, 3, 4, 5, 6].map((n) =>
      backoffDelay(CHAT_SOCKET_POLICY.backoff, n, none),
    );
    expect(chat).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]);
  });

  it("jitters the call sockets down to half and the chat socket up by 500ms", () => {
    const most = () => 0.999_999;
    expect(backoffDelay(CALL_SOCKET_POLICY.backoff, 0, most)).toBeCloseTo(
      250,
      0,
    );
    expect(backoffDelay(CALL_SOCKET_POLICY.backoff, 9, most)).toBeCloseTo(
      5000,
      0,
    );
    expect(backoffDelay(CHAT_SOCKET_POLICY.backoff, 0, most)).toBeCloseTo(
      1500,
      0,
    );
    expect(backoffDelay(CHAT_SOCKET_POLICY.backoff, 9, most)).toBeCloseTo(
      30_500,
      0,
    );
  });

  it("retries closed sockets on that schedule and caps it", async () => {
    const h = harness();
    let fake = await h.connected();
    for (let i = 0; i < 6; i++) {
      fake.serverClose(1006);
      const delay = h.clock.pending()[0]!;
      h.clock.advance(delay - 1);
      expect(h.acquireTicket).toHaveBeenCalledTimes(i + 1);
      h.clock.advance(1);
      expect(h.acquireTicket).toHaveBeenCalledTimes(i + 2);
      fake = await h.grantTicket();
      fake.open();
    }
    expect(h.retries()).toEqual([
      "retry:1:500",
      "retry:2:1000",
      "retry:3:2000",
      "retry:4:4000",
      "retry:5:8000",
      "retry:6:10000",
    ]);
  });

  it("resets after a successful identify, not on open alone", async () => {
    const h = harness();
    let fake = await h.connected();
    fake.serverClose(1006);
    h.clock.advance(500);
    fake = await h.grantTicket();
    fake.open();
    // Opened but never identified: the next retry still backs off further.
    fake.serverClose(1006);
    h.clock.advance(1000);
    fake = await h.grantTicket();
    fake.open();
    h.socket.markReady();
    fake.serverClose(1006);
    expect(h.retries()).toEqual(["retry:1:500", "retry:2:1000", "retry:1:500"]);
  });
});

// ── Connect timeouts ────────────────────────────────────────────────────────

describe("connect timeouts", () => {
  it("aborts a ticket request that never answers and retries on the backoff", async () => {
    const h = harness();
    h.socket.connect();
    h.clock.advance(CONNECT_TIMEOUTS.ticketMs - 1);
    expect(h.signals[0]!.aborted).toBe(false);
    expect(h.events).not.toContain("ticket-failed");

    h.clock.advance(1);
    expect(h.signals[0]!.aborted).toBe(true);
    expect(isRealtimeTimeout(h.failures[0])).toBe(true);
    expect(h.retries()).toEqual(["retry:1:500"]);

    h.clock.advance(500);
    expect(h.acquireTicket).toHaveBeenCalledTimes(2);
  });

  it("ignores the abandoned request's late answer, ticket or failure", async () => {
    const h = harness();
    h.socket.connect();
    const stale = h.tickets[0]!;
    h.clock.advance(CONNECT_TIMEOUTS.ticketMs + 500);
    expect(h.acquireTicket).toHaveBeenCalledTimes(2);

    // The first request answers after all: it must not open a socket or
    // fail the attempt that replaced it.
    stale.resolve({ url: "wss://meet.test/stale" });
    await settle();
    expect(h.sockets).toHaveLength(0);
    stale.reject(new Error("late"));
    await settle();
    expect(h.events.filter((e) => e === "ticket-failed")).toHaveLength(1);

    const fake = await h.grantTicket();
    expect(fake.url).toBe("wss://meet.test/socket");
    expect(h.sockets).toHaveLength(1);
  });

  it("drops a socket that does not open in time", async () => {
    const h = harness();
    h.socket.connect();
    const fake = await h.grantTicket();
    h.clock.advance(CONNECT_TIMEOUTS.openMs);
    expect(fake.closedWith).toEqual([4000, "open timed out"]);
    expect(h.events).toContain("closed:retry");

    // Its late open finds no handler.
    fake.open();
    expect(h.events).not.toContain("open");
  });

  it("drops an open socket that sends no Hello in time", async () => {
    const h = harness();
    const fake = await h.connected();
    h.clock.advance(CONNECT_TIMEOUTS.helloMs - 1);
    expect(h.socket.isOpen).toBe(true);
    h.clock.advance(1);
    expect(fake.closedWith).toEqual([4000, "hello timed out"]);
    expect(h.retries()).toEqual(["retry:1:500"]);
  });

  it("waits for the gateway's credentials after Hello without a deadline", async () => {
    const h = harness();
    const fake = await h.connected();
    fake.receive(HELLO);
    for (let i = 0; i < 60; i++) {
      h.clock.advance(1000);
      fake.receive(ACK);
    }
    expect(h.socket.isOpen).toBe(true);
    expect(h.events).not.toContain("closed:retry");
  });

  it("drops a socket that is not ready in time after it identifies", async () => {
    const h = harness();
    const fake = await h.connected();
    fake.receive(HELLO);
    h.socket.sendJson({ op: GatewayOp.Identify, d: {} });
    for (let i = 0; i < 19; i++) {
      h.clock.advance(1000);
      fake.receive(ACK);
    }
    expect(h.socket.isOpen).toBe(true);
    h.clock.advance(1000);
    expect(fake.closedWith).toEqual([4000, "ready timed out"]);
  });

  it("keeps a ready socket past every deadline", async () => {
    const h = harness();
    const fake = await h.connected();
    fake.receive(HELLO);
    h.socket.markReady();
    for (let i = 0; i < 60; i++) {
      h.clock.advance(1000);
      fake.receive(ACK);
    }
    expect(h.socket.isReady).toBe(true);
    expect(h.events).not.toContain("closed:retry");
  });

  it("aborts the ticket request on stop and on reconnectNow", async () => {
    const h = harness();
    h.socket.connect();
    h.socket.reconnectNow();
    expect(h.signals[0]!.aborted).toBe(true);
    expect(h.signals[1]!.aborted).toBe(false);
    h.socket.stop();
    expect(h.signals[1]!.aborted).toBe(true);
    h.clock.advance(60_000);
    expect(h.acquireTicket).toHaveBeenCalledTimes(2);
    expect(h.events).not.toContain("ticket-failed");
  });
});

// ── Wake ────────────────────────────────────────────────────────────────────

describe("wake", () => {
  it("retries at once while waiting, and drops the pending timer", async () => {
    const h = harness();
    const fake = await h.connected();
    fake.serverClose(1006);
    expect(h.clock.pending()).toEqual([500]);

    h.socket.wake();
    expect(h.acquireTicket).toHaveBeenCalledTimes(2);
    // Only the new attempt's ticket deadline is left.
    expect(h.clock.pending()).toEqual([CONNECT_TIMEOUTS.ticketMs]);
    h.clock.advance(CONNECT_TIMEOUTS.ticketMs - 1);
    expect(h.acquireTicket).toHaveBeenCalledTimes(2);
  });

  it("probes an open socket and abandons it when nothing answers", async () => {
    const h = harness();
    const fake = await h.connected();

    h.socket.wake();
    h.socket.wake();
    expect(fake.sent).toEqual(['{"op":3}']);
    h.clock.advance(CALL_SOCKET_POLICY.probeMs - 1);
    expect(h.events).not.toContain("closed:retry");

    h.clock.advance(1);
    expect(h.events).toContain("closed:retry");
    expect(fake.closedWith).toEqual([4000, "no reply after wake"]);
    expect(h.socket.isOpen).toBe(false);
    // The late close event from the dead socket is not a second close.
    fake.serverClose(1006);
    expect(h.events.filter((event) => event === "closed:retry")).toHaveLength(
      1,
    );

    h.clock.advance(500);
    expect(h.acquireTicket).toHaveBeenCalledTimes(2);
  });

  it("keeps a healthy socket: any frame clears the probe", async () => {
    const h = harness();
    const fake = await h.connected();

    fake.receive(HELLO);
    h.socket.markReady();
    h.socket.wake();
    fake.receive(ACK);
    // Inside one heartbeat interval: the probe alone decides.
    h.clock.advance(999);

    expect(h.events).not.toContain("closed:retry");
    expect(h.socket.isOpen).toBe(true);
    expect(h.acquireTicket).toHaveBeenCalledTimes(1);
  });

  it("does nothing while a fresh ticket is in flight or after stop", async () => {
    const h = harness();
    h.socket.connect();
    h.socket.wake();
    expect(h.acquireTicket).toHaveBeenCalledTimes(1);

    h.socket.stop();
    h.socket.wake();
    h.clock.advance(60_000);
    expect(h.acquireTicket).toHaveBeenCalledTimes(1);
  });

  it("asks again for a ticket that has been out past the probe window", async () => {
    const h = harness();
    h.socket.connect();
    h.clock.advance(CALL_SOCKET_POLICY.probeMs);
    h.socket.wake();
    expect(h.acquireTicket).toHaveBeenCalledTimes(2);
    expect(h.signals[0]!.aborted).toBe(true);

    // The replaced request answering late changes nothing.
    h.tickets[0]!.resolve({ url: "wss://meet.test/stale" });
    await settle();
    expect(h.sockets).toHaveLength(0);
  });

  it("after a network change, drops an open socket and retries at once", async () => {
    const h = harness();
    const fake = await h.connected();
    fake.receive(HELLO);
    h.socket.markReady();

    h.socket.wake({ networkChanged: true });
    expect(fake.closedWith).toEqual([4000, "network changed"]);
    expect(h.events).toContain("closed:retry");
    expect(h.acquireTicket).toHaveBeenCalledTimes(2);
    // The dead socket's late close is not a second close.
    fake.serverClose(1006);
    expect(h.events.filter((e) => e === "closed:retry")).toHaveLength(1);
  });

  it("after a network change, asks again for a ticket still out", async () => {
    const h = harness();
    h.socket.connect();
    h.socket.wake({ networkChanged: true });
    expect(h.acquireTicket).toHaveBeenCalledTimes(2);
    expect(h.signals[0]!.aborted).toBe(true);
  });
});

describe("server reachable", () => {
  /** A chat socket deep in its backoff after a long outage. */
  async function longOutage(reachability: ServerReachability) {
    const chat = harness(CHAT_SOCKET_POLICY, { reachability });
    const fake = await chat.connected();
    fake.serverClose(1006);
    for (const delay of [1000, 2000, 4000, 8000]) {
      chat.clock.advance(delay);
      await chat.refuseTicket(503);
    }
    expect(chat.clock.pending()).toEqual([16_000]);
    return chat;
  }

  it("retries a socket waiting out a backoff when another socket's ticket gets through", async () => {
    const reachability = createServerReachability();
    const chat = await longOutage(reachability);
    const call = harness(CALL_SOCKET_POLICY, { reachability });

    call.socket.connect();
    expect(chat.acquireTicket).toHaveBeenCalledTimes(5);
    const callSocket = await call.grantTicket();
    expect(chat.acquireTicket).toHaveBeenCalledTimes(6);
    // The backoff timer is gone; only the new ticket's deadline is left.
    expect(chat.clock.pending()).toEqual([CONNECT_TIMEOUTS.ticketMs]);

    // Once per wait: the open that follows does not ask again.
    callSocket.open();
    expect(chat.acquireTicket).toHaveBeenCalledTimes(6);
    const chatSocket = await chat.grantTicket();
    chatSocket.open();
    expect(chat.socket.isOpen).toBe(true);
    // The early retry kept the backoff count (it resets on markReady).
    expect(chat.socket.debugState().retries).toBe(5);
  });

  it("retries a waiting socket when another socket opens", async () => {
    const reachability = createServerReachability();
    const call = harness(CALL_SOCKET_POLICY, { reachability });
    const callSocket = await call.connected();
    const chat = await longOutage(reachability);

    callSocket.serverClose(1006);
    call.clock.advance(500);
    // The chat socket's retry is in flight; another success is not a second one.
    await call.grantTicket();
    expect(chat.acquireTicket).toHaveBeenCalledTimes(6);
    call.sockets.at(-1)!.open();
    expect(chat.acquireTicket).toHaveBeenCalledTimes(6);

    // A retry that fails waits again, and listens again.
    await chat.refuseTicket(503);
    expect(chat.clock.pending()).toEqual([30_000]);
    const third = harness(CALL_SOCKET_POLICY, { reachability });
    await third.connected();
    expect(chat.acquireTicket).toHaveBeenCalledTimes(7);
  });

  it("never wakes a stopped, signed-out or not-retrying socket, or one with a ticket in flight", async () => {
    const reachability = createServerReachability();
    const stopped = harness(CALL_SOCKET_POLICY, { reachability });
    (await stopped.connected()).serverClose(1006);
    stopped.socket.stop();

    const signedOut = harness(CALL_SOCKET_POLICY, { reachability });
    signedOut.socket.connect();
    await signedOut.refuseTicket(401);
    signedOut.clock.advance(500);
    await signedOut.refuseTicket(401);
    expect(signedOut.socket.debugState().phase).toBe("auth-failed");

    const chatSignedOut = harness(CHAT_SOCKET_POLICY, { reachability });
    chatSignedOut.socket.connect();
    await chatSignedOut.refuseTicket(401);
    chatSignedOut.clock.advance(1000);
    await chatSignedOut.refuseTicket(401);
    expect(chatSignedOut.clock.pending()).toEqual([60_000]);

    let retryAllowed = true;
    const notRetrying = harness(CALL_SOCKET_POLICY, {
      reachability,
      shouldRetry: () => retryAllowed,
    });
    (await notRetrying.connected()).serverClose(1006);
    retryAllowed = false;

    const inFlight = harness(CALL_SOCKET_POLICY, { reachability });
    inFlight.socket.connect();

    await harness(CALL_SOCKET_POLICY, { reachability }).connected();

    expect(stopped.acquireTicket).toHaveBeenCalledTimes(1);
    expect(signedOut.acquireTicket).toHaveBeenCalledTimes(2);
    expect(chatSignedOut.acquireTicket).toHaveBeenCalledTimes(2);
    expect(chatSignedOut.clock.pending()).toEqual([60_000]);
    expect(notRetrying.acquireTicket).toHaveBeenCalledTimes(1);
    expect(notRetrying.socket.debugState().phase).toBe("idle");
    expect(notRetrying.clock.pending()).toEqual([]);
    expect(inFlight.acquireTicket).toHaveBeenCalledTimes(1);
  });
});

// ── Give-up rules ───────────────────────────────────────────────────────────

describe("ticket refusals", () => {
  it("retries one 401, then stops with no timer on the second", async () => {
    const h = harness();
    h.socket.connect();
    await h.refuseTicket(401);
    expect(h.events).not.toContain("auth-failed");
    expect(h.retries()).toEqual(["retry:1:500"]);

    h.clock.advance(500);
    await h.refuseTicket(401);
    expect(h.events).toContain("auth-failed");
    expect(h.clock.pending()).toEqual([]);
    h.clock.advance(10 * 60_000);
    expect(h.acquireTicket).toHaveBeenCalledTimes(2);
    expect(h.socket.debugState()).toMatchObject({
      phase: "auth-failed",
      authFailed: true,
    });
  });

  it("wake after the auth failure makes one fresh try", async () => {
    const h = harness();
    h.socket.connect();
    await h.refuseTicket(401);
    h.clock.advance(500);
    await h.refuseTicket(401);

    h.socket.wake();
    expect(h.acquireTicket).toHaveBeenCalledTimes(3);
    await h.refuseTicket(401);
    // Still signed out: reported once, and no retry loop.
    expect(h.events.filter((event) => event === "auth-failed")).toHaveLength(1);
    expect(h.clock.pending()).toEqual([]);

    h.socket.wake();
    const fake = await h.grantTicket();
    expect(fake).toBeDefined();
    expect(h.socket.debugState().authFailed).toBe(false);
  });

  it("backs off and retries a 503, and 401 / 503 / 401 is not two in a row", async () => {
    const h = harness();
    h.socket.connect();
    await h.refuseTicket(503);
    h.clock.advance(500);
    await h.refuseTicket(401);
    h.clock.advance(1000);
    await h.refuseTicket(503);
    h.clock.advance(2000);
    await h.refuseTicket(401);
    h.clock.advance(4000);

    expect(h.acquireTicket).toHaveBeenCalledTimes(5);
    expect(h.events).not.toContain("auth-failed");
    expect(h.retries()).toEqual([
      "retry:1:500",
      "retry:2:1000",
      "retry:3:2000",
      "retry:4:4000",
    ]);
  });

  it("the chat policy keeps a slow retry once signed out, outside the backoff count", async () => {
    const h = harness(CHAT_SOCKET_POLICY);
    h.socket.connect();
    await h.refuseTicket(401);
    h.clock.advance(1000);
    await h.refuseTicket(401);
    expect(h.clock.pending()).toEqual([60_000]);

    h.clock.advance(60_000);
    expect(h.acquireTicket).toHaveBeenCalledTimes(3);
    await h.refuseTicket(503);
    expect(h.clock.pending()).toEqual([60_000]);
    expect(h.retries()).toEqual(["retry:1:1000"]);
  });
});

describe("server give-ups", () => {
  it("stops on admission rejected (4008)", async () => {
    const h = harness();
    const fake = await h.connected();
    fake.serverClose(4008);

    expect(h.events).toContain("closed:admission-rejected");
    expect(h.clock.pending()).toEqual([]);
    h.socket.wake();
    expect(h.acquireTicket).toHaveBeenCalledTimes(1);
  });

  it("reports a replaced connection and does not reconnect", async () => {
    const h = harness();
    const fake = await h.connected();
    fake.serverClose(1000, "Replaced by new connection");

    expect(h.events).toContain("closed:replaced");
    expect(h.clock.pending()).toEqual([]);
    expect(h.socket.debugState().leaving).toBe(true);
  });

  it("treats a session moved to another device (4010) as replaced", async () => {
    const h = harness();
    const fake = await h.connected();
    fake.serverClose(4010, "Voice moved to another device");

    expect(h.events).toContain("closed:replaced");
    expect(h.clock.pending()).toEqual([]);
    h.socket.wake();
    expect(h.acquireTicket).toHaveBeenCalledTimes(1);
  });

  it("does not schedule a retry when the closed hook leaves", async () => {
    const clock = new FakeClock();
    const fake = new FakeSocket("wss://x");
    const socket: RealtimeSocket<RoomGatewayServerMessage> = new RealtimeSocket(
      {
        label: "Test",
        policy: CALL_SOCKET_POLICY,
        decode: decodeRoomGatewayServerFrame,
        acquireTicket: async () => ({ url: "wss://x" }),
        clock,
        createSocket: () => fake as unknown as RealtimeWebSocket,
        hooks: { message: () => {}, closed: () => socket.stop() },
      },
    );
    socket.connect();
    await settle();
    fake.open();
    fake.serverClose(1006);
    expect(clock.pending()).toEqual([]);
  });
});

// ── Attempts and stale events ───────────────────────────────────────────────

describe("attempts", () => {
  it("opens no socket when stopped during the ticket request", async () => {
    const h = harness();
    h.socket.connect();
    h.socket.stop();
    await h.grantTicket();

    expect(h.sockets).toHaveLength(0);
    expect(h.events).not.toContain("ticket");
  });

  it("a fresh connect discards the ticket already in flight", async () => {
    const h = harness();
    h.socket.connect();
    const stale = h.tickets[0]!;
    h.socket.connect();
    expect(h.acquireTicket).toHaveBeenCalledTimes(1);

    h.socket.connect({ freshTicket: true });
    expect(h.acquireTicket).toHaveBeenCalledTimes(2);
    stale.resolve({ url: "wss://meet.test/stale" });
    await settle();
    expect(h.sockets).toHaveLength(0);

    const fake = await h.grantTicket();
    expect(fake.url).toBe("wss://meet.test/socket");
    expect(h.sockets).toHaveLength(1);
  });

  it("reconnectNow replaces an open socket without a close event", async () => {
    const h = harness();
    const first = await h.connected();
    const staleMessage = first.onmessage;
    const staleClose = first.onclose;

    h.socket.reconnectNow();
    expect(first.readyState).toBe(3);
    expect(h.acquireTicket).toHaveBeenCalledTimes(2);
    const second = await h.grantTicket();
    second.open();

    // The replaced socket's callbacks, captured before, change nothing.
    staleMessage?.call(
      first as unknown as WebSocket,
      {
        data: JSON.stringify(HELLO),
      } as MessageEvent,
    );
    staleClose?.call(
      first as unknown as WebSocket,
      {
        code: 1006,
        reason: "",
      } as CloseEvent,
    );
    expect(h.messages).toEqual([]);
    expect(h.events.filter((event) => event.startsWith("closed"))).toEqual([]);
    expect(h.socket.isOpen).toBe(true);
  });

  it("reconnectNow during a ticket request asks again and drops the first", async () => {
    const h = harness();
    h.socket.connect();
    const first = h.tickets[0]!;
    h.socket.reconnectNow();
    first.resolve({ url: "wss://meet.test/first" });
    await settle();
    expect(h.sockets).toHaveLength(0);
    expect((await h.grantTicket()).url).toBe("wss://meet.test/socket");
  });

  it("checks shouldRetry when the retry timer fires", async () => {
    let wanted = true;
    const h = harness(CALL_SOCKET_POLICY, { shouldRetry: () => wanted });
    const fake = await h.connected();
    fake.serverClose(1006);
    wanted = false;
    h.clock.advance(500);
    expect(h.acquireTicket).toHaveBeenCalledTimes(1);

    wanted = true;
    h.socket.connect();
    expect(h.acquireTicket).toHaveBeenCalledTimes(2);
  });
});

// ── Frames, heartbeat, queue ────────────────────────────────────────────────

describe("frames", () => {
  it("drops malformed frames without throwing", async () => {
    const h = harness();
    const fake = await h.connected();

    expect(() => {
      fake.receive("not-json");
      fake.receive("null");
      fake.receive("[1]");
      fake.receive('{"op":"8"}');
      fake.receive(new ArrayBuffer(2));
      fake.receive({ op: GatewayOp.Hello, d: { heartbeat_interval: "soon" } });
      fake.receive({ op: 4242, d: {} });
    }).not.toThrow();
    expect(h.messages).toEqual([]);
    // Only the Hello deadline: nothing above counted as Hello.
    expect(h.clock.pending()).toEqual([CONNECT_TIMEOUTS.helloMs]);

    fake.receive(HELLO);
    expect(h.messages).toEqual([HELLO]);
    // The heartbeat started from Hello's interval.
    expect(h.clock.pending()).toEqual([1000]);
  });

  it("keeps the socket when a message handler throws", async () => {
    const clock = new FakeClock();
    const fake = new FakeSocket("wss://x");
    const seen: number[] = [];
    const socket = new RealtimeSocket<RoomGatewayServerMessage>({
      label: "Test",
      policy: CALL_SOCKET_POLICY,
      decode: decodeRoomGatewayServerFrame,
      acquireTicket: async () => ({ url: "wss://x" }),
      clock,
      createSocket: () => fake as unknown as RealtimeWebSocket,
      hooks: {
        message: (message) => {
          seen.push(message.op);
          throw new Error("handler bug");
        },
      },
    });
    socket.connect();
    await settle();
    fake.open();
    expect(() => {
      fake.receive(HELLO);
      fake.receive(ACK);
    }).not.toThrow();
    expect(seen).toEqual([GatewayOp.Hello, GatewayOp.HeartbeatACK]);
    expect(socket.isOpen).toBe(true);
  });

  it("abandons a zombie socket after three missed heartbeats", async () => {
    const h = harness();
    const fake = await h.connected();
    fake.receive(HELLO);

    h.clock.advance(1000);
    fake.receive(ACK);
    h.clock.advance(3000);
    expect(h.events).not.toContain("closed:retry");
    h.clock.advance(1000);

    expect(fake.sent).toEqual(Array(4).fill('{"op":3}'));
    expect(h.events).toContain("closed:retry");
    expect(fake.closedWith).toEqual([4000, "zombie"]);
  });

  it("queues until identified, keeps the queue across reconnects, clears it on stop", async () => {
    const h = harness();
    h.socket.sendWhenReady({ op: 15, d: { self_mute: true } });
    let fake = await h.connected();
    h.socket.sendWhenReady({ op: 17, d: {} });
    expect(fake.sent).toEqual([]);

    h.socket.reconnectNow();
    fake = await h.grantTicket();
    fake.open();
    expect(h.socket.sendJson({ op: 0, d: { name: "x" } })).toBe(true);
    h.socket.markReady();
    expect(fake.sent.map((data) => JSON.parse(data).op)).toEqual([0, 15, 17]);
    expect(h.socket.isReady).toBe(true);

    fake.serverClose(1006);
    expect(h.socket.isReady).toBe(false);
    h.socket.sendWhenReady({ op: 17, d: {} });
    h.socket.dropQueued(({ op }) => op === 17);
    h.socket.sendWhenReady({ op: 15, d: {} });
    expect(h.socket.debugState().queued).toBe(1);
    h.socket.stop();
    expect(h.socket.debugState().queued).toBe(0);
  });
});
