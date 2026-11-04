import { beforeEach, describe, expect, it } from "vitest";
import {
  VoiceSession,
  type TeardownSteps,
  type VoiceSessionClient,
  type VoiceTimers,
} from "../voice-session";
import type { VoiceEndReason, VoicePhase } from "../state-machine";

/** Hand-cranked timers: nothing fires until `advance`. */
class FakeTimers implements VoiceTimers {
  now = 0;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { at: number; callback: () => void }
  >();

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.pending.set(id, { at: this.now + ms, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  get size(): number {
    return this.pending.size;
  }

  advance(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      const due = [...this.pending.entries()]
        .filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.pending.delete(due[0]);
      this.now = due[1].at;
      due[1].callback();
    }
    this.now = until;
  }
}

class FakeClient implements VoiceSessionClient {
  readonly disconnects: VoiceEndReason[] = [];
  constructor(
    readonly name: string,
    private readonly log: string[],
  ) {}
  disconnect(reason: VoiceEndReason): void {
    this.disconnects.push(reason);
    this.log.push(`${this.name}:disconnect:${reason}`);
  }
}

let log: string[];
let timers: FakeTimers;
let session: VoiceSession<FakeClient>;
let phases: VoicePhase[];
let errors: string[];

function recordingSteps(label = "s"): TeardownSteps<FakeClient> {
  return {
    announceLeave: ({ client, plan }) => {
      log.push(`${label}:announce:${client.name}:${plan.reason}`);
      return () => log.push(`${label}:after-disconnect:${client.name}`);
    },
    releaseLocalMedia: ({ client }) =>
      log.push(`${label}:local-media:${client.name}`),
    clearSessionState: ({ client }) =>
      log.push(`${label}:session-state:${client.name}`),
    releaseClient: ({ client }) =>
      log.push(`${label}:release-client:${client.name}`),
    left: ({ client }) => log.push(`${label}:left:${client.name}`),
  };
}

const notCall = { isCall: false };

function joinedSession(name = "a"): FakeClient {
  const client = new FakeClient(name, log);
  const lease = session.start(client);
  if (!lease) throw new Error("start refused");
  lease.addCleanup(() => log.push(`${name}:unsubscribe`));
  session.markJoined();
  return client;
}

beforeEach(() => {
  log = [];
  errors = [];
  phases = [];
  timers = new FakeTimers();
  session = new VoiceSession<FakeClient>({
    timers,
    onStepError: (step) => errors.push(step),
  });
  session.subscribe((phase) => phases.push(phase));
});

describe("VoiceSession lifecycle", () => {
  it("starts idle with no client", () => {
    expect(session.phase).toBe("idle");
    expect(session.client).toBeNull();
    expect(session.isJoined).toBe(false);
    expect(session.isLive).toBe(false);
  });

  it("goes connecting → joined and reports a re-Ready as already joined", () => {
    const client = new FakeClient("a", log);
    expect(session.start(client)?.client).toBe(client);
    expect(session.phase).toBe("connecting");
    expect(session.client).toBe(client);
    expect(session.isLive).toBe(true);
    expect(session.isJoined).toBe(false);

    expect(session.markJoined()).toEqual({ wasJoined: false });
    expect(session.phase).toBe("joined");
    expect(session.markJoined()).toEqual({ wasJoined: true });
    expect(phases).toEqual(["connecting", "joined"]);
  });

  it("refuses a second start while a session is live", () => {
    const first = new FakeClient("a", log);
    session.start(first);
    expect(session.start(new FakeClient("b", log))).toBeNull();
    session.markJoined();
    expect(session.start(new FakeClient("c", log))).toBeNull();
    expect(session.client).toBe(first);
  });

  it("ignores joined when no session is live", () => {
    expect(session.markJoined()).toBeNull();
    expect(session.phase).toBe("idle");
  });

  it("moves between joined and reconnecting", () => {
    joinedSession();
    expect(session.connectionRestored()).toBe(false);
    expect(session.connectionLost()).toBe(true);
    expect(session.phase).toBe("reconnecting");
    expect(session.isJoined).toBe(true);
    expect(session.connectionLost()).toBe(true);
    expect(session.connectionRestored()).toBe(true);
    expect(session.phase).toBe("joined");

    session.connectionLost();
    expect(session.markJoined()).toEqual({ wasJoined: true });
    expect(session.phase).toBe("joined");
  });

  it("does not enter reconnecting before the session joined", () => {
    session.start(new FakeClient("a", log));
    expect(session.connectionLost()).toBe(false);
    expect(session.phase).toBe("connecting");
  });
});

describe("VoiceSession standby", () => {
  it("holds and releases a borrowed client without disconnecting it", () => {
    const standby = new FakeClient("standby", log);
    expect(session.holdStandby(standby)).toBe(true);
    expect(session.phase).toBe("standby");
    expect(session.client).toBe(standby);
    expect(session.isLive).toBe(false);

    expect(session.releaseStandby(new FakeClient("other", log))).toBe(false);
    expect(session.phase).toBe("standby");
    expect(session.releaseStandby(standby)).toBe(true);
    expect(session.phase).toBe("idle");
    expect(standby.disconnects).toEqual([]);
  });

  it("does not hold a standby while a session is live", () => {
    joinedSession();
    expect(session.holdStandby(new FakeClient("standby", log))).toBe(false);
    expect(session.phase).toBe("joined");
  });

  it("promotes the held standby client on start", () => {
    const standby = new FakeClient("standby", log);
    session.holdStandby(standby);
    const lease = session.start(standby);
    expect(lease?.client).toBe(standby);
    expect(session.phase).toBe("connecting");
    // A standby promoted into a session is no longer releasable as standby.
    expect(session.releaseStandby(standby)).toBe(false);
    expect(session.markJoined()).toEqual({ wasJoined: false });
  });

  it("drops the held reference when another client is started", () => {
    const standby = new FakeClient("standby", log);
    session.holdStandby(standby);
    const claimed = new FakeClient("claimed", log);
    session.start(claimed);
    expect(session.client).toBe(claimed);
    expect(session.releaseStandby(standby)).toBe(false);
    expect(standby.disconnects).toEqual([]);
  });

  it.each(["user-leave", "component-unmount"] as const)(
    "only lets a standby go on %s",
    (reason) => {
      const standby = new FakeClient("standby", log);
      session.holdStandby(standby);
      const outcome = session.end(reason, recordingSteps(), notCall);
      expect(outcome).toEqual({ kind: "standby-released", client: standby });
      expect(session.phase).toBe("idle");
      expect(log).toEqual([]);
      expect(timers.size).toBe(0);
      expect(standby.disconnects).toEqual([]);
    },
  );

  it("tears a standby down as unjoined on a forced disconnect", () => {
    const standby = new FakeClient("standby", log);
    session.holdStandby(standby);
    const outcome = session.end("forced-disconnect", recordingSteps(), notCall);
    expect(outcome.kind).toBe("ended");
    expect(session.phase).toBe("leaving");
    expect(standby.disconnects).toEqual([]);
    timers.advance(100);
    expect(standby.disconnects).toEqual(["forced-disconnect"]);
    expect(log).toContain("s:left:standby");
    expect(session.phase).toBe("idle");
  });
});

describe("VoiceSession teardown", () => {
  it("runs a joined leave in the documented order", () => {
    joinedSession("a");
    const outcome = session.end("user-leave", recordingSteps(), notCall);
    expect(outcome.kind).toBe("ended");
    expect(session.phase).toBe("leaving");
    expect(session.client).toBeNull();
    expect(log).toEqual([
      "s:announce:a:user-leave",
      "a:unsubscribe",
      "s:local-media:a",
      "s:session-state:a",
    ]);

    timers.advance(99);
    expect(log).not.toContain("a:disconnect:user-leave");
    timers.advance(1);
    expect(log.slice(4)).toEqual([
      "a:disconnect:user-leave",
      "s:after-disconnect:a",
      "s:release-client:a",
      "s:left:a",
    ]);
    expect(session.phase).toBe("idle");
    expect(phases).toEqual(["connecting", "joined", "leaving", "idle"]);
  });

  it("disconnects at once and reports nothing when leaving while connecting", () => {
    const client = new FakeClient("a", log);
    session.start(client)?.addCleanup(() => log.push("a:unsubscribe"));
    const outcome = session.end("user-leave", recordingSteps(), notCall);
    expect(outcome.kind === "ended" && outcome.plan.wasJoined).toBe(false);
    expect(log).toEqual([
      "s:announce:a:user-leave",
      "a:unsubscribe",
      "s:local-media:a",
      "s:session-state:a",
      "s:release-client:a",
      "a:disconnect:user-leave",
      "s:after-disconnect:a",
    ]);
    expect(timers.size).toBe(0);
    expect(session.phase).toBe("idle");
  });

  it("releases the client at once on unmount but keeps the send window", () => {
    joinedSession("a");
    session.end("component-unmount", recordingSteps(), notCall);
    expect(log).toContain("s:release-client:a");
    expect(log).not.toContain("a:disconnect:component-unmount");
    timers.advance(100);
    expect(log).toContain("a:disconnect:component-unmount");
    expect(log).not.toContain("s:left:a");
  });

  it("does not report left for a user leave from a call", () => {
    joinedSession("a");
    session.end("user-leave", recordingSteps(), { isCall: true });
    timers.advance(100);
    expect(log).toContain("a:disconnect:user-leave");
    expect(log).not.toContain("s:left:a");
  });

  it("reports left for a forced disconnect of an unjoined session", () => {
    session.start(new FakeClient("a", log));
    session.end("forced-disconnect", recordingSteps(), notCall);
    expect(log).not.toContain("a:disconnect:forced-disconnect");
    timers.advance(100);
    expect(log).toContain("a:disconnect:forced-disconnect");
    expect(log).toContain("s:left:a");
  });

  it("removes subscriptions added after the session ended at once", () => {
    const client = new FakeClient("a", log);
    const lease = session.start(client);
    if (!lease) throw new Error("start refused");
    expect(lease.active).toBe(true);
    session.end("user-leave", {}, notCall);
    expect(lease.active).toBe(false);
    lease.addCleanup(() => log.push("late:unsubscribe"));
    expect(log).toContain("late:unsubscribe");
  });

  it("finishes every step when one of them throws", () => {
    joinedSession("a");
    session.end(
      "user-leave",
      {
        announceLeave: () => {
          throw new Error("sound failed");
        },
        releaseLocalMedia: () => log.push("local-media"),
        left: () => {
          throw new Error("left failed");
        },
      },
      notCall,
    );
    timers.advance(100);
    expect(log).toContain("local-media");
    expect(log).toContain("a:disconnect:user-leave");
    expect(errors).toEqual(["announceLeave", "left"]);
    expect(session.phase).toBe("idle");
  });
});

describe("VoiceSession teardown idempotency", () => {
  it("runs one teardown for a double leave", () => {
    const client = joinedSession("a");
    expect(session.end("user-leave", recordingSteps("1"), notCall).kind).toBe(
      "ended",
    );
    expect(session.end("user-leave", recordingSteps("2"), notCall)).toEqual({
      kind: "none",
    });
    timers.advance(200);
    expect(client.disconnects).toEqual(["user-leave"]);
    expect(log.filter((entry) => entry.startsWith("2:"))).toEqual([]);
    expect(log.filter((entry) => entry.endsWith(":left:a"))).toHaveLength(1);
  });

  it("does nothing when idle", () => {
    for (const reason of [
      "user-leave",
      "forced-disconnect",
      "component-unmount",
    ] as const) {
      expect(session.end(reason, recordingSteps(), notCall)).toEqual({
        kind: "none",
      });
    }
    expect(log).toEqual([]);
  });

  it("ignores a forced disconnect during a leave", () => {
    const client = joinedSession("a");
    session.end("user-leave", recordingSteps("leave"), notCall);
    expect(
      session.end("forced-disconnect", recordingSteps("force"), notCall),
    ).toEqual({ kind: "none" });
    timers.advance(100);
    expect(client.disconnects).toEqual(["user-leave"]);
    expect(log.filter((entry) => entry.startsWith("force:"))).toEqual([]);
    expect(log).toContain("leave:left:a");
  });

  it("completes a pending leave at once on unmount", () => {
    const client = joinedSession("a");
    session.end("user-leave", recordingSteps("leave"), notCall);
    expect(
      session.end("component-unmount", recordingSteps("unmount"), notCall),
    ).toEqual({ kind: "none" });
    expect(client.disconnects).toEqual(["user-leave"]);
    expect(log).toContain("leave:release-client:a");
    expect(log).toContain("leave:left:a");
    expect(timers.size).toBe(0);
    expect(session.phase).toBe("idle");
    timers.advance(200);
    expect(client.disconnects).toEqual(["user-leave"]);
  });

  it("tears a reconnecting session down as joined on unmount", () => {
    const client = joinedSession("a");
    session.connectionLost();
    const outcome = session.end("component-unmount", recordingSteps(), notCall);
    expect(outcome.kind === "ended" && outcome.plan.wasJoined).toBe(true);
    expect(outcome.kind === "ended" && outcome.plan.leaveTrigger).toBe(true);
    expect(client.disconnects).toEqual([]);
    timers.advance(100);
    expect(client.disconnects).toEqual(["component-unmount"]);
    expect(session.phase).toBe("idle");
  });

  it("lets a new session start inside a leave's send window", () => {
    const first = joinedSession("a");
    session.end("user-leave", recordingSteps("first"), notCall);
    const second = new FakeClient("b", log);
    expect(session.start(second)?.client).toBe(second);
    expect(session.phase).toBe("connecting");

    timers.advance(100);
    expect(first.disconnects).toEqual(["user-leave"]);
    expect(log).toContain("first:left:a");
    // The old leave finishing does not touch the new session.
    expect(session.phase).toBe("connecting");
    expect(session.client).toBe(second);
    expect(second.disconnects).toEqual([]);
  });

  it("goes idle only after the last pending leave drained", () => {
    joinedSession("a");
    session.end("user-leave", recordingSteps("first"), notCall);
    timers.advance(50);
    joinedSession("b");
    session.end("user-leave", recordingSteps("second"), notCall);
    timers.advance(50);
    expect(log).toContain("first:left:a");
    expect(session.phase).toBe("leaving");
    timers.advance(50);
    expect(log).toContain("second:left:b");
    expect(session.phase).toBe("idle");
  });

  it("completes several pending leaves on unmount", () => {
    const first = joinedSession("a");
    session.end("user-leave", recordingSteps("first"), notCall);
    const second = joinedSession("b");
    session.end("component-unmount", recordingSteps("unmount"), notCall);
    expect(first.disconnects).toEqual(["user-leave"]);
    expect(second.disconnects).toEqual([]);
    timers.advance(100);
    expect(second.disconnects).toEqual(["component-unmount"]);
    expect(session.phase).toBe("idle");
  });
});

describe("VoiceSession client changes", () => {
  it("reports every change of the session's client before phase listeners", () => {
    const seen: Array<string | null> = [];
    const order: string[] = [];
    const reporting = new VoiceSession<FakeClient>({
      timers,
      onClientChange: (client) => {
        seen.push(client?.name ?? null);
        order.push(`client:${client?.name ?? null}`);
      },
    });
    reporting.subscribe((phase) => order.push(`phase:${phase}`));
    const standby = new FakeClient("standby", log);
    reporting.holdStandby(standby);
    // Promoting the held client keeps the same client: nothing to report.
    reporting.start(standby);
    reporting.markJoined();
    reporting.end("user-leave", {}, notCall);
    reporting.start(new FakeClient("b", log));
    timers.advance(100);
    reporting.end("user-leave", {}, notCall);

    expect(seen).toEqual(["standby", null, "b", null]);
    expect(order.slice(0, 2)).toEqual(["client:standby", "phase:standby"]);
  });
});
