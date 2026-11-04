// One voice session's lifecycle: which client it has, which phase it is in,
// and the single teardown every way of ending it goes through. Platform
// work (media, sounds, stores) is injected per teardown as ordered steps;
// timers are injected once. No React, no DOM.

import {
  isJoinedPhase,
  isLivePhase,
  nextPhase,
  planTeardown,
  type TeardownOptions,
  type TeardownPlan,
  type VoiceEndReason,
  type VoicePhase,
  type VoiceSessionEvent,
} from "./state-machine";

/** The part of a voice client (web: SFUClient) the session drives. */
export interface VoiceSessionClient {
  /**
   * Sends ClientDisconnect on both call sockets, closes them and disposes the
   * media session. Must be idempotent: a second call does nothing.
   */
  disconnect(reason: VoiceEndReason): void;
}

/** Timers, injected so tests and other runtimes control time. */
export interface VoiceTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface TeardownContext<C> {
  readonly client: C;
  readonly plan: TeardownPlan;
}

/**
 * The platform's part of one teardown, run in this order (any step may be
 * left out). Every step runs even if an earlier one threw.
 *
 * 1. `announceLeave`: sounds and the automatic leave trigger, while the
 *    sockets are still open. May return a callback run right after the
 *    client disconnects (for example to reset what the trigger used).
 * 2. (session) the client's event subscriptions are removed.
 * 3. `releaseLocalMedia`: local tracks, audio processors, VAD monitors,
 *    capture owners. Nothing local outlives this step.
 * 4. `clearSessionState`: roster, id maps, speaking, UI store, presence.
 * 5. `releaseClient` when the plan says `now`.
 * 6. (session) after the plan's send window: `client.disconnect(reason)`,
 *    then the callback from step 1, then `releaseClient` when the plan says
 *    `after-disconnect`, then `left` when the plan says `notifyLeft`.
 */
export interface TeardownSteps<C> {
  announceLeave?(context: TeardownContext<C>): void | (() => void);
  releaseLocalMedia?(context: TeardownContext<C>): void;
  clearSessionState?(context: TeardownContext<C>): void;
  releaseClient?(context: TeardownContext<C>): void;
  left?(context: TeardownContext<C>): void;
}

export type TeardownStep =
  | "announceLeave"
  | "unsubscribe"
  | "releaseLocalMedia"
  | "clearSessionState"
  | "releaseClient"
  | "disconnect"
  | "afterDisconnect"
  | "left";

export type EndOutcome<C> =
  /** Nothing to end: idle, or the session is already leaving. */
  | { readonly kind: "none" }
  /** Only a held standby client was let go; nothing was torn down. */
  | { readonly kind: "standby-released"; readonly client: C }
  /** The teardown ran (the disconnect may still be in its send window). */
  | {
      readonly kind: "ended";
      readonly client: C;
      readonly plan: TeardownPlan;
    };

/** The session's hold on the client it started with. */
export interface SessionLease<C> {
  readonly client: C;
  /** False once that session ended (or another one replaced it). */
  readonly active: boolean;
  /**
   * Runs `cleanup` when that session ends (teardown step 2), or at once if
   * it already has. For the client's event subscriptions.
   */
  addCleanup(cleanup: () => void): void;
}

export interface VoiceSessionOptions<C = unknown> {
  readonly timers: VoiceTimers;
  /** Called when a teardown step throws; the teardown carries on. */
  readonly onStepError?: (step: TeardownStep, error: unknown) => void;
  /**
   * Called synchronously whenever {@link VoiceSession.client} changes, before
   * any phase listener or teardown step runs, so a platform can mirror the
   * client where it reads it (web: the hook's `sfuRef`).
   */
  readonly onClientChange?: (client: C | null) => void;
}

export type VoicePhaseListener = (
  phase: VoicePhase,
  previous: VoicePhase,
) => void;

interface Slot<C> {
  readonly kind: "standby" | "owned";
  readonly client: C;
  active: boolean;
  readonly cleanups: Array<() => void>;
}

interface Drain<C> {
  readonly context: TeardownContext<C>;
  readonly steps: TeardownSteps<C>;
  readonly afterDisconnect: (() => void) | undefined;
  timer: unknown;
  done: boolean;
}

export class VoiceSession<C extends VoiceSessionClient> {
  private currentPhase: VoicePhase = "idle";
  private slot: Slot<C> | null = null;
  private readonly drains = new Set<Drain<C>>();
  private readonly listeners = new Set<VoicePhaseListener>();
  private readonly timers: VoiceTimers;
  private readonly onStepError: VoiceSessionOptions<C>["onStepError"];
  private readonly onClientChange: VoiceSessionOptions<C>["onClientChange"];
  private reportedClient: C | null = null;

  constructor(options: VoiceSessionOptions<C>) {
    this.timers = options.timers;
    this.onStepError = options.onStepError;
    this.onClientChange = options.onClientChange;
  }

  get phase(): VoicePhase {
    return this.currentPhase;
  }

  /**
   * The client of the session there is now: the held standby client, or the
   * owned one while connecting, joined or reconnecting. `null` when idle and
   * while leaving (a leaving client is not the session's any more).
   */
  get client(): C | null {
    return this.slot?.client ?? null;
  }

  /** `joined` or `reconnecting`. */
  get isJoined(): boolean {
    return isJoinedPhase(this.currentPhase);
  }

  /** `connecting`, `joined` or `reconnecting`: a session owns a client. */
  get isLive(): boolean {
    return isLivePhase(this.currentPhase);
  }

  get isStandby(): boolean {
    return this.currentPhase === "standby";
  }

