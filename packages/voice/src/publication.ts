// Publication reconciliation: make what this client publishes match what
// the user wants, with the fewest media operations, through an injected
// media interface. Initial publish, outbound-stall recovery and the
// republish after a voice reconnect all go through it. No React, no DOM.
// See STATE_MACHINE.md, "Publication".

import type { VoiceTimers } from "./voice-session";

/** The slots that hold one track each. */
export type TrackSlot = "microphone" | "camera";

/**
 * What a client publishes: its microphone and camera (one track each) and
 * its screen share (the share's tracks, published and withdrawn together).
 */
export type PublicationSlot = TrackSlot | "screen";

/** Reconciled in this order: what peers hear first. */
export const PUBLICATION_SLOTS: readonly PublicationSlot[] = [
  "microphone",
  "camera",
  "screen",
];

/**
 * What the `screen` slot holds. A new object for every share: the
 * reconciler compares them by identity.
 *
 * - `tracks`: a share captured by the platform's media stack (web:
 *   getDisplayMedia or a desktop capture through CEF), published like the
 *   camera (web: PartyTracks, `screen-video-<id>` and `screen-audio-<id>`).
 * - `native`: a share the native pipeline captures, encodes and publishes
 *   itself (web desktop: the Rust hardware publisher). The reconciler only
 *   records it (see {@link PublicationReconciler.adopt}) so that withdrawing
 *   the share is still its `unpublish`; a platform's `publish` of it does
 *   nothing.
 */
export type ScreenPublication<T> =
  | { readonly kind: "tracks"; readonly video: T; readonly audio: T | null }
  | { readonly kind: "native" };

/** A slot's value: a track, or for `screen` a {@link ScreenPublication}. */
export type PublicationValue<T> = T | ScreenPublication<T>;

/** What the user wants on one slot. */
export interface SlotIntent<T> {
  /**
   * The track to publish (web: the audio processor's output, the raw
   * capture, the camera effect's output), or null for nothing.
   */
  readonly track: T | null;
  /**
   * Whether the published track sends (the microphone's mute). Changing it
   * never replaces or republishes anything.
   */
  readonly enabled: boolean;
}

/**
 * The platform's publications (web: SFUClient over PartyTracks). Every
 * method may reject or throw; the reconciler retries. On `microphone` and
 * `camera` the value is a track; on `screen` it is a
 * {@link ScreenPublication}.
 */
export interface PublicationMedia<T> {
  /**
   * Publishes `track` on `slot`. On a slot that is already published (or
   * withdrawn and kept alive) this MUST behave as a replacement of its
   * source, so publishing twice is harmless. A `native` screen publication
   * is already published by its pipeline: nothing to do.
   */
  publish(
    slot: PublicationSlot,
    track: PublicationValue<T>,
  ): Promise<void> | void;
  /**
   * Swaps the source of the slot's existing publication. Resolves false
   * when there is no publication to swap (the reconciler then publishes).
   */
  replace(
    slot: PublicationSlot,
    track: PublicationValue<T>,
  ): Promise<boolean> | boolean;
  /** Stops offering the slot's publication. */
  unpublish(slot: PublicationSlot): Promise<void> | void;
  /**
   * Mutes or unmutes the slot's published track (on `screen`: the share's
   * audio). Synchronous.
   */
  setEnabled(slot: PublicationSlot, enabled: boolean): void;
  /** Whether the media session has a publication on `slot` right now. */
  isPublished(slot: PublicationSlot): boolean;
}

/** One media operation. */
export type PublicationOp<T> =
  | {
      readonly kind: "publish";
      readonly slot: PublicationSlot;
      readonly track: PublicationValue<T>;
    }
  | {
      readonly kind: "replace";
      readonly slot: PublicationSlot;
      readonly track: PublicationValue<T>;
    }
  | { readonly kind: "unpublish"; readonly slot: PublicationSlot }
  | {
      readonly kind: "set-enabled";
      readonly slot: PublicationSlot;
      readonly enabled: boolean;
    };

