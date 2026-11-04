// Publication reconciliation: make what this client publishes match what
// the user wants, with the fewest media operations, through an injected
// media interface. Initial publish, outbound-stall recovery and the
// republish after a voice reconnect all go through it. No React, no DOM.
// See STATE_MACHINE.md, "Publication".

import type { VoiceTimers } from "./voice-session";

/**
 * What a client publishes on its camera source. Screen share is not a slot
 * yet: it keeps its own publication path.
 */
export type PublicationSlot = "microphone" | "camera";

/** Reconciled in this order: what peers hear first. */
export const PUBLICATION_SLOTS: readonly PublicationSlot[] = [
  "microphone",
  "camera",
];

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
 * method may reject or throw; the reconciler retries.
 */
export interface PublicationMedia<T> {
  /**
   * Publishes `track` on `slot`. On a slot that is already published (or
   * withdrawn and kept alive) this MUST behave as a replacement of its
   * source, so publishing twice is harmless.
   */
  publish(slot: PublicationSlot, track: T): Promise<void> | void;
  /**
   * Swaps the source of the slot's existing publication. Resolves false
   * when there is no publication to swap (the reconciler then publishes).
   */
  replace(slot: PublicationSlot, track: T): Promise<boolean> | boolean;
  /** Stops offering the slot's publication. */
  unpublish(slot: PublicationSlot): Promise<void> | void;
  /** Mutes or unmutes the slot's published track. Synchronous. */
  setEnabled(slot: PublicationSlot, enabled: boolean): void;
  /** Whether the media session has a publication on `slot` right now. */
  isPublished(slot: PublicationSlot): boolean;
}

/** One media operation. */
export type PublicationOp<T> =
  | {
      readonly kind: "publish";
      readonly slot: PublicationSlot;
      readonly track: T;
    }
  | {
      readonly kind: "replace";
      readonly slot: PublicationSlot;
      readonly track: T;
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

export type PublicationIntent<T> = Readonly<
  Record<PublicationSlot, SlotIntent<T>>
>;
export type AppliedPublications<T> = Readonly<
  Partial<Record<PublicationSlot, AppliedSlot<T>>>
>;

/**
 * The operations that take `applied` to `intent`. Pure. Per slot, in
 * {@link PUBLICATION_SLOTS} order:
 *
 * - wanted nothing: `unpublish` if this connection published something on
 *   it or the media session has a publication there; else nothing.
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
  const ops: PublicationOp<T>[] = [];
  for (const slot of PUBLICATION_SLOTS) {
    const want = intent[slot];
    const have = applied[slot];
    if (want.track === null) {
      if ((have?.track ?? null) !== null || isPublished(slot)) {
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
  /** The retry budget ran out on `op`; the intent is kept. */
  | {
      readonly status: "failed";
      readonly op: PublicationOp<T>;
      readonly error: unknown;
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
 * Owns one client's microphone and camera publications. Platforms set the
 * intent ({@link setTrack}, {@link setEnabled}) and ask for a
 * {@link reconcile}; only the reconciler publishes, replaces or unpublishes.
 */
export class PublicationReconciler<T> {
  private readonly media: PublicationMedia<T>;
  private readonly timers: VoiceTimers;
  private readonly retry: PublicationRetryPolicy;
  private readonly onOpError: PublicationReconcilerOptions<T>["onOpError"];
  private intent: Record<PublicationSlot, SlotIntent<T>> = {
    microphone: NO_INTENT,
    camera: NO_INTENT,
  };
  private versions: Record<PublicationSlot, number> = {
    microphone: 0,
    camera: 0,
  };
  private applied: Partial<Record<PublicationSlot, AppliedSlot<T>>> = {};
  private connection = 0;
  /** The connection whose run is active, if any. */
  private running: number | null = null;
  private dirty = false;
  private failures = 0;
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
    };
  }

  /** Whether a run is in flight (or waiting out a retry). */
  get busy(): boolean {
    return this.running === this.connection;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  intentFor(slot: PublicationSlot): SlotIntent<T> {
    return this.intent[slot];
  }

  /** What this connection has on `slot`; undefined when unknown. */
  appliedFor(slot: PublicationSlot): AppliedSlot<T> | undefined {
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
  setTrack(slot: PublicationSlot, track: T | null): void {
    if (this.disposed) return;
    const current = this.intent[slot];
    if (current.track === track) return;
    this.intent = { ...this.intent, [slot]: { ...current, track } };
    this.versions = { ...this.versions, [slot]: this.versions[slot] + 1 };
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
   * connection (web: a promoted standby's silence), so the reconciler
   * replaces it rather than publishing beside it. Takes it as the intent
   * when nothing is wanted on the slot yet.
   */
  adopt(slot: PublicationSlot, track: T, enabled: boolean | null = null): void {
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
    try {
      while (this.owns(connection)) {
        this.dirty = false;
        const ops = planPublication(this.intent, this.applied, (slot) =>
          this.media.isPublished(slot),
        );
        if (ops.length === 0) {
          this.failures = 0;
          this.settle({ status: "converged" });
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
            this.failures = 0;
            this.settle({ status: "failed", op, error: outcome.error });
            return;
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

  private record(slot: PublicationSlot, track: T | null): void {
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