  /** Teardowns still inside their send window. */
  get pendingLeaves(): number {
    return this.drains.size;
  }

  subscribe(listener: VoicePhaseListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Holds a pre-connected standby client (borrowed: never disconnected). */
  holdStandby(client: C): boolean {
    const event: VoiceSessionEvent = { type: "hold-standby" };
    if (nextPhase(this.currentPhase, event) === null) return false;
    this.slot = { kind: "standby", client, active: true, cleanups: [] };
    this.apply(event);
    return true;
  }

  /** Lets the held standby `client` go. False if it is not the one held. */
  releaseStandby(client: C): boolean {
    if (this.slot?.kind !== "standby" || this.slot.client !== client) {
      return false;
    }
    this.slot.active = false;
    this.slot = null;
    this.apply({ type: "release-standby" });
    return true;
  }

  /**
   * Starts a session on `client`: a new one, or the held/claimed standby
   * client being promoted. Returns null (and changes nothing) while a
   * session is live.
   */
  start(client: C): SessionLease<C> | null {
    if (nextPhase(this.currentPhase, { type: "start" }) === null) return null;
    if (this.slot) this.slot.active = false;
    const slot: Slot<C> = { kind: "owned", client, active: true, cleanups: [] };
    this.slot = slot;
    this.apply({ type: "start" });
    return {
      client,
      get active() {
        return slot.active;
      },
      addCleanup: (cleanup) => {
        if (slot.active) slot.cleanups.push(cleanup);
        else this.runStep("unsubscribe", cleanup);
      },
    };
  }

  /**
   * The room said `Ready`. Returns whether the session was already joined
   * (a re-`Ready` after a reconnect), or null if no session is live.
   */
  markJoined(): { readonly wasJoined: boolean } | null {
    const wasJoined = this.isJoined;
    return this.apply({ type: "joined" }) ? { wasJoined } : null;
  }

  connectionLost(): boolean {
    return this.apply({ type: "connection-lost" });
  }

  connectionRestored(): boolean {
    return this.apply({ type: "connection-restored" });
  }

  /**
   * The one teardown. Idempotent: ending an idle or leaving session does
   * nothing. `component-unmount` first completes every pending leave (their
   * send windows are cut short; nothing is cancelled).
   */
  end(
    reason: VoiceEndReason,
    steps: TeardownSteps<C>,
    options: TeardownOptions,
  ): EndOutcome<C> {
    if (reason === "component-unmount") this.flush();
    const slot = this.slot;
    if (!slot) return { kind: "none" };
    const event: VoiceSessionEvent = { type: "end", reason };
    const next = nextPhase(this.currentPhase, event);
    if (next === null) return { kind: "none" };

    if (next === "idle") {
      // A held standby is only let go; its owner decides what to do with it.
      slot.active = false;
      this.slot = null;
      this.apply(event);
      return { kind: "standby-released", client: slot.client };
    }

    const plan = planTeardown(reason, this.isJoined, options);
    const context: TeardownContext<C> = { client: slot.client, plan };
    slot.active = false;
    this.slot = null;
    this.apply(event);

    let afterDisconnect: (() => void) | undefined;
    this.runStep("announceLeave", () => {
      afterDisconnect = steps.announceLeave?.(context) ?? undefined;
    });
    for (const cleanup of slot.cleanups.splice(0)) {
      this.runStep("unsubscribe", cleanup);
    }
    this.runStep("releaseLocalMedia", () => steps.releaseLocalMedia?.(context));
    this.runStep("clearSessionState", () => steps.clearSessionState?.(context));
    if (plan.releaseClient === "now") {
      this.runStep("releaseClient", () => steps.releaseClient?.(context));
    }

    const drain: Drain<C> = {
      context,
      steps,
      afterDisconnect,
      timer: null,
      done: false,
    };
    if (plan.sendWindowMs > 0) {
      this.drains.add(drain);
      drain.timer = this.timers.setTimeout(
        () => this.finish(drain),
        plan.sendWindowMs,
      );
    } else {
      this.finish(drain);
    }
    return { kind: "ended", client: slot.client, plan };
  }

  /** Completes every pending leave now (disconnect, release, `left`). */
  flush(): void {
    for (const drain of [...this.drains]) this.finish(drain);
  }

  private finish(drain: Drain<C>): void {
    if (drain.done) return;
    drain.done = true;
    if (this.drains.delete(drain)) this.timers.clearTimeout(drain.timer);
    const { context, steps } = drain;
    this.runStep("disconnect", () =>
      context.client.disconnect(context.plan.reason),
    );
    if (drain.afterDisconnect) {
      this.runStep("afterDisconnect", drain.afterDisconnect);
    }
    if (context.plan.releaseClient === "after-disconnect") {
      this.runStep("releaseClient", () => steps.releaseClient?.(context));
    }
    if (context.plan.notifyLeft) {
      this.runStep("left", () => steps.left?.(context));
    }
    if (this.currentPhase === "leaving" && this.drains.size === 0) {
      this.apply({ type: "drained" });
    }
  }

  private apply(event: VoiceSessionEvent): boolean {
    const previous = this.currentPhase;
    const next = nextPhase(previous, event);
    if (next === null) return false;
    this.currentPhase = next;
    const client = this.client;
    if (client !== this.reportedClient) {
      this.reportedClient = client;
      this.onClientChange?.(client);
    }
    if (next !== previous) {
      for (const listener of [...this.listeners]) listener(next, previous);
    }
    return true;
  }

  private runStep(step: TeardownStep, run: () => void): void {
    try {
      run();
    } catch (error) {
      this.onStepError?.(step, error);
    }
  }
}