/**
 * What the reconciler made true on a slot on the current connection.
 * `undefined` (no record) means unknown: nothing was done on this
 * connection yet, or a replacement found no publication.
 */
export interface AppliedSlot<T> {
  /** The published source, or null once unpublished. */
  readonly track: T | null;
  /** The last `setEnabled` applied to that source; null: none yet. */
  readonly enabled: boolean | null;
}

export type PublicationIntent<T> = Readonly<{
  microphone: SlotIntent<T>;
  camera: SlotIntent<T>;
  /** Missing: nothing wanted. `enabled` is whether the share's audio sends. */
  screen?: SlotIntent<ScreenPublication<T>>;
}>;
export type AppliedPublications<T> = Readonly<{
  microphone?: AppliedSlot<T>;
  camera?: AppliedSlot<T>;
  screen?: AppliedSlot<ScreenPublication<T>>;
}>;

type AnyIntent<T> = SlotIntent<PublicationValue<T>>;
type AnyApplied<T> = AppliedSlot<PublicationValue<T>>;

/**
 * The operations that take `applied` to `intent`. Pure. Per slot, in
 * {@link PUBLICATION_SLOTS} order:
 *
 * - wanted nothing: `unpublish` if this connection published a track on it
 *   and has not unpublished it since; when this connection has no record
 *   for the slot, `unpublish` if the media session reports a publication
 *   there. Once this connection unpublished the slot, nothing, whatever the
 *   media session reports (a withdrawn camera kept alive still has a
 *   sender), so the plan converges.
 * - wanted a track already applied on this connection: no track operation.
 * - wanted a track, and this connection published another one: `replace`.
 * - wanted a track, and nothing is known on this connection: `publish`.
 * - after a track operation, or when the applied `enabled` differs:
 *   `set-enabled`.
 */
export function planPublication<T>(
  intent: PublicationIntent<T>,
  applied: AppliedPublications<T>,
  isPublished: (slot: PublicationSlot) => boolean,
): PublicationOp<T>[] {
  return planSlots<T>(intent, applied, isPublished);
}

function planSlots<T>(
  intent: Readonly<Partial<Record<PublicationSlot, AnyIntent<T>>>>,
  applied: Readonly<Partial<Record<PublicationSlot, AnyApplied<T>>>>,
  isPublished: (slot: PublicationSlot) => boolean,
): PublicationOp<T>[] {
  const ops: PublicationOp<T>[] = [];
  for (const slot of PUBLICATION_SLOTS) {
    const want: AnyIntent<T> = intent[slot] ?? NO_INTENT;
    const have: AnyApplied<T> | undefined = applied[slot];
    if (want.track === null) {
      const published = have ? have.track !== null : isPublished(slot);
      if (published) {
        ops.push({ kind: "unpublish", slot });
      }
      continue;
    }
    let trackOp = true;
    if (have && have.track === want.track) trackOp = false;
    else if (have && have.track !== null) {
      ops.push({ kind: "replace", slot, track: want.track });
    } else {
      ops.push({ kind: "publish", slot, track: want.track });
    }
    if (trackOp || have?.enabled !== want.enabled) {
      ops.push({ kind: "set-enabled", slot, enabled: want.enabled });
    }
  }
  return ops;
}

export interface PublicationRetryPolicy {
  /** Failed operations in a row before a run gives up. */
  readonly attempts: number;
  /** Wait after the first failure; doubles per failure. */
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

/** 3 attempts, waiting 150 ms then 300 ms between them. */
export const PUBLICATION_RETRY: PublicationRetryPolicy = {
  attempts: 3,
  baseDelayMs: 150,
  maxDelayMs: 1_000,
};

/** The wait before retry number `failures` (1-based). */
export function publicationRetryDelay(
  failures: number,
  policy: PublicationRetryPolicy = PUBLICATION_RETRY,
): number {
  return Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** Math.max(0, failures - 1),
  );
}

export type ReconcileResult<T> =
  /** Every slot matches the intent there is now. */
  | { readonly status: "converged" }
  /**
   * The retry budget ran out on `op` (the first slot it ran out on); the
   * intent is kept. Every other slot converged, except `failedSlots`.
   */
  | {
      readonly status: "failed";
      readonly op: PublicationOp<T>;
      readonly error: unknown;
      /** Every slot whose budget ran out in this run (includes `op.slot`). */
      readonly failedSlots: readonly PublicationSlot[];
    }
  /** The reconciler was disposed (the session ended). */
  | { readonly status: "disposed" };

/**
 * `connection` moves on every {@link PublicationReconciler.connectionReset}
 * and decides which operation results still count (one from an older
 * connection is ignored). A slot's number moves whenever its intended track
 * changes (never for `enabled`) and decides whether a caller's intent still
 * stands ({@link PublicationReconciler.isCurrent}).
 */
export interface PublicationGeneration {
  readonly connection: number;
  readonly microphone: number;
  readonly camera: number;
  readonly screen: number;
}

export interface PublicationReconcilerOptions<T> {
  readonly media: PublicationMedia<T>;
  readonly timers: VoiceTimers;
  readonly retry?: PublicationRetryPolicy;
  /** Each failed operation (the run carries on until the budget is spent). */
  readonly onOpError?: (
    op: PublicationOp<T>,
    error: unknown,
    failures: number,
  ) => void;
}

const NO_INTENT: SlotIntent<never> = { track: null, enabled: true };

type OpOutcome = { readonly ok: true } | { readonly ok: false; error: unknown };

/**
 * Owns one client's microphone, camera and screen publications. Platforms
 * set the intent ({@link setTrack}, {@link setEnabled}) and ask for a
 * {@link reconcile}; only the reconciler publishes, replaces or unpublishes.
 */
export class PublicationReconciler<T> {
  private readonly media: PublicationMedia<T>;
  private readonly timers: VoiceTimers;
  private readonly retry: PublicationRetryPolicy;
  private readonly onOpError: PublicationReconcilerOptions<T>["onOpError"];
  private intent: Record<PublicationSlot, AnyIntent<T>> = {
    microphone: NO_INTENT,
    camera: NO_INTENT,
    screen: NO_INTENT,
  };
  private versions: Record<PublicationSlot, number> = {
    microphone: 0,
    camera: 0,
    screen: 0,
  };
  private applied: Partial<Record<PublicationSlot, AnyApplied<T>>> = {};
  private connection = 0;
  /** The connection whose run is active, if any. */
  private running: number | null = null;
  private dirty = false;
  private failures = 0;
  /**
   * Slots whose retry budget ran out in the run in flight, with the failed
   * operation: set aside so the other slots still converge.
   */
  private setAside = new Map<
    PublicationSlot,
    { readonly op: PublicationOp<T>; readonly error: unknown }
  >();
  private backoff: { timer: unknown; wake: () => void } | null = null;
  private waiters: Array<(result: ReconcileResult<T>) => void> = [];
  private disposed = false;

  constructor(options: PublicationReconcilerOptions<T>) {
    this.media = options.media;
    this.timers = options.timers;
    this.retry = options.retry ?? PUBLICATION_RETRY;
    this.onOpError = options.onOpError;
  }

  get generation(): PublicationGeneration {
    return {
      connection: this.connection,
      microphone: this.versions.microphone,
      camera: this.versions.camera,
      screen: this.versions.screen,
    };
  }

  /** Whether a run is in flight (or waiting out a retry). */
  get busy(): boolean {
    return this.running === this.connection;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  intentFor(slot: TrackSlot): SlotIntent<T>;
  intentFor(slot: "screen"): SlotIntent<ScreenPublication<T>>;
  intentFor(slot: PublicationSlot): AnyIntent<T> {
    return this.intent[slot];
  }

  /** What this connection has on `slot`; undefined when unknown. */
  appliedFor(slot: TrackSlot): AppliedSlot<T> | undefined;
  appliedFor(slot: "screen"): AppliedSlot<ScreenPublication<T>> | undefined;
  appliedFor(slot: PublicationSlot): AnyApplied<T> | undefined {
    return this.applied[slot];
  }

  /**
   * Whether the intent `generation` was taken under still stands for
   * `slot` (nobody set another track there since). A connection reset does
   * not end it: the reconciler publishes the same intent again on the new
   * connection, and {@link reconcile} only resolves `converged` once it has.
   * A mute never ends it.
   */
  isCurrent(generation: PublicationGeneration, slot: PublicationSlot): boolean {
    return !this.disposed && generation[slot] === this.versions[slot];
  }

  /**
   * Sets the track wanted on `slot` (null: nothing). Does not start a run;
   * call {@link reconcile}. A run in flight re-plans before its next
   * operation, and one waiting out a retry stops waiting.
   */
  setTrack(slot: TrackSlot, track: T | null): void;
  setTrack(slot: "screen", share: ScreenPublication<T> | null): void;
  setTrack(slot: PublicationSlot, track: PublicationValue<T> | null): void {
    if (this.disposed) return;
    const current = this.intent[slot];
    if (current.track === track) return;
    this.intent = { ...this.intent, [slot]: { ...current, track } };
    this.versions = { ...this.versions, [slot]: this.versions[slot] + 1 };
    // A new intent gets a budget of its own, even in the run in flight.
    this.setAside.delete(slot);
    this.dirty = true;
    // A run waiting out a retry plans again at once.
    this.backoff?.wake();
  }

  /**
   * Mutes or unmutes `slot`. Applied at once to the track this connection
   * published there, even while a run is in flight; a run that publishes
   * or replaces it applies the latest value afterwards. Never moves a
   * generation, so it cannot cancel a publication, a recovery or a
   * republish.
   */
  setEnabled(slot: PublicationSlot, enabled: boolean): void {
    if (this.disposed) return;
    const current = this.intent[slot];
    if (current.enabled !== enabled) {
      this.intent = { ...this.intent, [slot]: { ...current, enabled } };
    }
    const have = this.applied[slot];
    if (have && have.track !== null && have.enabled !== enabled) {
      this.media.setEnabled(slot, enabled);
      this.applied = { ...this.applied, [slot]: { ...have, enabled } };
    }
  }

  /**
   * Records `track` as already published on `slot` by someone else on this
   * connection (web: a promoted standby's silence; a native screen share,
   * published by its own pipeline), so the reconciler replaces or withdraws
   * it rather than publishing beside it. Takes it as the intent when nothing
   * is wanted on the slot yet.
   */
  adopt(slot: TrackSlot, track: T, enabled?: boolean | null): void;
  adopt(
    slot: "screen",
    share: ScreenPublication<T>,
    enabled?: boolean | null,
  ): void;
  adopt(
    slot: PublicationSlot,
    track: PublicationValue<T>,
    enabled: boolean | null = null,
  ): void {
    if (this.disposed) return;
    this.applied = { ...this.applied, [slot]: { track, enabled } };
    if (this.intent[slot].track === null) {
      this.intent = {
        ...this.intent,
        [slot]: { ...this.intent[slot], track },
      };
      this.versions = { ...this.versions, [slot]: this.versions[slot] + 1 };
    }
  }

  /**
   * The media session was replaced or lost its publications (web: the
   * voice socket is ready again and PartyTracks has none). Forgets what was
   * applied, abandons the run in flight (its late results are ignored) and
   * the retry budget, and starts a run that publishes every wanted track
   * afresh.
   */
  connectionReset(): void {
    if (this.disposed) return;
    this.connection += 1;
    this.applied = {};
    this.failures = 0;
    this.cancelBackoff();
    this.dirty = true;
    this.start();
  }

  /**
   * Runs (or joins the run in flight) until every slot matches the latest
   * intent, the retry budget runs out, or the reconciler is disposed.
   */
  reconcile(): Promise<ReconcileResult<T>> {
    if (this.disposed) return Promise.resolve({ status: "disposed" });
    const result = new Promise<ReconcileResult<T>>((resolve) => {
      this.waiters.push(resolve);
    });
    this.dirty = true;
    this.start();
    return result;
  }

  /** Ends every run; pending {@link reconcile} calls resolve `disposed`. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelBackoff();
    this.settle({ status: "disposed" });
  }

  private start(): void {
    if (this.backoff) {
      // A new intent or an explicit reconcile does not wait out a retry.
      this.backoff.wake();
      return;
    }
    if (this.running === this.connection) return;
    void this.run(this.connection);
  }

  private async run(connection: number): Promise<void> {
    this.running = connection;
    this.setAside = new Map();
    try {
      while (this.owns(connection)) {
        this.dirty = false;
        const ops = planSlots<T>(this.intent, this.applied, (slot) =>
          this.media.isPublished(slot),
        ).filter((op) => !this.setAside.has(op.slot));
        if (ops.length === 0) {
          this.failures = 0;
          const failed = this.setAside.values().next();
          const failedSlots = [...this.setAside.keys()];
          this.setAside = new Map();
          this.settle(
            failed.done
              ? { status: "converged" }
              : {
                  status: "failed",
                  op: failed.value.op,
                  error: failed.value.error,
                  failedSlots,
                },
          );
          return;
        }
        for (const op of ops) {
          if (this.dirty) break;
          const outcome = await this.execute(op, connection);
          if (!this.owns(connection)) return;
          if (outcome.ok) continue;
          this.failures += 1;
          this.onOpError?.(op, outcome.error, this.failures);
          if (this.failures >= this.retry.attempts) {
            // This slot is spent for the run; the others still converge.
            this.failures = 0;
            this.setAside.set(op.slot, { op, error: outcome.error });
            break;
          }
          await this.wait(publicationRetryDelay(this.failures, this.retry));
          break;
        }
      }
    } finally {
      if (this.running === connection) this.running = null;
    }
  }

  private owns(connection: number): boolean {
    return !this.disposed && connection === this.connection;
  }

  private async execute(
    op: PublicationOp<T>,
    connection: number,
  ): Promise<OpOutcome> {
    const slot = op.slot;
    try {
      switch (op.kind) {
        case "publish":
          await this.media.publish(slot, op.track);
          if (this.owns(connection)) this.record(slot, op.track);
          break;
        case "replace": {
          const replaced = await this.media.replace(slot, op.track);
          if (!this.owns(connection)) break;
          if (replaced) this.record(slot, op.track);
          else {
            // Nothing to swap: publish on the next pass.
            const rest = { ...this.applied };
            delete rest[slot];
            this.applied = rest;
          }
          break;
        }
        case "unpublish":
          await this.media.unpublish(slot);
          if (this.owns(connection)) this.record(slot, null);
          break;
        case "set-enabled": {
          // The latest value, not the planned one: a mute may have landed
          // since the plan was made.
          const enabled = this.intent[slot].enabled;
          const have = this.applied[slot];
          if (!have || have.track === null) break;
          this.media.setEnabled(slot, enabled);
          this.applied = { ...this.applied, [slot]: { ...have, enabled } };
          break;
        }
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  private record(
    slot: PublicationSlot,
    track: PublicationValue<T> | null,
  ): void {
    this.applied = { ...this.applied, [slot]: { track, enabled: null } };
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const wake = () => {
        if (this.backoff?.wake !== wake) return;
        this.timers.clearTimeout(this.backoff.timer);
        this.backoff = null;
        resolve();
      };
      this.backoff = { timer: this.timers.setTimeout(wake, ms), wake };
    });
  }

  private cancelBackoff(): void {
    this.backoff?.wake();
  }

  private settle(result: ReconcileResult<T>): void {
    for (const resolve of this.waiters.splice(0)) resolve(result);
  }
}
